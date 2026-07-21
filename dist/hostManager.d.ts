import type { AppConfig } from "./config.js";
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
export declare class HostManager {
    private hosts;
    private order;
    private activeName;
    private jobCounter;
    private jobOwners;
    constructor(config: AppConfig, nowMs: () => number);
    private buildHost;
    private knownList;
    /** Resolve a host by name, or the active host when name is omitted. */
    resolve(name?: string): Host;
    active(): Host;
    activeName_(): string;
    /**
     * Switch the active host, selecting by name or by a capability label. When a
     * label is given it must match exactly one host.
     */
    use(selector: {
        name?: string;
        label?: string;
    }): Host;
    list(): HostInfo[];
    startJob(name: string | undefined, input: Parameters<JobRegistry["start"]>[0]): Promise<JobSummary>;
    private jobHost;
    getJobOutput(jobId: string, sinceOffset?: number): import("./ssh/jobs.js").JobOutput;
    sendJobInput(jobId: string, input: string, appendNewline?: boolean): void;
    cancelJob(jobId: string, signal?: string): JobSummary;
    /** List jobs on one host, or across all hosts when name is omitted. */
    listJobs(name?: string): JobSummary[];
    /**
     * Drop the cached SSH connection for a host (or the active host) so the next
     * call establishes a fresh one. Useful after changing the Windows account's
     * group membership, environment, or PATH, which an existing session won't
     * pick up. Returns the host name that was reset.
     */
    reconnect(name?: string): string;
    closeAll(): void;
}
