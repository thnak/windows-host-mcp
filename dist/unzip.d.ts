import type { WritePolicy } from "./ssh/batchUpload.js";
export interface ExtractFileResult {
    path: string;
    action: "downloaded" | "overwritten" | "skipped" | "error";
    reason?: string;
}
/**
 * Extract a zip (built remotely by batch_download) into destDir, applying
 * the same write-policy semantics as batch_upload but in reverse: an
 * existing local file is kept under skip-existing, replaced only if the
 * zipped (remote) copy is newer under keep-newer, and always replaced under
 * overwrite.
 */
export declare function extractZipWithPolicy(zipPath: string, destDir: string, policy: WritePolicy): Promise<ExtractFileResult[]>;
