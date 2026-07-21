/** Human-readable size for a character/byte count. */
export declare function formatSize(chars: number): string;
export interface TailResult {
    /** The slice returned inline (last INLINE_CHARS chars when truncated). */
    shown: string;
    truncated: boolean;
    totalChars: number;
    /** Path to the full content on disk, only set when truncated. */
    savedPath?: string;
}
/**
 * Return `full` inline if small; otherwise write the whole thing to a temp file
 * and return only its last INLINE_CHARS characters (a tail — most command/job
 * output is most useful at the end).
 */
export declare function tailAndSave(full: string, kind: string, ext?: string): TailResult;
export interface CapResult<T> {
    shown: T[];
    truncated: boolean;
    total: number;
    savedPath?: string;
}
/**
 * Return `entries` inline if there are few; otherwise write the full array to a
 * temp JSON file and return only the first INLINE_ENTRIES.
 */
export declare function capAndSave<T>(entries: T[], kind: string): CapResult<T>;
