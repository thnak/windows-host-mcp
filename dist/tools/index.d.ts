import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
export type { AppContext } from "./context.js";
/** Register every tool group on the server. */
export declare function registerAllTools(server: McpServer, ctx: AppContext): void;
