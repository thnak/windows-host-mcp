import type { ShellKind } from "../config.js";
import type { SshConnection } from "./connection.js";
export type JobStatus = "running" | "exited" | "killed";
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
export declare class JobRegistry {
    private readonly conn;
    private readonly hostName;
    private readonly nowMs;
    /** Globally-unique job id generator, shared across hosts. */
    private readonly makeJobId;
    private jobs;
    constructor(conn: SshConnection, hostName: string, nowMs: () => number, 
    /** Globally-unique job id generator, shared across hosts. */
    makeJobId: () => string);
    start(input: StartJobInput): Promise<JobSummary>;
    private get;
    getOutput(jobId: string, sinceOffset?: number): JobOutput;
    sendInput(jobId: string, input: string, appendNewline?: boolean): void;
    cancel(jobId: string, signal?: string): JobSummary;
    list(): JobSummary[];
    private summarize;
}
