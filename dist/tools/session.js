import { z } from "zod";
import { errorResult, result } from "./context.js";
import { dirExists } from "../ssh/probe.js";
const shellEnum = z.enum(["powershell", "cmd", "bash"]);
const hostParam = z
    .string()
    .optional()
    .describe("Target host name; defaults to the active host.");
export function registerSessionTools(server, ctx) {
    server.registerTool("get_session", {
        title: "Get session defaults",
        description: "Return the default working directory, environment variables, and shell for a host (each host keeps its own). Defaults to the active host.",
        inputSchema: { host: hostParam },
    }, async ({ host }) => {
        try {
            const target = ctx.manager.resolve(host);
            return result({ host: target.name, ...target.session.get() });
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("set_session", {
        title: "Set session defaults",
        description: "Update the default working directory, environment variables, and/or shell used by subsequent run_command / start_job calls on a host. env is merged into the existing defaults (pass null as a value to delete a var). A new cwd is verified to exist on the host before it is accepted, so a typo fails here instead of silently breaking every later command. Each host has its own session, so switching hosts preserves per-host state.",
        inputSchema: {
            cwd: z.string().optional().describe("New default working directory on Windows (must exist)."),
            env: z
                .record(z.string().nullable())
                .optional()
                .describe("Environment variables to merge into the session defaults; a null value deletes the var."),
            shell: shellEnum.optional().describe("New default shell."),
            host: hostParam,
        },
    }, async ({ cwd, env, shell, host }) => {
        try {
            const target = ctx.manager.resolve(host);
            if (cwd !== undefined) {
                // Validate against the shell that will be in effect after this update.
                const effShell = shell ?? target.session.get().shell;
                const ok = await dirExists(target.conn, effShell, cwd);
                if (!ok) {
                    return errorResult(new Error(`cwd "${cwd}" does not exist (or is not a directory) on host ${target.name}. ` +
                        `Session left unchanged; check the path with list_remote_dir.`));
                }
            }
            const state = target.session.update({ cwd, env, shell });
            return result({ host: target.name, ...state }, `Session updated for ${target.name}.`);
        }
        catch (err) {
            return errorResult(err);
        }
    });
}
//# sourceMappingURL=session.js.map