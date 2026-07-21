import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import { errorResult, result } from "./context.js";
import { formatSize, tailAndSave } from "./output.js";

const shellEnum = z.enum(["powershell", "cmd", "bash"]);

export function registerJobTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "start_job",
    {
      title: "Start a long-running / interactive job",
      description:
        "Start a command that may run for a long time (e.g. a build or test suite) without waiting for it to finish. Runs on the active host unless host is given. Returns a jobId (unique across hosts). Poll output with get_job_output, feed stdin with send_job_input, and stop it with cancel_job. Set pty:true for programs that require a terminal or interactive prompts.",
      inputSchema: {
        command: z.string().describe("The command to run."),
        host: z
          .string()
          .optional()
          .describe("Target host name; defaults to the active host."),
        shell: shellEnum.optional().describe("Override the session default shell."),
        cwd: z.string().optional().describe("Working directory on Windows (overrides session cwd)."),
        env: z.record(z.string()).optional().describe("Extra environment variables."),
        pty: z
          .boolean()
          .optional()
          .describe("Allocate a pseudo-terminal (merges stdout+stderr; needed for interactive TTY programs)."),
      },
    },
    async ({ command, host, shell, cwd, env, pty }) => {
      try {
        const target = ctx.manager.resolve(host);
        const resolved = target.session.resolve({ shell, cwd, env });
        const summary = await ctx.manager.startJob(target.name, {
          command,
          shell: resolved.shell,
          cwd: resolved.cwd,
          env: resolved.env,
          pty,
        });
        return result(summary, `Started ${summary.jobId} on ${summary.host} (${summary.status}).`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_job_output",
    {
      title: "Get new output from a job",
      description:
        "Fetch output from a running or finished job (any host — the jobId identifies it). Pass sinceOffset (the nextOffset from the previous call) to get only new output. Includes status and exit code once the job finishes.",
      inputSchema: {
        jobId: z.string().describe("The job id returned by start_job."),
        sinceOffset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Character offset to read from; use the previous nextOffset. Defaults to 0."),
        truncate: z
          .boolean()
          .optional()
          .describe(
            "Tail the new output and spill the full slice to a temp file (.whmcp-tmp/) instead of flooding the reply. Default true; pass false to force the entire slice inline. nextOffset still advances past everything, so the next poll only returns newer output.",
          ),
      },
    },
    async ({ jobId, sinceOffset, truncate }) => {
      try {
        const out = ctx.manager.getJobOutput(jobId, sinceOffset ?? 0);
        const tail =
          truncate === false
            ? { shown: out.output, truncated: false, totalChars: out.output.length, savedPath: undefined }
            : tailAndSave(out.output, "job");

        const note = tail.truncated
          ? `[output ${formatSize(tail.totalChars)}, showing last ${formatSize(tail.shown.length)}]` +
            (tail.savedPath ? `\nfull output saved: ${tail.savedPath}\n` : "\n")
          : "";
        const text = tail.shown ? `${note}${tail.shown}` : `[no new output] status=${out.status}`;

        return result(
          {
            jobId: out.jobId,
            host: out.host,
            output: tail.shown,
            nextOffset: out.nextOffset,
            status: out.status,
            exitCode: out.exitCode,
            signal: out.signal,
            outputTruncated: tail.truncated,
            totalBytes: tail.totalChars,
            savedPath: tail.savedPath,
            bufferTruncated: out.outputTruncated,
          },
          text,
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "send_job_input",
    {
      title: "Send stdin to a job",
      description:
        "Write input to a running job's stdin — e.g. answer a prompt or feed a REPL. A newline is appended by default.",
      inputSchema: {
        jobId: z.string().describe("The job id."),
        input: z.string().describe("Text to send to the job's stdin."),
        appendNewline: z
          .boolean()
          .optional()
          .describe("Append a newline after the input (default true)."),
      },
    },
    async ({ jobId, input, appendNewline }) => {
      try {
        ctx.manager.sendJobInput(jobId, input, appendNewline ?? true);
        return result({ jobId, sent: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "cancel_job",
    {
      title: "Cancel a running job",
      description:
        "Stop a running job. Sends a signal and closes the channel. Note: signal delivery is unreliable on Windows OpenSSH; for stubborn processes run a taskkill via run_command.",
      inputSchema: {
        jobId: z.string().describe("The job id."),
        signal: z.string().optional().describe("Signal name to send (default KILL)."),
      },
    },
    async ({ jobId, signal }) => {
      try {
        const summary = ctx.manager.cancelJob(jobId, signal ?? "KILL");
        return result(summary, `Job ${jobId} status: ${summary.status}.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description:
        "List jobs with their host, status, and exit codes. Defaults to all hosts; pass host to filter.",
      inputSchema: {
        host: z.string().optional().describe("Only list jobs on this host."),
      },
    },
    async ({ host }) => {
      try {
        const jobs = ctx.manager.listJobs(host);
        return result({ jobs }, jobs.length ? undefined : "No jobs.");
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
