# windows-host-mcp

An **MCP server** that runs on Linux and gives an MCP agent (e.g. Claude Code) SSH access to a **Windows** machine — to build, test, run commands, transfer files, and drive long-running or interactive jobs.

```
┌──────────────┐   MCP (stdio)   ┌──────────────────┐   SSH / SFTP   ┌────────────────┐
│  Claude Code  │ ◄────────────► │ windows-host-mcp  │ ◄────────────► │ Windows machine │
│   (agent)     │                │  (this server)    │                │ (OpenSSH Server)│
└──────────────┘                 └──────────────────┘                 └────────────────┘
```

## Multiple hosts / devices

The server can manage **several Windows hosts at once** — e.g. a CUDA box and a ROCm box. Each host is defined in a JSON config with capability `labels`, and each keeps its own SSH connection, session (cwd/env), and jobs. The agent picks a device with `list_hosts` + `use_host`, or targets any host per call via the `host` parameter.

- `list_hosts` — see every host, its labels (`cuda`, `rocm`, …), which is active, and whether it's connected.
- `use_host` — switch the active device by `name` or by a `label` (e.g. `{ "label": "cuda" }`).
- Every command/file/job tool takes an optional `host` to override the active one for a single call.

Point the server at a JSON file with `WINDOWS_HOSTS_CONFIG` (see [`hosts.example.json`](./hosts.example.json)). A single host can still be configured with the flat `WINDOWS_SSH_*` env vars instead.

## Tools

| Tool | Purpose |
|---|---|
| `list_hosts` / `use_host` | List devices and switch the active host (by name or capability label). |
| `test_connection` | Verify SSH and report hostname + user. Run this first. |
| `run_command` | Run a one-shot command, wait, return stdout/stderr/exit code. |
| `start_job` | Start a long-running / interactive command; returns a `jobId`. |
| `get_job_output` | Poll new output (pass `sinceOffset`) + status + exit code. |
| `send_job_input` | Write to a running job's stdin (answer prompts, drive a REPL). |
| `cancel_job` | Stop a running job. |
| `list_jobs` | List jobs and their status. |
| `upload_file` / `download_file` | SFTP a file to / from Windows. |
| `list_remote_dir` | List a Windows directory. |
| `sync_dir` | Recursively copy a directory up (local→remote) or down. |
| `batch_upload` / `batch_download` | Transfer many files (by explicit list, regex, or whole folder) in one zip round-trip, with a write policy for conflicts. |
| `get_session` / `set_session` | Read / set default cwd, env, and shell that persist across calls. |

Commands run in **PowerShell** by default; each command tool accepts a `shell` of `powershell` \| `cmd` \| `bash` (WSL / Git-Bash).

## Prerequisites

- **Linux (this machine):** Node.js ≥ 18.
- **Windows (target):** OpenSSH Server installed and running, with your public key authorized.

## Install

Not published to the npm registry — clone and link it instead:

```bash
git clone https://github.com/thnak/windows-host-mcp.git
cd windows-host-mcp
git checkout v0.2.0   # pin to a release tag; omit to track main instead
npm install
npm link
```

`npm link` puts a `windows-host-mcp` binary on your PATH (a symlink back to this clone — `dist/` is committed to
the repo, so no separate build step is required). If `npm link` fails with an `EACCES` permission error, npm's
global prefix isn't user-writable; the standard fix is to point it at a directory you own, e.g.:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
# add ~/.npm-global/bin to your PATH (e.g. in ~/.bashrc), then re-run npm link
```

`windows-host-mcp update` (below) keeps this same checkout current, so there's no separate update mechanism to
learn.

> **Note:** `npm install -g git+https://...` (installing directly from a git URL without cloning) looks like it
> should work too, but hit real, reproducible corruption in testing on some npm versions — it silently dropped
> files from `dist/` and from a dependency's `dist/` during npm's git-dependency packing step. Until that's
> sorted out, `git clone` + `npm link` is the only install path this repo tests and recommends.

## CLI commands

| Command | Purpose |
|---|---|
| `windows-host-mcp` | Run the MCP server over stdio (default — this is what an MCP client invokes). |
| `windows-host-mcp config` | Interactive wizard: add/edit/remove hosts in `hosts.json`, then optionally register/update the server with Claude Code. |
| `windows-host-mcp update` | Check GitHub Releases for a newer tag, `git checkout` it in place, and reinstall dependencies. |
| `windows-host-mcp --version` | Print the installed version. |
| `windows-host-mcp --help` | Show usage. |

