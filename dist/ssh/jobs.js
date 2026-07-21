import { wrapCommand } from "../shell.js";
const OUTPUT_CAP = 5_000_000; // ~5 MB retained per job
/**
 * Registry of long-running / interactive commands. Each job streams output into
 * a buffer the agent polls via getOutput(); the agent can push stdin with
 * sendInput() and stop it with cancel(). jobId uses a monotonic counter (no
 * Math.random) so it is deterministic within a process.
 */
export class JobRegistry {
    conn;
    hostName;
    nowMs;
    makeJobId;
    jobs = new Map();
    constructor(conn, hostName, nowMs, 
    /** Globally-unique job id generator, shared across hosts. */
    makeJobId) {
        this.conn = conn;
        this.hostName = hostName;
        this.nowMs = nowMs;
        this.makeJobId = makeJobId;
    }
    async start(input) {
        const pty = input.pty ?? false;
        const commandLine = wrapCommand(input.command, {
            shell: input.shell,
            cwd: input.cwd,
            env: input.env,
            interactive: true,
        });
        const channel = await this.conn.exec(commandLine, { pty });
        const id = this.makeJobId();
        const job = {
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
        const append = (chunk) => {
            if (job.output.length >= OUTPUT_CAP) {
                job.outputTruncated = true;
                return;
            }
            const combined = job.output + chunk.toString("utf8");
            if (combined.length > OUTPUT_CAP) {
                job.output = combined.slice(0, OUTPUT_CAP);
                job.outputTruncated = true;
            }
            else {
                job.output = combined;
            }
        };
        channel.on("data", append);
        // Without a pty, stderr is a separate stream; fold it into the same buffer.
        if (!pty)
            channel.stderr.on("data", append);
        channel.on("close", (code, signal) => {
            job.exitCode = code ?? null;
            job.signal = signal ?? null;
            if (job.status !== "killed")
                job.status = "exited";
        });
        this.jobs.set(id, job);
        return this.summarize(job);
    }
    get(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            throw new Error(`Unknown jobId: ${jobId}`);
        return job;
    }
    getOutput(jobId, sinceOffset = 0) {
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
    sendInput(jobId, input, appendNewline = true) {
        const job = this.get(jobId);
        if (job.status !== "running") {
            throw new Error(`Job ${jobId} is not running (status: ${job.status})`);
        }
        job.channel.write(appendNewline ? `${input}\n` : input);
    }
    cancel(jobId, signal = "KILL") {
        const job = this.get(jobId);
        if (job.status === "running") {
            job.status = "killed";
            try {
                job.channel.signal(signal);
            }
            catch {
                /* signals are unreliable on Windows OpenSSH */
            }
            job.channel.close();
        }
        return this.summarize(job);
    }
    list() {
        return [...this.jobs.values()].map((j) => this.summarize(j));
    }
    summarize(job) {
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
//# sourceMappingURL=jobs.js.map