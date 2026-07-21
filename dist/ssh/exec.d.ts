import type { ShellKind } from "../config.js";
import type { SshConnection } from "./connection.js";
export interface RunCommandInput {
    command: string;
    shell: ShellKind;
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
}
export interface RunCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
}
/** Run a one-shot command and collect its output, exit code, and timeout status. */
export declare function runCommand(conn: SshConnection, input: RunCommandInput): Promise<RunCommandResult>;