`windows-host-mcp config` is the fastest way to get set up: it prompts for each host's connection details, writes
them to `hosts.json` (default `~/.config/windows-host-mcp/hosts.json`, or wherever `WINDOWS_HOSTS_CONFIG` already
points), and then — if the `claude` CLI is on PATH — offers to run `claude mcp add`/`claude mcp remove` for you so
Claude Code picks up the change immediately. Re-run it any time to add another host or edit an existing one; it
loads whatever's already there. See "Configure the MCP client" below for the manual/scripted equivalent.

## Windows setup (one-time)

### 1. Install & start OpenSSH Server

In an **elevated PowerShell** on the Windows machine:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
# Firewall rule (usually created automatically):
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' `
  -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

### 2. Create a key pair (on Linux)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/windows_host_ed25519 -C "windows-host-mcp"
```

This produces `~/.ssh/windows_host_ed25519` (private — point the server at this) and `...pub` (public — install on Windows).

### 3. Authorize the public key on Windows

Copy the **contents of the `.pub` file** into the right file on Windows:

- **Normal (non-admin) user** → `C:\Users\<you>\.ssh\authorized_keys`
- **Administrator account** → `C:\ProgramData\ssh\administrators_authorized_keys`, and fix its ACLs:

```powershell
# For the administrators file only:
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r `
  /grant "Administrators:F" /grant "SYSTEM:F"
```

Test from Linux:

```bash
ssh -i ~/.ssh/windows_host_ed25519 <user>@<windows-host> hostname
```

### 4. (Optional) Make PowerShell the login shell

The server wraps every command in its chosen shell explicitly, so this is optional. If you also want interactive `ssh` sessions to land in PowerShell:

```powershell
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
  -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -PropertyType String -Force
```

## Configure the MCP client

`windows-host-mcp config` (above) does this for you interactively. This section is the manual/scripted
equivalent — useful for automation or if you'd rather edit files by hand. There are two ways to configure hosts:
**the JSON file for multiple hosts**, or the flat env vars for a single host. Examples below assume `windows-host-mcp`
is on PATH (via `npm link`, see Install); without that, replace `-- windows-host-mcp` with
`-- node /absolute/path/to/windows-host-mcp/dist/index.js`.

### Multiple hosts (recommended)

Write a `hosts.json` (see [`hosts.example.json`](./hosts.example.json)) and point `WINDOWS_HOSTS_CONFIG` at it:

```bash
claude mcp add windows-host-mcp -s user \
  --env WINDOWS_HOSTS_CONFIG=/absolute/path/to/hosts.json \
  -- windows-host-mcp
```

Each host entry accepts: `name` (required), `host` (required), `username` (required), `keyPath` (required, path to the **private** key on Linux), and optional `port`, `keyPassphrase`, `shell` (`powershell`|`cmd`|`bash`), `cwd`, `labels` (capability tags), `description`, `readyTimeoutMs`. The top-level `defaultHost` chooses which host is active on startup (defaults to the first).

### Single host (env vars)

For Claude Code:

```bash
claude mcp add windows-host-mcp -s user \
  --env WINDOWS_SSH_HOST=192.168.1.50 \
  --env WINDOWS_SSH_USER=builder \
  --env WINDOWS_SSH_KEY_PATH=/home/you/.ssh/windows_host_ed25519 \
  --env WINDOWS_SSH_DEFAULT_SHELL=powershell \
  -- windows-host-mcp
```

Or as raw MCP JSON config:

```json
{
  "mcpServers": {
    "windows-host-mcp": {
      "command": "windows-host-mcp",
      "env": {
        "WINDOWS_SSH_HOST": "192.168.1.50",
        "WINDOWS_SSH_PORT": "22",
        "WINDOWS_SSH_USER": "builder",
        "WINDOWS_SSH_KEY_PATH": "/home/you/.ssh/windows_host_ed25519",
        "WINDOWS_SSH_DEFAULT_SHELL": "powershell",
        "WINDOWS_SSH_DEFAULT_CWD": "C:\\build"
      }
    }
  }
}
```

