import { z } from "zod";
import { errorResult, result } from "./context.js";
import { DEFAULT_TOOLS, checkTools, dirExists, getHostInfo } from "../ssh/probe.js";
const hostParam = z
    .string()
    .optional()
    .describe("Target host name; defaults to the active host.");
export function registerProbeTools(server, ctx) {
    server.registerTool("get_host_info", {
        title: "Probe a host's OS, tools, and environment",
        description: "One-shot discovery of a Windows host so you don't have to guess: OS version, hostname/user, PATH, and which common tools (git, node, python, dotnet, cmake, docker, nvcc, ...) are installed and their versions. Also reports whether the current session cwd is valid. Run this before a build to avoid calls that fail on missing tools or a bad working directory.",
        inputSchema: {
            host: hostParam,
            tools: z
                .array(z.string())
                .optional()
                .describe("Extra executables to probe, in addition to the common default set."),
        },
    }, async ({ host, tools }) => {
        try {
            const target = ctx.manager.resolve(host);
            const toProbe = [...new Set([...DEFAULT_TOOLS, ...(tools ?? [])])];
            const info = await getHostInfo(target.conn, toProbe);
            const session = target.session.get();
            let sessionCwd = session.cwd ?? null;
            let sessionCwdValid = null;
            if (session.cwd) {
                sessionCwdValid = await dirExists(target.conn, session.shell, session.cwd);
            }
            const found = info.tools.filter((t) => t.found);
            const missing = info.tools.filter((t) => !t.found).map((t) => t.name);
            const text = `[${target.name}] ${info.os ?? "Windows"} (${info.osVersion ?? "?"}) — ${info.user ?? "?"}@${info.hostname ?? "?"}\n` +
                `session shell: ${session.shell}\n` +
                `session cwd: ${sessionCwd ?? "(host default)"}${sessionCwd ? (sessionCwdValid ? " (ok)" : " (MISSING)") : ""}\n` +
                `tools found: ${found.map((t) => `${t.name}${t.version ? " " + t.version : ""}`).join(", ") || "none"}\n` +
                (missing.length ? `not found: ${missing.join(", ")}\n` : "") +
                `PATH entries: ${info.path.length}`;
            return result({
                host: target.name,
                ...info,
                sessionShell: session.shell,
                sessionCwd,
                sessionCwdValid,
            }, text);
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("check_tools", {
        title: "Check specific tools exist on a host",
        description: "Given a list of executables, report which are on PATH and their versions. Use this before running a command that depends on a toolchain, instead of discovering it's missing when the command fails.",
        inputSchema: {
            tools: z.array(z.string()).min(1).describe("Executable names to look for, e.g. [\"cmake\", \"nvcc\"]."),
            host: hostParam,
        },
    }, async ({ tools, host }) => {
        try {
            const target = ctx.manager.resolve(host);
            const results = await checkTools(target.conn, tools);
            const text = results
                .map((t) => t.found ? `${t.name}: ${t.version ?? "(found)"} — ${t.path}` : `${t.name}: NOT FOUND`)
                .join("\n");
            return result({ host: target.name, tools: results }, text);
        }
        catch (err) {
            return errorResult(err);
        }
    });
}
//# sourceMappingURL=probe.js.map