import type { ClientChannel } from "ssh2";
import type { ShellKind } from "../config.js";
import type { SshConnection } from "./connection.js";
import { wrapCommand } from "../shell.js";

export type JobStatus = "running" | "exited" | "killed";

interface Job {
  id: string;
  command: string;
  shell: ShellKind;
  pty: boolean;
  channel: ClientChannel;
  /** Append-only output buffer. With pty, stdout+stderr are merged by the TTY. */
  output: string;
  status: JobStatus;
  exitCode: number | null;
  signal: string | null;
  startedAtMs: number;
  outputTruncated: boolean;
}

const OUTPUT_CAP = 5_000_000; // ~5 MB retained per job

export interface JobSummary {
  jobId: string;
  host: string;
  command: string;
  shell: ShellKind;
  pty: boolean;
  status: JobStatus;
  exitCode: number | null;
  signal: string | null;
  bufferedBytes: number;
  outputTruncated: boolean;
}

export interface JobOutput {
  jobId: string;
  host: string;
  output: string;
  /** Offset (in chars) to pass as sinceOffset on the next poll. */
  nextOffset: number;
  status: JobStatus;
  exitCode: number | null;
  signal: string | null;
  outputTruncated: boolean;
}

export interface StartJobInput {
  command: string;
  shell: ShellKind;
  cwd?: string;
  env?: Record<string, string>;
  pty?: boolean;
}

/**
 * Registry of long-running / interactive commands. Each job streams output into
 * a buffer the agent polls via getOutput(); the agent can push stdin with
 * sendInput() and stop it with cancel(). jobId uses a monotonic counter (no
 * Math.random) so it is deterministic within a process.
 */
export class JobRegistry {
  private jobs = new Map<string, Job>();

  constructor(
    private readonly conn: SshConnection,
    private readonly hostName: string,
    private readonly nowMs: () => number,
    /** Globally-unique job id generator, shared across hosts. */
    private readonly makeJobId: () => string,
  ) {}

  async start(input: StartJobInput): Promise<JobSummary> {
    const pty = input.pty ?? false;
    const commandLine = wrapCommand(input.command, {
      shell: input.shell,
      cwd: input.cwd,
      env: input.env,
      interactive: true,
    });

    const channel = await this.conn.exec(commandLine, { pty });
    const id = this.makeJobId();
    const job: Job = {
      id,
      command: input.command,
      shell: input.shell,
      pty,
      channel,
      output: "",
      status: "running",
      exitCode: null,
      signal: null,
      startedAtMs: this.nowMs(),
      outputTruncated: false,
    };

    const append = (chunk: Buffer) => {
      if (job.output.length >= OUTPUT_CAP) {
        job.outputTruncated = true;
        return;
      }
      const combined = job.output + chunk.toString("utf8");
      if (combined.length > OUTPUT_CAP) {
        job.output = combined.slice(0, OUTPUT_CAP);
        job.outputTruncated = true;
      } else {
        job.output = combined;
      }
    };

    channel.on("data", append);
    // Without a pty, stderr is a separate stream; fold it into the same buffer.
    if (!pty) channel.stderr.on("data", append);
    channel.on("close", (code: number | null, signal: string | null) => {
      job.exitCode = code ?? null;
      job.signal = signal ?? null;
      if (job.status !== "killed") job.status = "exited";
    });

    this.jobs.set(id, job);
    return this.summarize(job);
  }

  private get(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown jobId: ${jobId}`);
    return job;
  }

  getOutput(jobId: string, sinceOffset = 0): JobOutput {
    const job = this.get(jobId);
    const offset = Math.max(0, Math.min(sinceOffset, job.output.length));
    const slice = job.output.slice(offset);
    return {
      jobId,
      host: this.hostName,
      output: slice,
      nextOffset: offset + slice.length,
      status: job.status,
      exitCode: job.exitCode,
      signal: job.signal,
      outputTruncated: job.outputTruncated,
    };
  }

  sendInput(jobId: string, input: string, appendNewline = true): void {
    const job = this.get(jobId);
    if (job.status !== "running") {
      throw new Error(`Job ${jobId} is not running (status: ${job.status})`);
    }
    job.channel.write(appendNewline ? `${input}\n` : input);
  }

  cancel(jobId: string, signal = "KILL"): JobSummary {
    const job = this.get(jobId);
    if (job.status === "running") {
      job.status = "killed";
      try {
        job.channel.signal(signal);
      } catch {
        /* signals are unreliable on Windows OpenSSH */
      }
      job.channel.close();
    }
    return this.summarize(job);
  }

  list(): JobSummary[] {
    return [...this.jobs.values()].map((j) => this.summarize(j));
  }

  private summarize(job: Job): JobSummary {
    return {
      jobId: job.id,
      host: this.hostName,
      command: job.command,
      shell: job.shell,
      pty: job.pty,
      status: job.status,
      exitCode: job.exitCode,
      signal: job.signal,
      bufferedBytes: job.output.length,
      outputTruncated: job.outputTruncated,
    };
  }
}
