import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
function toPosix(p) {
    return p.split(sep).join("/");
}
async function walk(dir, baseDir, recursive, out) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (recursive)
                await walk(abs, baseDir, recursive, out);
            continue;
        }
        if (!entry.isFile())
            continue;
        const st = await stat(abs);
        out.push({ absPath: abs, relPath: toPosix(relative(baseDir, abs)), size: st.size, mtimeMs: st.mtimeMs });
    }
}
/** Recursively (or shallowly) list every file under baseDir, relative paths in posix form. */
export async function listLocalFiles(baseDir, recursive) {
    const out = [];
    await walk(baseDir, baseDir, recursive, out);
    return out;
}
/**
 * Resolve the set of local files for a batch upload: an explicit list, a
 * regex over baseDir's contents, or (when neither is given) every file in
 * baseDir.
 */
export async function selectLocalFiles(input) {
    if (input.files && input.files.length > 0) {
        const results = [];
        for (const rel of input.files) {
            const abs = join(input.baseDir, rel);
            let st;
            try {
                st = await stat(abs);
            }
            catch {
                throw new Error(`File not found: ${rel} (resolved to ${abs})`);
            }
            if (!st.isFile())
                throw new Error(`Not a file: ${rel} (resolved to ${abs})`);
            results.push({ absPath: abs, relPath: toPosix(rel), size: st.size, mtimeMs: st.mtimeMs });
        }
        return results;
    }
    const all = await listLocalFiles(input.baseDir, input.recursive);
    if (input.pattern) {
        let re;
        try {
            re = new RegExp(input.pattern);
        }
        catch (err) {
            throw new Error(`Invalid regex pattern: ${err.message}`);
        }
        return all.filter((f) => re.test(f.relPath));
    }
    return all;
}
//# sourceMappingURL=localFiles.js.map