### Configuration reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `WINDOWS_HOSTS_CONFIG` | — | — | Path to a multi-host JSON file. If set, the `WINDOWS_SSH_*` vars below are ignored. |
| `WINDOWS_SSH_HOST` | yes\* | — | Windows host name or IP. |
| `WINDOWS_SSH_PORT` | no | `22` | SSH port. |
| `WINDOWS_SSH_USER` | yes | — | SSH user on Windows. |
| `WINDOWS_SSH_KEY_PATH` | yes | — | Path (on Linux) to the **private** key. |
| `WINDOWS_SSH_KEY_PASSPHRASE` | no | — | Passphrase for the private key, if any. |
| `WINDOWS_SSH_DEFAULT_SHELL` | no | `powershell` | `powershell` \| `cmd` \| `bash`. |
| `WINDOWS_SSH_DEFAULT_CWD` | no | — | Default working directory on Windows. |
| `WINDOWS_SSH_READY_TIMEOUT_MS` | no | `20000` | SSH handshake timeout. |
| `WINDOWS_SSH_HOST_NAME` | no | `default` | Display name for the single env-configured host. |
| `WINDOWS_SSH_LABELS` | no | — | Comma-separated capability labels for the single host. |

\* Required only when `WINDOWS_HOSTS_CONFIG` is **not** set. See `.env.example` and `hosts.example.json`.

## Try it

Inspect the tools interactively with the MCP Inspector (env vars must be set in your shell):

```bash
npm run inspect
```

Typical agent flow:

1. `list_hosts` → see devices; `use_host { "label": "cuda" }` → target the CUDA box.
2. `test_connection` → confirms hostname + user.
3. `set_session { "cwd": "C:\\src\\MyApp" }` → work from one directory.
4. `run_command { "command": "nvidia-smi" }`.
5. `start_job { "command": "dotnet build MyApp.sln" }` → poll `get_job_output` until `status: exited`.
6. `download_file { "remotePath": "C:/src/MyApp/bin/Release/app.zip", "localPath": "/tmp/app.zip" }`.
7. `use_host { "label": "rocm" }` → run the same build on the ROCm box (its own session & jobs).

## Notes & caveats

- **One host per server instance.** To reach several Windows machines, register multiple instances with different names/env.
- **Signals on Windows OpenSSH are unreliable.** `cancel_job` sends a signal and closes the channel; for a stubborn process, run `taskkill /PID <pid> /F` (or `/IM <image>`) via `run_command`.
- **`pty: true`** allocates a terminal (needed for programs that demand a TTY / interactive prompts) but merges stdout and stderr; leave it off for clean build logs.
- **Output is capped** (~1 MB per stream for `run_command`, ~5 MB buffered per job) to protect the agent's context; truncation is flagged in the result.
- **`batch_upload`** zips the selected files locally, sends them in one SFTP transfer, and unpacks with PowerShell's built-in `Expand-Archive` — no extra tooling needed on either side. Select files via `files` (explicit relative paths), `pattern` (regex over paths relative to `localDir`), or neither (whole folder, recursive by default). `writePolicy` controls collisions with existing remote files: `overwrite` (default) always replaces, `keep-newer` replaces only if the local file's mtime is newer (zip timestamps have ~2s resolution), `skip-existing` never touches an existing file.
- **`batch_download`** is the mirror: files are selected and zipped *on the Windows host* with PowerShell's built-in `Compress-Archive`, pulled down in one SFTP transfer, and unpacked here. Same `files` / `pattern` / whole-folder selection (relative to `remoteDir` this time) and the same `writePolicy` semantics, applied to local files instead of remote ones.
- **Secrets:** the private key stays on Linux; only its path is passed via env. Keep keys out of the repo (`.gitignore` covers `*.key`, `id_*`, `.env`).
- **Updating:** run `windows-host-mcp update` — it checks GitHub Releases for a newer tag, then runs `git fetch`/`git checkout <tag>`/`npm install` in your existing clone (the same one `npm link` pointed the binary at). Restart (or reconnect) any running MCP client session afterward so it picks up the new build.

## Development

```bash
npm run dev     # tsx watch mode
npm run check   # type-check only
npm run build   # emit dist/
```
