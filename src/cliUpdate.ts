import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VERSION } from "./version.js";

const REPO = "thnak/windows-host-mcp";

/** Package root: dist/cliUpdate.js -> dist/ -> root. Same layout dev (src/) and installed (dist/) both satisfy. */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

interface GithubRelease {
  tag_name: string;
}

function normalizeTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "windows-host-mcp-cli" },
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} ${res.statusText} while checking for updates.`);
  }
  return (await res.json()) as GithubRelease;
}

function isGitCheckout(): boolean {
  const res = spawnSync("git", ["-C", PACKAGE_ROOT, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  return !res.error && res.status === 0;
}

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { cwd: PACKAGE_ROOT, stdio: "inherit" });
  if (res.error || res.status !== 0) {
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed in ${PACKAGE_ROOT}.`);
  }
}

/**
 * Self-update: this package has no npm-registry publish, so it's installed
 * as a git checkout (see README — `git clone` + `npm link`). Updating is
 * therefore a git operation done in place: fetch tags, check out the latest
 * release tag, and reinstall dependencies. dist/ is committed to the repo
 * (see CLAUDE.md for why), so a checkout alone leaves a working build —
 * no rebuild step needed.
 */
export async function runUpdate(): Promise<void> {
  process.stdout.write(`Current version: v${VERSION}\n`);

  if (!isGitCheckout()) {
    process.stdout.write(
      `\n${PACKAGE_ROOT} isn't a git checkout, so it can't be updated in place.\n` +
        "Reinstall following the README's Install steps instead:\n" +
        "  git clone https://github.com/thnak/windows-host-mcp.git\n" +
        "  cd windows-host-mcp && git checkout <latest tag> && npm install && npm link\n",
    );
    return;
  }

  process.stdout.write("Checking for updates...\n");
  const release = await fetchLatestRelease();
  const latest = normalizeTag(release.tag_name);

  if (latest === VERSION) {
    process.stdout.write(`Already up to date (v${VERSION}).\n`);
    return;
  }

  process.stdout.write(`New version available: v${latest} (current: v${VERSION})\n`);
  process.stdout.write(`Updating ${PACKAGE_ROOT} to ${release.tag_name}...\n\n`);

  run("git", ["fetch", "--tags", "--quiet"]);
  run("git", ["checkout", release.tag_name]);
  run("npm", ["install"]);

  process.stdout.write(
    `\nUpdated to v${latest}. Restart any running windows-host-mcp process (or reconnect it from your MCP ` +
      "client) to pick it up.\n",
  );
}
