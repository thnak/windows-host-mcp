#!/usr/bin/env node
import { runServer } from "./server.js";
import { runUpdate } from "./cliUpdate.js";
import { runConfig } from "./cliConfig.js";
import { VERSION } from "./version.js";
const USAGE = `windows-host-mcp v${VERSION}

Usage:
  windows-host-mcp                  Run the MCP server over stdio (default; used by MCP clients).
  windows-host-mcp config           Interactive wizard to add/edit/remove hosts and register with Claude Code.
  windows-host-mcp update           Check GitHub for a newer release and self-update.
  windows-host-mcp --version, -v    Print the installed version.
  windows-host-mcp --help, -h       Show this help.
`;
async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    switch (cmd) {
        case undefined:
            await runServer();
            return;
        case "config":
        case "--config":
            await runConfig(rest);
            return;
        case "update":
        case "--update":
            await runUpdate();
            return;
        case "--version":
        case "-v":
            process.stdout.write(`${VERSION}\n`);
            return;
        case "--help":
        case "-h":
            process.stdout.write(USAGE);
            return;
        default:
            process.stderr.write(`Unknown command: ${cmd}\n\n${USAGE}`);
            process.exitCode = 1;
    }
}
main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map