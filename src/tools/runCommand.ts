import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import { errorResult, result } from "./context.js";
import { formatSize, tailAndSave } from "./output.js";
import { runCommand } from "../ssh/exec.js";

const shellEnum = z.enum(["powershell", "cmd", "bash"]);
const hostParam = z
  .string()
  .optional()
  .describe("Target host name; defaults to the active host (see list_hosts / use_host).");

export function registerRunCommandTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "test_connection",
    {
      title: "Test a Windows SSH connection",
      description:
        "Verify the SSH connection to a host and return its hostname and current user. Defaults to the active host. Use this first to confirm setup.",
      inputSchema: { host: hostParam },
    },
    async ({ host }) => {
      try {
        const target = ctx.manager.resolve(host);
        const { shell } = target.session.resolve({});
        const res = await runCommand(target.conn, {
          command: shell === "cmd" ? "hostname & whoami" : "hostname; whoami",
          shell,
          timeoutMs: 15_000,
        });
        return result({
          host: target.name,
          ok: res.exitCode === 0 || res.exitCode === null,
          output: res.stdout.trim(),
          stderr: res.stderr.trim(),
          exitCode: res.exitCode,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "run_command",
    {
      title: "Run a command on Windows",
      description:
        "Run a one-shot command on a Windows host and wait for it to finish. Returns stdout, stderr, and exit code. Defaults to the active host and its session shell/cwd/env; use start_job instead for long-running or interactive commands.",
      inputSchema: {
        command: z.string().describe("The command to run, in the chosen shell's syntax."),
        host: hostParam,
        shell: shellEnum.optional().describe("Override the session default shell."),
        cwd: z.string().optional().describe("Working directory on Windows (overrides session cwd)."),
        env: z
          .record(z.string())
          .optional()
          .describe("Extra environment variables for this command."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Kill the command after this many ms (default 120000)."),
        truncate: z
          .boolean()
          .optional()
          .describe(
            "Tail long output and spill the full stdout/stderr to a temp file (.whmcp-tmp/) instead of flooding the reply. Default true; pass false to force the entire output inline.",
          ),
      },
    },
    async ({ command, host, shell, cwd, env, timeoutMs, truncate }) => {
      try {
        const target = ctx.manager.resolve(host);
        const resolved = target.session.resolve({ shell, cwd, env });
        const res = await runCommand(target.conn, {
          command,
          shell: resolved.shell,
          cwd: resolved.cwd,
          env: resolved.env,
          timeoutMs,
        });

        const full =
          (res.stdout ? `--- stdout ---\n${res.stdout}\n` : "") +
          (res.stderr ? `--- stderr ---\n${res.stderr}\n` : "");
        const tail =
          truncate === false
            ? { shown: full, truncated: false, totalChars: full.length, savedPath: undefined }
            : tailAndSave(full, "run");

        const header = res.timedOut
          ? `[${target.name}] Command timed out.`
          : `[${target.name}] Exit code: ${res.exitCode}`;
        const note = tail.truncated
          ? `\n[output ${formatSize(tail.totalChars)}, showing last ${formatSize(tail.shown.length)}]` +
            (tail.savedPath ? `\nfull output saved: ${tail.savedPath}` : "")
          : "";
        const text = `${header}${note}\n\n${tail.shown}`;

        return result(
          {
            host: target.name,
            exitCode: res.exitCode,
            timedOut: res.timedOut,
            output: tail.shown,
            outputTruncated: tail.truncated,
            totalBytes: tail.totalChars,
            savedPath: tail.savedPath,
            stdoutStreamTruncated: res.stdoutTruncated,
            stderrStreamTruncated: res.stderrTruncated,
          },
          text,
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
