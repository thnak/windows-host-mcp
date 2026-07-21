# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server (Node/TypeScript, stdio transport) that gives an MCP agent SSH access to one or more **Windows** machines — running commands, transferring files, and driving long-running/interactive jobs, all over `ssh2`. It's the `windows-host` MCP server available in this session (`mcp__windows-host__*` tools).

## Commands

```bash
npm run dev      # tsx watch src/index.ts — run against live env vars
npm run check    # tsc --noEmit — type-check only, fastest correctness check
npm run build    # tsc → dist/
npm run inspect  # npx @modelcontextprotocol/inspector node dist/index.js — interactive tool testing
```

No test suite exists in this repo. `npm run check` is the main correctness gate before committing.

The server needs a host configuration to start (`WINDOWS_HOSTS_CONFIG` pointing at a JSON file, or the flat `WINDOWS_SSH_*` env vars — see README.md and `hosts.example.json`/`.env.example`). Without one, `loadConfig()` in `src/config.ts` throws immediately.

Published only via GitHub (no npm registry publish access from this environment) — releases are git tags (`vX.Y.Z`) on `github.com/thnak/windows-host-mcp`, installed with `npm install -g git+https://github.com/thnak/windows-host-mcp.git#v<version>`. `package.json`'s `prepare` script (`npm run build`) is what makes a git-sourced `npm install` produce a working `dist/` — don't remove it.

## Architecture

`index.ts` is now a thin CLI dispatcher (see "CLI" below), not the server itself — the server bootstrap lives in `server.ts`. Layered, single-direction dependency flow below it:

```
index.ts            CLI dispatcher (bin entry): argv → runServer() / runConfig() / runUpdate()
server.ts             runServer(): loadConfig() → HostManager → registerAllTools() → stdio transport
version.ts             reads the installed package.json's version at runtime (dist/../package.json)
cliConfig.ts            `config` subcommand: interactive hosts.json wizard + `claude mcp add` registration
cliUpdate.ts             `update` subcommand: GitHub Releases API → `npm install -g git+...#<tag>`
cliPrompt.ts             Prompter: queued-line stdin reader (readline/promises drops buffered lines — see below)
config.ts            parses WINDOWS_HOSTS_CONFIG JSON or WINDOWS_SSH_* env into AppConfig/HostConfig
hostManager.ts        owns every configured Host, tracks the "active" one, routes jobId → owning host
session.ts            per-host in-memory cwd/env/shell defaults (the "cd once, stays set" state)
shell.ts               wraps a raw command string for the target shell (powershell/cmd/bash)
localFiles.ts         local file selection for batch_upload (explicit list / regex / whole-folder walk)
zip.ts                 builds/names local zips (yazl) for batch_upload and batch_download, preserving mtimes
unzip.ts                extracts a zip (yauzl) for batch_download, applying writePolicy + a zip-slip guard
ssh/                    low-level ssh2 plumbing, no MCP awareness
  connection.ts           lazy singleton SSH client per host; exec()/sftp() channel factories
  exec.ts                  one-shot command execution with output caps + timeout (used by run_command)
  jobs.ts                  JobRegistry: long-running/interactive commands, streamed output buffer
  sftp.ts                  upload/download/list/syncDir over SFTP
  probe.ts                 get_host_info / check_tools — PowerShell probe scripts, JSON round-trip
  batchUpload.ts           batch_upload: upload the zip once, Expand-Archive + per-file write-policy on the remote
  batchDownload.ts         batch_download: select+Compress-Archive remotely, download the zip once, unzip locally
tools/                  MCP tool registration, one file per tool group, all wired in index.ts
  context.ts               AppContext type + result()/errorResult() response helpers
  hosts.ts, runCommand.ts, jobs.ts, files.ts, session.ts, probe.ts, output.ts
