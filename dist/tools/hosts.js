import { z } from "zod";
import { errorResult, result } from "./context.js";
export function registerHostTools(server, ctx) {
    server.registerTool("list_hosts", {
        title: "List available hosts / devices",
        description: "List every configured Windows host with its capability labels (e.g. cuda, rocm), which one is active, and whether it is currently connected. Use this to pick a device, then switch with use_host.",
        inputSchema: {},
    }, async () => {
        try {
            const hosts = ctx.manager.list();
            const lines = hosts.map((h) => {
                const flag = h.active ? "* " : "  ";
                const labels = h.labels.length ? ` [${h.labels.join(", ")}]` : "";
                const desc = h.description ? ` — ${h.description}` : "";
                return `${flag}${h.name}${labels} (${h.username}@${h.address}:${h.port})${desc}`;
            });
            return result({ hosts, activeHost: hosts.find((h) => h.active)?.name }, lines.join("\n"));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("reconnect", {
        title: "Reconnect a host's SSH session",
        description: "Drop and re-establish the SSH connection to a host (defaults to the active host). Use this after changing the Windows account on the host side — e.g. adding it to a group like docker-users, or changing environment/PATH — since an existing SSH session won't pick those up until it reconnects.",
        inputSchema: {
            host: z
                .string()
                .optional()
                .describe("Host to reconnect; defaults to the active host."),
        },
    }, async ({ host }) => {
        try {
            const name = ctx.manager.reconnect(host);
            return result({ host: name, reconnected: true }, `Reconnected ${name}; next call opens a fresh session.`);
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("use_host", {
        title: "Switch the active host / device",
        description: "Change which host subsequent commands target by default (the 'device switch'). Select by name, or by a capability label that matches exactly one host (e.g. label 'cuda'). Per-host session state (cwd/env) and jobs are preserved across switches.",
        inputSchema: {
            name: z.string().optional().describe("Host name to activate."),
            label: z
                .string()
                .optional()
                .describe("Capability label to activate by (must match exactly one host)."),
        },
    }, async ({ name, label }) => {
        try {
            const host = ctx.manager.use({ name, label });
            return result({
                activeHost: host.name,
                labels: host.labels,
                address: host.address,
                port: host.port,
                username: host.username,
            }, `Active host is now ${host.name}${host.labels.length ? ` [${host.labels.join(", ")}]` : ""}.`);
        }
        catch (err) {
            return errorResult(err);
        }
    });
}
//# sourceMappingURL=hosts.js.map