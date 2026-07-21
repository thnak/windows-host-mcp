import { runCommand } from "./exec.js";
/** Escape a value for a PowerShell single-quoted string. */
function psq(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
/** Escape a value for a bash single-quoted string. */
function bashq(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
/**
 * Check whether a path exists on the host and is a directory. Uses the shell's
 * own path semantics: bash paths (WSL/Git-Bash) are tested with `test -d`,
 * everything else with PowerShell's Test-Path (reliable for Windows paths).
 */
export async function dirExists(conn, shell, path) {
    if (shell === "bash") {
        const res = await runCommand(conn, {
            command: `test -d ${bashq(path)} && echo __YES__ || echo __NO__`,
            shell,
            timeoutMs: 15_000,
        });
        return res.stdout.includes("__YES__");
    }
    const res = await runCommand(conn, {
        command: `if (Test-Path -LiteralPath ${psq(path)} -PathType Container) { 'YES' } else { 'NO' }`,
        shell: "powershell",
        timeoutMs: 15_000,
    });
    return res.stdout.trim().startsWith("YES");
}
/** Tools probed by default in get_host_info. */
export const DEFAULT_TOOLS = [
    "git",
    "node",
    "npm",
    "python",
    "dotnet",
    "cmake",
    "docker",
    "pwsh",
    "bash",
    "wsl",
    "nvcc",
    "go",
    "java",
    "cl",
];
/**
 * Best-effort version flag per tool; tools not listed are presence-only.
 * bash/wsl are intentionally absent — their `--version` over SSH is unreliable
 * (WSL emits UTF-16 and errors when no distro is installed).
 */
const VERSION_FLAGS = {
    git: "--version",
    node: "--version",
    npm: "--version",
    python: "--version",
    dotnet: "--version",
    cmake: "--version",
    docker: "--version",
    pwsh: "--version",
    nvcc: "--version",
    go: "version",
    java: "-version",
};
/** PowerShell fragment that resolves a tool list to name/found/path/version objects. */
function toolProbeScript(tools, emit) {
    const psList = tools.map((t) => `'${t.replace(/'/g, "''")}'`).join(",");
    const flagPairs = Object.entries(VERSION_FLAGS)
        .map(([k, v]) => `'${k}'='${v}'`)
        .join(";");
    return `
$tools = @(${psList})
$flags = @{${flagPairs}}
$toolInfo = foreach ($t in $tools) {
  $cmd = Get-Command $t -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) {
    $ver = $null
    if ($flags.ContainsKey($t)) {
      # ToString() on the first record avoids PowerShell formatting a native
      # tool's stderr (e.g. 'java -version') as a NativeCommandError block.
      try {
        $raw = & $t $flags[$t] 2>&1 | Select-Object -First 1
        if ($raw) { $ver = $raw.ToString().Trim() }
      } catch { $ver = $null }
    }
    [pscustomobject]@{ name=$t; found=$true; path=$cmd.Source; version=$ver }
  } else {
    [pscustomobject]@{ name=$t; found=$false; path=$null; version=$null }
  }
}
${emit}`.trim();
}
/** Parse a PS ConvertTo-Json result that may collapse a 1-element array to an object. */
function asArray(parsed) {
    if (Array.isArray(parsed))
        return parsed;
    if (parsed == null)
        return [];
    return [parsed];
}
/** Check presence + best-effort version of specific tools on the host. */
export async function checkTools(conn, tools) {
    const script = toolProbeScript(tools, "$toolInfo | ConvertTo-Json -Depth 3");
    const res = await runCommand(conn, { command: script, shell: "powershell", timeoutMs: 60_000 });
    try {
        return asArray(JSON.parse(res.stdout.trim() || "[]"));
    }
    catch {
        throw new Error(`Could not parse tool probe output: ${res.stdout.slice(0, 500)}`);
    }
}
/** Gather OS/user/shell/tool/PATH information in a single round-trip. */
export async function getHostInfo(conn, tools) {
    const emit = `
$out = [ordered]@{
  os = $(try { (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction Stop).ProductName } catch { (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption })
  osVersion = [System.Environment]::OSVersion.Version.ToString()
  hostname = [System.Net.Dns]::GetHostName()
  user = $env:USERNAME
  homeCwd = (Get-Location).Path
  path = @($env:PATH -split ';' | Where-Object { $_ })
  tools = @($toolInfo)
}
$out | ConvertTo-Json -Depth 5`;
    const script = toolProbeScript(tools, emit);
    const res = await runCommand(conn, { command: script, shell: "powershell", timeoutMs: 60_000 });
    let parsed;
    try {
        parsed = JSON.parse(res.stdout.trim() || "{}");
    }
    catch {
        throw new Error(`Could not parse host info output: ${res.stdout.slice(0, 500)}`);
    }
    return {
        os: parsed.os ?? null,
        osVersion: parsed.osVersion ?? null,
        hostname: parsed.hostname ?? null,
        user: parsed.user ?? null,
        homeCwd: parsed.homeCwd ?? null,
        path: Array.isArray(parsed.path) ? parsed.path : [],
        tools: asArray(parsed.tools),
    };
}
//# sourceMappingURL=probe.js.map