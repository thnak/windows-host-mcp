import { spawnSync } from "node:child_process";
import { VERSION } from "./version.js";

const REPO = "thnak/windows-host-mcp";

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

/**
 * Self-update: check GitHub Releases for a newer tag than the running
 * version, then reinstall globally from that tag via `npm install -g
 * git+https://...#<tag>`. There's no npm-registry publish for this package,
 * so "install from a pinned git tag" is the update mechanism end to end —
 * the same command works for a first install (see README) and for updates.
 */
export async function runUpdate(): Promise<void> {
  process.stdout.write(`Current version: v${VERSION}\n`);
  process.stdout.write("Checking for updates...\n");

  const release = await fetchLatestRelease();
  const latest = normalizeTag(release.tag_name);

  if (latest === VERSION) {
    process.stdout.write(`Already up to date (v${VERSION}).\n`);
    return;
  }

  process.stdout.write(`New version available: v${latest} (current: v${VERSION})\n`);
  process.stdout.write(`Installing from ${release.tag_name}...\n\n`);

  const gitUrl = `git+https://github.com/${REPO}.git#${release.tag_name}`;
  const install = spawnSync("npm", ["install", "-g", gitUrl], { stdio: "inherit" });

  if (install.status !== 0) {
    throw new Error(`npm install failed. You can update manually with:\n  npm install -g ${gitUrl}`);
  }

  process.stdout.write(
    `\nUpdated to v${latest}. Restart any running windows-host-mcp process (or reconnect it from your MCP ` +
      "client) to pick it up.\n",
  );
}
