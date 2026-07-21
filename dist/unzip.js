import { createWriteStream, existsSync } from "node:fs";
import { mkdir, stat, utimes } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
/** Reject entries whose name would extract outside destDir (zip-slip guard). */
function resolveEntryPath(destDir, entryName) {
    const dest = join(destDir, entryName);
    const rel = relative(destDir, dest);
    if (rel.startsWith("..") || rel === "")
        return null;
    return dest;
}
async function extractEntry(zipfile, entry, destPath, policy) {
    const path = entry.fileName;
    let action = "downloaded";
    if (existsSync(destPath)) {
        if (policy === "skip-existing") {
            return { path, action: "skipped" };
        }
        if (policy === "keep-newer") {
            const destStat = await stat(destPath);
            action = entry.getLastModDate().getTime() > destStat.mtimeMs ? "overwritten" : "skipped";
        }
        else {
            action = "overwritten";
        }
    }
    if (action === "skipped")
        return { path, action };
    await mkdir(dirname(destPath), { recursive: true });
    const readStream = await zipfile.openReadStreamPromise(entry);
    await pipeline(readStream, createWriteStream(destPath));
    const mtime = entry.getLastModDate();
    await utimes(destPath, mtime, mtime).catch(() => {
        /* best-effort; some filesystems reject sub-second/very old mtimes */
    });
    return { path, action };
}
/**
 * Extract a zip (built remotely by batch_download) into destDir, applying
 * the same write-policy semantics as batch_upload but in reverse: an
 * existing local file is kept under skip-existing, replaced only if the
 * zipped (remote) copy is newer under keep-newer, and always replaced under
 * overwrite.
 */
export async function extractZipWithPolicy(zipPath, destDir, policy) {
    await mkdir(destDir, { recursive: true });
    const results = [];
    const zipfile = await yauzl.openPromise(zipPath);
    try {
        for await (const entry of zipfile.eachEntry()) {
            if (/\/$/.test(entry.fileName))
                continue; // directory entry
            const destPath = resolveEntryPath(destDir, entry.fileName);
            if (!destPath) {
                results.push({ path: entry.fileName, action: "error", reason: "Unsafe path (escapes destination)." });
                continue;
            }
            try {
                results.push(await extractEntry(zipfile, entry, destPath, policy));
            }
            catch (err) {
                results.push({ path: entry.fileName, action: "error", reason: err.message });
            }
        }
    }
    finally {
        zipfile.close();
    }
    return results;
}
//# sourceMappingURL=unzip.js.map