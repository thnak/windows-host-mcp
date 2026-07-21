import type { ShellKind } from "../config.js";
import type { SshConnection } from "./connection.js";
import { wrapCommand } from "../shell.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_CAP = 1_000_000; // ~1 MB per stream before truncation

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

/** Append to a capped buffer; returns the new buffer and whether truncation occurred. */
function appendCapped(buf: string, chunk: string, cap: number): { buf: string; truncated: boolean } {
  if (buf.length >= cap) return { buf, truncated: true };
  const combined = buf + chunk;
  if (combined.length <= cap) return { buf: combined, truncated: false };
  return { buf: combined.slice(0, cap), truncated: true };
}

/** Run a one-shot command and collect its output, exit code, and timeout status. */
export function runCommand(
  conn: SshConnection,
  input: RunCommandInput,
): Promise<RunCommandResult> {
  const commandLine = wrapCommand(input.command, {
    shell: input.shell,
    cwd: input.cwd,
    env: input.env,
  });
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<RunCommandResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    conn
      .exec(commandLine)
      .then((channel) => {
        const timer = setTimeout(() => {
          timedOut = true;
          // Best-effort kill; Windows OpenSSH signal support is limited, so
          // also close the channel to unblock.
          try {
            channel.signal("KILL");
          } catch {
            /* ignore */
          }
          channel.close();
        }, timeoutMs);

        channel.on("data", (chunk: Buffer) => {
          const r = appendCapped(stdout, chunk.toString("utf8"), DEFAULT_OUTPUT_CAP);
          stdout = r.buf;
          stdoutTruncated = stdoutTruncated || r.truncated;
        });
        channel.stderr.on("data", (chunk: Buffer) => {
          const r = appendCapped(stderr, chunk.toString("utf8"), DEFAULT_OUTPUT_CAP);
          stderr = r.buf;
          stderrTruncated = stderrTruncated || r.truncated;
        });
        channel.on("close", (code: number | null, signal: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            stdout,
            stderr,
            exitCode: code ?? null,
            signal: signal ?? null,
            timedOut,
            stdoutTruncated,
            stderrTruncated,
          });
        });
      })
      .catch(reject);
  });
}
