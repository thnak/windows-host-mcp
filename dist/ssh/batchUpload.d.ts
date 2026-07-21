import type { SshConnection } from "./connection.js";
import type { LocalFileEntry } from "../localFiles.js";
export type WritePolicy = "overwrite" | "keep-newer" | "skip-existing";
export type BatchFileAction = "uploaded" | "overwritten" | "skipped" | "error";
export interface BatchFileResult {
    path: string;
    action: BatchFileAction;
    reason?: string;
}
export interface BatchUploadResult {
    files: BatchFileResult[];
    uploaded: number;
    overwritten: number;
    skipped: number;
    errors: number;
}
/**
 * Zip the given local files, upload the zip in one SFTP transfer, and unpack
 * it on the remote side applying `policy` to any name collisions. Cleans up
 * both the local and remote zip regardless of outcome.
 */
export declare function batchUpload(conn: SshConnection, files: LocalFileEntry[], remoteDir: string, policy: WritePolicy): Promise<BatchUploadResult>;
