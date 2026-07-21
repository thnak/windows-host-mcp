import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import { registerHostTools } from "./hosts.js";
import { registerRunCommandTools } from "./runCommand.js";
import { registerJobTools } from "./jobs.js";
import { registerFileTools } from "./files.js";
import { registerSessionTools } from "./session.js";
import { registerProbeTools } from "./probe.js";

export type { AppContext } from "./context.js";

/** Register every tool group on the server. */
export function registerAllTools(server: McpServer, ctx: AppContext): void {
  registerHostTools(server, ctx);
  registerRunCommandTools(server, ctx);
  registerJobTools(server, ctx);
  registerFileTools(server, ctx);
  registerSessionTools(server, ctx);
  registerProbeTools(server, ctx);
}
