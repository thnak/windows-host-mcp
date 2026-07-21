import { runCommand } from "./exec.js";
import { downloadFile } from "./sftp.js";
import { tmpZipPath, removeZip } from "../zip.js";
import { extractZipWithPolicy } from "../unzip.js";
/** Escape a value for a PowerShell single-quoted string ('' escapes a quote). */
function psq(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
/** PowerShell array literal of single-quoted strings. */
function psArray(values) {
    return `@(${values.map(psq).join(", ")})`;
}
/**
 * Select files under remoteDir (explicit list, regex, or whole folder),
 * stage them (preserving relative structure) under %TEMP%, and Compress-Archive
 * them into a single zip. Returns null zipPath when nothing matched.
 */
async function buildRemoteZip(conn, remoteDir, selection) {
    const hasExplicit = !!selection.files && selection.files.length > 0;
    const explicitFiles = hasExplicit ? psArray(selection.files) : "$null";
    const pattern = selection.pattern ? psq(selection.pattern) : "$null";
    const script = `
$ErrorActionPreference = 'Stop'
$root = ${psq(remoteDir)}
$explicitFiles = ${explicitFiles}
$pattern = ${pattern}
$recursive = $${selection.recursive ? "true" : "false"}
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Remote directory not found: $root" }
$root = (Resolve-Path -LiteralPath $root).Path

if ($explicitFiles) {
  $items = @()
  $missing = @()
  foreach ($rel in $explicitFiles) {
    $p = Join-Path $root $rel
    if (Test-Path -LiteralPath $p -PathType Leaf) { $items += Get-Item -LiteralPath $p } else { $missing += $rel }
  }
  if ($missing.Count -gt 0) { throw "File(s) not found under $root: $($missing -join ', ')" }
} else {
  $gciParams = @{ LiteralPath = $root; File = $true }
  if ($recursive) { $gciParams.Recurse = $true }
  $all = @(Get-ChildItem @gciParams)
  if ($pattern) {
    $re = New-Object System.Text.RegularExpressions.Regex($pattern)
    $items = @($all | Where-Object { $re.IsMatch(($_.FullName.Substring($root.Length).TrimStart('\\', '/')).Replace('\\', '/')) })
  } else {
    $items = $all
  }
}

if ($items.Count -eq 0) {
  '{"zipPath":null,"files":[]}'
} else {
  $staging = Join-Path $env:TEMP ('whmcp-batch-dl-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  try {
    $relPaths = @()
    foreach ($it in $items) {
      $rel = $it.FullName.Substring($root.Length).TrimStart('\\', '/')
      $dest = Join-Path $staging $rel
      $destDir = Split-Path $dest -Parent
      if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
      Copy-Item -LiteralPath $it.FullName -Destination $dest -Force
      $relPaths += $rel.Replace('\\', '/')
    }
    $zipPath = Join-Path $env:TEMP ('whmcp-batch-dl-' + [guid]::NewGuid().ToString('N') + '.zip')
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -Force
    [pscustomobject]@{ zipPath = $zipPath; files = @($relPaths) } | ConvertTo-Json -Depth 3
  } finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}`.trim();
    const res = await runCommand(conn, { command: script, shell: "powershell", timeoutMs: 180_000 });
    const raw = res.stdout.trim();
    if (!raw)
        throw new Error("No output from remote file-selection script.");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Could not parse remote selection output: ${raw.slice(0, 500)}`);
    }
    return {
        zipPath: parsed.zipPath ?? null,
        files: Array.isArray(parsed.files) ? parsed.files : parsed.files ? [parsed.files] : [],
    };
}
async function cleanupRemoteZip(conn, remoteZipPath) {
    await runCommand(conn, {
        command: `Remove-Item -LiteralPath ${psq(remoteZipPath)} -Force -ErrorAction SilentlyContinue`,
        shell: "powershell",
        timeoutMs: 30_000,
    }).catch(() => {
        /* best-effort cleanup */
    });
}
function summarize(files) {
    return {
        files,
        downloaded: files.filter((f) => f.action === "downloaded").length,
        overwritten: files.filter((f) => f.action === "overwritten").length,
        skipped: files.filter((f) => f.action === "skipped").length,
        errors: files.filter((f) => f.action === "error").length,
    };
}
/**
 * Select files on the Windows host (explicit list / regex / whole folder),
 * bundle them into a single zip remotely, download that zip in one SFTP
 * transfer, and unpack it locally applying `policy` to any name collisions.
 * Cleans up both the remote and local zip regardless of outcome.
 */
export async function batchDownload(conn, remoteDir, localDir, policy, selection) {
    const remote = await buildRemoteZip(conn, remoteDir, selection);
    if (!remote.zipPath)
        return summarize([]);
    const localZip = tmpZipPath("dl");
    try {
        await downloadFile(conn, remote.zipPath, localZip);
        const results = await extractZipWithPolicy(localZip, localDir, policy);
        return summarize(results);
    }
    finally {
        await removeZip(localZip);
        await cleanupRemoteZip(conn, remote.zipPath);
    }
}
//# sourceMappingURL=batchDownload.js.map