import type { LocalFileEntry } from "./localFiles.js";
/** A fresh path under the OS temp dir for a batch-transfer zip; caller owns cleanup via removeZip(). */
export declare function tmpZipPath(tag: string): string;
/**
 * Pack files into a local zip (relative paths + mtimes preserved so the
 * remote side can apply write policies like keep-newer). Caller owns the
 * returned path and must removeZip() it when done.
 */
export declare function buildZip(files: LocalFileEntry[]): Promise<string>;
export declare function removeZip(path: string): Promise<void>;