```

**Multi-host model.** `HostManager` holds a `Map<name, Host>`, each `Host` bundling its own `SshConnection`, `Session`, and `JobRegistry` — hosts are fully independent (separate TCP connection, cwd/env state, job list). One host is "active" at a time (`use_host` by name or by a capability `label`, e.g. `cuda`/`rocm`); every command/file/job tool also accepts a per-call `host` override via `ctx.manager.resolve(host)`. Job IDs are a single monotonic counter shared across all hosts, so `getJobOutput`/`sendJobInput`/`cancelJob` look up the owning host without a host argument.

**Command execution.** Every command tool builds a raw string and passes it through `wrapCommand()` in `shell.ts`, which is shell-specific:
- **powershell** (default): builds a script (env vars, `Set-Location`, the command, `exit $LASTEXITCODE`), then base64/UTF16LE-encodes it as `-EncodedCommand` — this sidesteps all SSH/PowerShell quoting issues entirely, so command strings never need escaping for this path.
- **cmd**: best-effort `cmd.exe /s /c "..."` chaining — quoting is fragile by nature of cmd.exe itself.
- **bash**: `bash -lc '...'` (WSL / Git-Bash on the Windows box).

`exec.ts` (one-shot, used by `run_command`) and `jobs.ts` (long-running, used by `start_job`) both call `wrapCommand()` but differ in the `interactive` flag: jobs pass `interactive: true` to skip `-NonInteractive` so stdin-driven/interactive programs still work via `send_job_input`.

**Output capping.** Both one-shot (`exec.ts`, ~1 MB per stream) and job output (`jobs.ts`, ~5 MB buffered) cap retained output and set a `*Truncated` flag rather than growing unbounded — this protects the calling agent's context window. `tools/output.ts` (`capAndSave`) additionally spills large directory listings to a `.whmcp-tmp/` temp file when they'd flood the reply.

**Batch upload/download.** Both trade per-file SFTP round-trips for a single zip transfer, and are near-mirrors of each other with the "which side runs the shell script" flipped:
- `batch_upload` (`tools/files.ts` + `ssh/batchUpload.ts`): `localFiles.ts` resolves the local file set (explicit `files` list, `pattern` regex over relative paths, or a full recursive walk), `zip.ts` packs them with `yazl` (preserving relative paths and mtimes), the zip is SFTP'd up once, then a PowerShell script `Expand-Archive`s it into a scratch dir under `%TEMP%` on the *remote* side and copies each file into place applying `writePolicy`.
- `batch_download` (`tools/files.ts` + `ssh/batchDownload.ts`): the selection step runs as a PowerShell script instead (same three modes, `Get-ChildItem -Recurse` + a .NET `Regex` for pattern mode), which stages matches under `%TEMP%` and `Compress-Archive`s them; the zip is SFTP'd down once and `unzip.ts` (`yauzl`) extracts it *locally*, applying `writePolicy` and a zip-slip path guard.

Both share the `WritePolicy` union (`overwrite` / `keep-newer` — compares mtimes, ~2s zip resolution / `skip-existing`), exported from `ssh/batchUpload.ts` and re-used by `batchDownload.ts` and `unzip.ts` — change conflict-resolution semantics there once for both directions. Zip was chosen because both ends need nothing beyond what's already assumed: PowerShell 5+ ships `Expand-Archive`/`Compress-Archive`, and Node gets `yazl` (write) + `yauzl` (read) as the only new dependencies.

**Tool response shape.** Every tool handler wraps success in `result(structuredObject, optionalText)` and failure in `errorResult(err)` (both in `tools/context.ts`) — structured content plus a human-readable text summary, with errors marked via `isError: true` rather than thrown across the MCP boundary. Follow this pattern for any new tool.

**Adding a new tool:** create/extend a file in `src/tools/`, register it with `server.registerTool(name, { title, description, inputSchema: {...zod...} }, handler)`, resolve the target host via `ctx.manager.resolve(host)` (optional `host` param, `hostParam` zod schema pattern in `files.ts`), and wire the registration function into `registerAllTools()` in `tools/index.ts`.

**CLI.** `windows-host-mcp` with no args runs the MCP server (`runServer()`) — this must stay the default with zero side effects beyond that, since it's what every MCP client invokes. `config` and `update` are separate, human-invoked subcommands, dispatched in `index.ts` by a plain `process.argv.slice(2)` switch (no argv-parsing dependency; keep it that way unless the surface grows a lot). `cliConfig.ts`'s wizard uses `cliPrompt.ts`'s `Prompter` instead of `node:readline/promises`'s `question()` — the promises API attaches a fresh one-shot `'line'` listener per call, but on a non-TTY (piped) stdin, readline emits every buffered line synchronously as soon as data arrives, so any line that arrives before the *next* `question()` call attaches its listener is silently dropped and that call hangs forever. `Prompter` keeps a single listener attached for the interface's lifetime and queues lines, which is correct for both piped input (scripted/CI use) and a human typing at a terminal. Registration with Claude Code shells out to `claude mcp remove`/`claude mcp add` (see `claude mcp add --help` for the exact non-interactive flags) rather than hand-editing Claude's settings JSON.

## Notes carried over from README (non-obvious, worth knowing while coding)

- Signals over Windows OpenSSH are unreliable — `cancel_job`/timeout paths in `jobs.ts`/`exec.ts` both attempt `channel.signal("KILL")` but treat it as best-effort and also close the channel; don't assume the remote process actually died without checking (`taskkill /F` is the documented workaround for callers).
- `pty: true` merges stdout/stderr (needed for TTY-requiring interactive programs) — this is why `jobs.ts` only attaches a separate `stderr` listener `if (!pty)`.
- Secrets: only key **paths** are passed via env/JSON config, never key contents; keep private keys out of the repo (`.gitignore` already excludes `*.key`, `*.pem`, `id_*`, `.env`).
