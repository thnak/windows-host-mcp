import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HostManager } from "./hostManager.js";
import { registerAllTools } from "./tools/index.js";
import { VERSION } from "./version.js";

/** Run the MCP server over stdio. This is the default (no-argument) CLI behavior. */
export async function runServer(): Promise<void> {
  const config = loadConfig();

  const manager = new HostManager(config, () => Date.now());

  const server = new McpServer({
    name: "windows-host-mcp",
    version: VERSION,
  });

  registerAllTools(server, { manager });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is the MCP channel — log only to stderr.
  const summary = manager
    .list()
    .map((h) => `${h.active ? "*" : " "}${h.name}${h.labels.length ? `[${h.labels.join(",")}]` : ""}`)
    .join(" ");
  process.stderr.write(
    `windows-host-mcp v${VERSION} ready → ${config.hosts.length} host(s): ${summary} (active: ${config.defaultHost})\n`,
  );

  const shutdown = () => {
    manager.closeAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
