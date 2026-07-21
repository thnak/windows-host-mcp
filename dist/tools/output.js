import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Guards against flooding the agent's context with large tool output. Anything
 * bigger than the inline caps below is written to a temp file under
 * .whmcp-tmp/ (relative to the server's working directory) and only a tail /
 * head slice is returned inline, alongside the saved path so the agent can
 * fetch or grep the full content on demand.
 */
const TMP_DIR = join(process.cwd(), ".whmcp-tmp");
/** Characters of text kept inline before we spill to a file. ~16 KB. */
const INLINE_CHARS = 16_384;
/** Directory entries kept inline before we spill to a file. */
const INLINE_ENTRIES = 500;
/** Monotonic counter for temp filenames — deterministic within a process. */
let fileCounter = 0;
function nextFile(kind, ext) {
    fileCounter += 1;
    mkdirSync(TMP_DIR, { recursive: true });
    return join(TMP_DIR, `${kind}-${fileCounter}.${ext}`);
}
/** Human-readable size for a character/byte count. */
export function formatSize(chars) {
    if (chars < 1024)
        return `${chars} B`;
    if (chars < 1024 * 1024)
        return `${(chars / 1024).toFixed(1)} KB`;
    return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}
/**
 * Return `full` inline if small; otherwise write the whole thing to a temp file
 * and return only its last INLINE_CHARS characters (a tail — most command/job
 * output is most useful at the end).
 */
export function tailAndSave(full, kind, ext = "log") {
    if (full.length <= INLINE_CHARS) {
        return { shown: full, truncated: false, totalChars: full.length };
    }
    const savedPath = nextFile(kind, ext);
    writeFileSync(savedPath, full, "utf8");
    return {
        shown: full.slice(full.length - INLINE_CHARS),
        truncated: true,
        totalChars: full.length,
        savedPath,
    };
}
/**
 * Return `entries` inline if there are few; otherwise write the full array to a
 * temp JSON file and return only the first INLINE_ENTRIES.
 */
export function capAndSave(entries, kind) {
    if (entries.length <= INLINE_ENTRIES) {
        return { shown: entries, truncated: false, total: entries.length };
    }
    const savedPath = nextFile(kind, "json");
    writeFileSync(savedPath, JSON.stringify(entries, null, 2), "utf8");
    return {
        shown: entries.slice(0, INLINE_ENTRIES),
        truncated: true,
        total: entries.length,
        savedPath,
    };
}
//# sourceMappingURL=output.js.map