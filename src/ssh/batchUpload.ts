import type { SshConnection } from "./connection.js";
import { runCommand } from "./exec.js";
import { uploadFile } from "./sftp.js";
import { buildZip, removeZip } from "../zip.js";
import type { LocalFileEntry } from "../localFiles.js";

export type WritePolicy = "overwrite" | "keep-newer" | "skip-existing";

export type BatchFileAction = "uploaded" | "overwritten" | "skipped" | "error";

export interface BatchFileResult {
  path: string;
  action: BatchFileAction;
  reason?: string;
}

export interface BatchUploadResult {
  files: BatchFileResult[];
  uploaded: number;
  overwritten: number;
  skipped: number;
  errors: number;
}

/** Escape a value for a PowerShell single-quoted string ('' escapes a quote). */
function psq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function summarize(files: BatchFileResult[]): BatchUploadResult {
  return {
    files,
    uploaded: files.filter((f) => f.action === "uploaded").length,
    overwritten: files.filter((f) => f.action === "overwritten").length,
    skipped: files.filter((f) => f.action === "skipped").length,
    errors: files.filter((f) => f.action === "error").length,
  };
}

/**
 * Expand a zip already uploaded to `remoteZipPath` into `remoteDir`, applying
 * a per-file write policy against whatever already exists there:
 *   - overwrite: always replace.
 *   - keep-newer: replace only when the zipped file's mtime is newer than the
 *     existing remote file's (a fresh file, i.e. no existing counterpart,
 *     always lands).
 *   - skip-existing: never touch a path that already exists remotely.
 * The zip is extracted to a scratch dir under %TEMP% so a partial/aborted
 * run never leaves stray files directly in remoteDir; both the scratch dir
 * and the uploaded zip are removed afterwards.
 */
async function extractWithPolicy(
  conn: SshConnection,
  remoteZipPath: string,
  remoteDir: string,
  policy: WritePolicy,
): Promise<BatchFileResult[]> {
  const script = `
$ErrorActionPreference = 'Stop'
$zipPath = ${psq(remoteZipPath)}
$destRoot = ${psq(remoteDir)}
$policy = ${psq(policy)}
$staging = Join-Path $env:TEMP ('whmcp-batch-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
New-Item -ItemType Directory -Path $destRoot -Force | Out-Null
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $staging -Force
  $results = @()
  Get-ChildItem -LiteralPath $staging -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($staging.Length).TrimStart('\\', '/')
    $dest = Join-Path $destRoot $rel
    $destDir = Split-Path $dest -Parent
    try {
      if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
      $exists = Test-Path -LiteralPath $dest
      $action = 'uploaded'
      if ($exists) {
        if ($policy -eq 'skip-existing') {
          $action = 'skipped'
        } elseif ($policy -eq 'keep-newer') {
          $destItem = Get-Item -LiteralPath $dest
          if ($_.LastWriteTimeUtc -gt $destItem.LastWriteTimeUtc) { $action = 'overwritten' } else { $action = 'skipped' }
        } else {
          $action = 'overwritten'
        }
      }
      if ($action -ne 'skipped') {
        Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
      }
      $results += [pscustomobject]@{ path = $rel.Replace('\\', '/'); action = $action }
    } catch {
      $results += [pscustomobject]@{ path = $rel.Replace('\\', '/'); action = 'error'; reason = $_.Exception.Message }
    }
  }
  $results | ConvertTo-Json -Depth 3
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
}`.trim();

  const res = await runCommand(conn, { command: script, shell: "powershell", timeoutMs: 180_000 });
  const raw = res.stdout.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse batch-upload extraction output: ${raw.slice(0, 500)}`);
  }
  return Array.isArray(parsed) ? (parsed as BatchFileResult[]) : [parsed as BatchFileResult];
}

/**
 * Zip the given local files, upload the zip in one SFTP transfer, and unpack
 * it on the remote side applying `policy` to any name collisions. Cleans up
 * both the local and remote zip regardless of outcome.
 */
export async function batchUpload(
  conn: SshConnection,
  files: LocalFileEntry[],
  remoteDir: string,
  policy: WritePolicy,
): Promise<BatchUploadResult> {
  const zipPath = await buildZip(files);
  try {
    const remoteZip = `${remoteDir.replace(/\\/g, "/")}/.whmcp-batch-${Date.now()}.zip`;
    await ensureRemoteDir(conn, remoteDir);
    const uploaded = await uploadFile(conn, zipPath, remoteZip);
    const results = await extractWithPolicy(conn, uploaded, remoteDir, policy);
    return summarize(results);
  } finally {
    await removeZip(zipPath);
  }
}

/** Create remoteDir (and any missing parents) via PowerShell — SFTP mkdir alone can't create nested paths. */
async function ensureRemoteDir(conn: SshConnection, remoteDir: string): Promise<void> {
  await runCommand(conn, {
    command: `New-Item -ItemType Directory -Path ${psq(remoteDir)} -Force | Out-Null`,
    shell: "powershell",
    timeoutMs: 30_000,
  });
}
