import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** A local file resolved for batch upload, with a zip-safe (forward-slash) relative path. */
export interface LocalFileEntry {
  absPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

async function walk(dir: string, baseDir: string, recursive: boolean, out: LocalFileEntry[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await walk(abs, baseDir, recursive, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const st = await stat(abs);
    out.push({ absPath: abs, relPath: toPosix(relative(baseDir, abs)), size: st.size, mtimeMs: st.mtimeMs });
  }
}

/** Recursively (or shallowly) list every file under baseDir, relative paths in posix form. */
export async function listLocalFiles(baseDir: string, recursive: boolean): Promise<LocalFileEntry[]> {
  const out: LocalFileEntry[] = [];
  await walk(baseDir, baseDir, recursive, out);
  return out;
}

export interface SelectFilesInput {
  baseDir: string;
  /** Explicit paths relative to baseDir. When set, this exact list is used (pattern/recursive are ignored). */
  files?: string[];
  /** Regex tested against each candidate's posix relative path. */
  pattern?: string;
  recursive: boolean;
}

/**
 * Resolve the set of local files for a batch upload: an explicit list, a
 * regex over baseDir's contents, or (when neither is given) every file in
 * baseDir.
 */
export async function selectLocalFiles(input: SelectFilesInput): Promise<LocalFileEntry[]> {
  if (input.files && input.files.length > 0) {
    const results: LocalFileEntry[] = [];
    for (const rel of input.files) {
      const abs = join(input.baseDir, rel);
      let st;
      try {
        st = await stat(abs);
      } catch {
        throw new Error(`File not found: ${rel} (resolved to ${abs})`);
      }
      if (!st.isFile()) throw new Error(`Not a file: ${rel} (resolved to ${abs})`);
      results.push({ absPath: abs, relPath: toPosix(rel), size: st.size, mtimeMs: st.mtimeMs });
    }
    return results;
  }

  const all = await listLocalFiles(input.baseDir, input.recursive);
  if (input.pattern) {
    let re: RegExp;
    try {
      re = new RegExp(input.pattern);
    } catch (err) {
      throw new Error(`Invalid regex pattern: ${(err as Error).message}`);
    }
    return all.filter((f) => re.test(f.relPath));
  }
  return all;
}
