import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipFile } from "yazl";
import type { LocalFileEntry } from "./localFiles.js";

/** Monotonic counter for local temp zip names — deterministic within a process. */
let zipCounter = 0;

/** A fresh path under the OS temp dir for a batch-transfer zip; caller owns cleanup via removeZip(). */
export function tmpZipPath(tag: string): string {
  zipCounter += 1;
  return join(tmpdir(), `whmcp-batch-${tag}-${process.pid}-${zipCounter}.zip`);
}

/**
 * Pack files into a local zip (relative paths + mtimes preserved so the
 * remote side can apply write policies like keep-newer). Caller owns the
 * returned path and must removeZip() it when done.
 */
export async function buildZip(files: LocalFileEntry[]): Promise<string> {
  const outPath = tmpZipPath("up");
  const zip = new ZipFile();
  for (const f of files) {
    zip.addFile(f.absPath, f.relPath, { mtime: new Date(f.mtimeMs) });
  }
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(outPath);
    ws.on("close", resolve);
    ws.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(ws);
    zip.end();
  });
  return outPath;
}

export async function removeZip(path: string): Promise<void> {
  await unlink(path).catch(() => {
    /* best-effort cleanup */
  });
}
