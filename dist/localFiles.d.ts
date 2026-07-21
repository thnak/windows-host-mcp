/** A local file resolved for batch upload, with a zip-safe (forward-slash) relative path. */
export interface LocalFileEntry {
    absPath: string;
    relPath: string;
    size: number;
    mtimeMs: number;
}
/** Recursively (or shallowly) list every file under baseDir, relative paths in posix form. */
export declare function listLocalFiles(baseDir: string, recursive: boolean): Promise<LocalFileEntry[]>;
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
export declare function selectLocalFiles(input: SelectFilesInput): Promise<LocalFileEntry[]>;
