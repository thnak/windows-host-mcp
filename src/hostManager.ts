import type { AppConfig, HostConfig } from "./config.js";
import { SshConnection } from "./ssh/connection.js";
import { JobRegistry } from "./ssh/jobs.js";
import { Session } from "./session.js";
import type { JobSummary } from "./ssh/jobs.js";

/** A single configured Windows host with its own connection, session, and jobs. */
export interface Host {
  name: string;
  description?: string;
  labels: string[];
  address: string;
  port: number;
  username: string;
  conn: SshConnection;
  session: Session;
  jobs: JobRegistry;
}

/** A device/host as reported to the agent by list_hosts. */
export interface HostInfo {
  name: string;
  description?: string;
  labels: string[];
  address: string;
  port: number;
  username: string;
  active: boolean;
  connected: boolean;
}

/**
 * Owns every configured host, tracks which one is "active", and routes job
 * lookups by their globally-unique id. The agent switches the active host with
 * use()/use_host (e.g. from a CUDA box to a ROCm box); individual tool calls
 * may also target a specific host by name.
 */
export class HostManager {
  private hosts = new Map<string, Host>();
  private order: string[] = [];
  private activeName: string;
  private jobCounter = 0;
  private jobOwners = new Map<string, Host>();

  constructor(config: AppConfig, nowMs: () => number) {
    for (const hc of config.hosts) {
      this.hosts.set(hc.name, this.buildHost(hc, nowMs));
      this.order.push(hc.name);
    }
    this.activeName = config.defaultHost;
  }

  private buildHost(hc: HostConfig, nowMs: () => number): Host {
    const conn = new SshConnection(hc);
    const session = new Session(hc);
    const jobs = new JobRegistry(conn, hc.name, nowMs, () => `job-${++this.jobCounter}`);
    return {
      name: hc.name,
      description: hc.description,
      labels: hc.labels,
      address: hc.host,
      port: hc.port,
      username: hc.username,
      conn,
      session,
      jobs,
    };
  }

  private knownList(): string {
    return this.order
      .map((n) => {
        const h = this.hosts.get(n)!;
        return h.labels.length ? `${n} [${h.labels.join(", ")}]` : n;
      })
      .join(", ");
  }

  /** Resolve a host by name, or the active host when name is omitted. */
  resolve(name?: string): Host {
    const key = name ?? this.activeName;
    const host = this.hosts.get(key);
    if (!host) throw new Error(`Unknown host "${key}". Available: ${this.knownList()}`);
    return host;
  }

  active(): Host {
    return this.resolve();
  }

  activeName_(): string {
    return this.activeName;
  }

  /**
   * Switch the active host, selecting by name or by a capability label. When a
   * label is given it must match exactly one host.
   */
  use(selector: { name?: string; label?: string }): Host {
    if (selector.name) {
      this.resolve(selector.name); // validates
      this.activeName = selector.name;
      return this.active();
    }
    if (selector.label) {
      const matches = this.order
        .map((n) => this.hosts.get(n)!)
        .filter((h) => h.labels.includes(selector.label!));
      if (matches.length === 0) {
        throw new Error(`No host has label "${selector.label}". Available: ${this.knownList()}`);
      }
      if (matches.length > 1) {
        throw new Error(
          `Label "${selector.label}" matches multiple hosts (${matches
            .map((h) => h.name)
            .join(", ")}); switch by name instead.`,
        );
      }
      this.activeName = matches[0].name;
      return this.active();
    }
    throw new Error(`use_host requires either "name" or "label"`);
  }

  list(): HostInfo[] {
    return this.order.map((n) => {
      const h = this.hosts.get(n)!;
      return {
        name: h.name,
        description: h.description,
        labels: h.labels,
        address: h.address,
        port: h.port,
        username: h.username,
        active: h.name === this.activeName,
        connected: h.conn.isConnected(),
      };
    });
  }

  // --- Job routing (jobIds are unique across hosts) ---

  async startJob(name: string | undefined, input: Parameters<JobRegistry["start"]>[0]): Promise<JobSummary> {
    const host = this.resolve(name);
    const summary = await host.jobs.start(input);
    this.jobOwners.set(summary.jobId, host);
    return summary;
  }

  private jobHost(jobId: string): Host {
    const host = this.jobOwners.get(jobId);
    if (!host) throw new Error(`Unknown jobId: ${jobId}`);
    return host;
  }

  getJobOutput(jobId: string, sinceOffset?: number) {
    return this.jobHost(jobId).jobs.getOutput(jobId, sinceOffset);
  }

  sendJobInput(jobId: string, input: string, appendNewline?: boolean) {
    return this.jobHost(jobId).jobs.sendInput(jobId, input, appendNewline);
  }

  cancelJob(jobId: string, signal?: string) {
    return this.jobHost(jobId).jobs.cancel(jobId, signal);
  }

  /** List jobs on one host, or across all hosts when name is omitted. */
  listJobs(name?: string): JobSummary[] {
    if (name) return this.resolve(name).jobs.list();
    return this.order.flatMap((n) => this.hosts.get(n)!.jobs.list());
  }

  /**
   * Drop the cached SSH connection for a host (or the active host) so the next
   * call establishes a fresh one. Useful after changing the Windows account's
   * group membership, environment, or PATH, which an existing session won't
   * pick up. Returns the host name that was reset.
   */
  reconnect(name?: string): string {
    const host = this.resolve(name);
    host.conn.close();
    return host.name;
  }

  closeAll(): void {
    for (const n of this.order) this.hosts.get(n)!.conn.close();
  }
}
