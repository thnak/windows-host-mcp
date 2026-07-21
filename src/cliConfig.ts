import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Prompter } from "./cliPrompt.js";

/** Raw (pre-validation) shape of a host entry as written to hosts.json — mirrors config.ts's RawHost. */
interface RawHostEntry {
  name: string;
  description?: string;
  labels?: string[];
  host: string;
  port?: number;
  username: string;
  keyPath: string;
  keyPassphrase?: string;
  shell?: string;
  cwd?: string;
}

interface HostsFile {
  defaultHost?: string;
  hosts: RawHostEntry[];
}

/** Default location for hosts.json when the caller hasn't already pointed WINDOWS_HOSTS_CONFIG elsewhere. */
export function defaultConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "windows-host-mcp", "hosts.json");
}

function loadHostsFile(path: string): HostsFile {
  if (!existsSync(path)) return { hosts: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Could not parse existing config at ${path}: ${(err as Error).message}`);
  }
  const obj = parsed as { defaultHost?: string; hosts?: RawHostEntry[] };
  return { defaultHost: obj.defaultHost, hosts: Array.isArray(obj.hosts) ? obj.hosts : [] };
}

function saveHostsFile(path: string, data: HostsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function promptHost(p: Prompter, existing?: RawHostEntry): Promise<RawHostEntry> {
  process.stdout.write(existing ? `\nEditing host "${existing.name}":\n` : "\nNew host:\n");
  const name = existing?.name ?? (await p.ask("Name (short id, e.g. cuda-box)"));
  if (!name) throw new Error("Host name is required.");

  const host = await p.ask("Hostname or IP", existing?.host);
  const username = await p.ask("Username", existing?.username);
  const keyPath = await p.ask(
    "Private key path (on this machine)",
    existing?.keyPath ?? join(homedir(), ".ssh", "windows_host_ed25519"),
  );
  if (!host || !username || !keyPath) throw new Error("host, username, and keyPath are required.");

  const portStr = await p.ask("Port", String(existing?.port ?? 22));
  const shell = await p.ask("Default shell (powershell|cmd|bash)", existing?.shell ?? "powershell");
  const labelsStr = await p.ask("Labels (comma-separated, e.g. cuda,gpu)", (existing?.labels ?? []).join(","));
  const description = await p.ask("Description (optional)", existing?.description);
  const cwd = await p.ask("Default working directory on Windows (optional)", existing?.cwd);
  const keyPassphrase = await p.ask(
    "Private key passphrase (optional, stored in plaintext in the config file)",
    existing?.keyPassphrase,
  );

  return {
    name,
    host,
    username,
    keyPath,
    port: Number(portStr) || 22,
    shell,
    labels: labelsStr ? labelsStr.split(",").map((l) => l.trim()).filter(Boolean) : undefined,
    description: description || undefined,
    cwd: cwd || undefined,
    keyPassphrase: keyPassphrase || undefined,
  };
}

/** Attempt to (re-)register this config with Claude Code via `claude mcp add`; best-effort, never throws. */
async function registerWithClaude(p: Prompter, configPath: string): Promise<void> {
  const probe = spawnSync("claude", ["--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    process.stdout.write(
      "\nCould not find the `claude` CLI on PATH — skipping Claude Code registration.\n" +
        "Register manually with:\n" +
        `  claude mcp add windows-host-mcp -s user -e WINDOWS_HOSTS_CONFIG=${configPath} -- windows-host-mcp\n`,
    );
    return;
  }

  const register = await p.askYesNo("\nRegister/update this config with Claude Code now?", true);
  if (!register) return;
  const scope = await p.ask("Scope (user/local/project)", "user");

  // Remove any prior registration under this name first so re-running config is idempotent
  // (claude mcp add errors if the name already exists).
  spawnSync("claude", ["mcp", "remove", "windows-host-mcp", "-s", scope], { stdio: "ignore" });
  const add = spawnSync(
    "claude",
    ["mcp", "add", "windows-host-mcp", "-s", scope, "-e", `WINDOWS_HOSTS_CONFIG=${configPath}`, "--", "windows-host-mcp"],
    { stdio: "inherit" },
  );
  if (add.status === 0) {
    process.stdout.write(`\nRegistered "windows-host-mcp" with Claude Code (scope: ${scope}).\n`);
  } else {
    process.stdout.write(
      "\nRegistration failed; you can retry manually with:\n" +
        `  claude mcp add windows-host-mcp -s ${scope} -e WINDOWS_HOSTS_CONFIG=${configPath} -- windows-host-mcp\n`,
    );
  }
}

/**
 * Interactive wizard: add/edit/remove hosts in hosts.json, then optionally
 * (re-)register the server with Claude Code pointing at that file. Safe to
 * re-run at any time — it loads whatever's already there.
 */
export async function runConfig(args: string[]): Promise<void> {
  const pathFlagIdx = args.indexOf("--path");
  const configPath =
    pathFlagIdx >= 0 && args[pathFlagIdx + 1]
      ? args[pathFlagIdx + 1]
      : process.env.WINDOWS_HOSTS_CONFIG?.trim() || defaultConfigPath();

  const data = loadHostsFile(configPath);
  const p = new Prompter();

  process.stdout.write(`windows-host-mcp config — editing ${configPath}\n`);
  if (data.hosts.length) {
    process.stdout.write(`Existing hosts: ${data.hosts.map((h) => h.name).join(", ")}\n`);
  }

  try {
    let editing = true;
    while (editing) {
      const action = await p.ask("\n[a]dd host, [e]dit host, [r]emove host, [d]one", "d");
      if (action.startsWith("a")) {
        const entry = await promptHost(p);
        const idx = data.hosts.findIndex((h) => h.name === entry.name);
        if (idx >= 0) data.hosts[idx] = entry;
        else data.hosts.push(entry);
        saveHostsFile(configPath, data);
        process.stdout.write(`Saved "${entry.name}" to ${configPath}\n`);
      } else if (action.startsWith("e")) {
        if (!data.hosts.length) {
          process.stdout.write("No hosts configured yet.\n");
          continue;
        }
        const target = await p.ask(`Which host? (${data.hosts.map((h) => h.name).join(", ")})`);
        const idx = data.hosts.findIndex((h) => h.name === target);
        if (idx < 0) {
          process.stdout.write(`Unknown host "${target}".\n`);
          continue;
        }
        data.hosts[idx] = await promptHost(p, data.hosts[idx]);
        saveHostsFile(configPath, data);
        process.stdout.write(`Updated "${target}" in ${configPath}\n`);
      } else if (action.startsWith("r")) {
        if (!data.hosts.length) {
          process.stdout.write("No hosts configured yet.\n");
          continue;
        }
        const target = await p.ask(`Which host? (${data.hosts.map((h) => h.name).join(", ")})`);
        const idx = data.hosts.findIndex((h) => h.name === target);
        if (idx < 0) {
          process.stdout.write(`Unknown host "${target}".\n`);
          continue;
        }
        data.hosts.splice(idx, 1);
        if (data.defaultHost === target) data.defaultHost = undefined;
        saveHostsFile(configPath, data);
        process.stdout.write(`Removed "${target}" from ${configPath}\n`);
      } else {
        editing = false;
      }
    }

    if (!data.hosts.length) {
      process.stdout.write("\nNo hosts configured; nothing to register.\n");
      return;
    }

    if (!data.defaultHost || !data.hosts.some((h) => h.name === data.defaultHost)) {
      data.defaultHost = data.hosts[0].name;
      saveHostsFile(configPath, data);
    }

    await registerWithClaude(p, configPath);
  } finally {
    p.close();
  }
}
