import type { SshConnection } from "./connection.js";
import type { ExtractFileResult } from "../unzip.js";
import type { WritePolicy } from "./batchUpload.js";
export type { WritePolicy };
export interface BatchDownloadResult {
    files: ExtractFileResult[];
    downloaded: number;
    overwritten: number;
    skipped: number;
    errors: number;
}
export interface BatchDownloadSelection {
    /** Explicit paths relative to remoteDir. When set, pattern/recursive are ignored. */
    files?: string[];
    /** Regex tested against each candidate's path relative to remoteDir (forward-slash separated). */
    pattern?: string;
    recursive: boolean;
}
/**
 * Select files on the Windows host (explicit list / regex / whole folder),
 * bundle them into a single zip remotely, download that zip in one SFTP
 * transfer, and unpack it locally applying `policy` to any name collisions.
 * Cleans up both the remote and local zip regardless of outcome.
 */
export declare function batchDownload(conn: SshConnection, remoteDir: string, localDir: string, policy: WritePolicy, selection: BatchDownloadSelection): Promise<BatchDownloadResult>;
