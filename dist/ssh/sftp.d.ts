import type { SshConnection } from "./connection.js";
export interface RemoteEntry {
    name: string;
    size: number;
    isDirectory: boolean;
    modifyTime: number;
}
/** Upload a local file to the Windows host. Returns the remote path. */
export declare function uploadFile(conn: SshConnection, localPath: string, remotePath: string): Promise<string>;
/** Download a file from the Windows host to this machine. Returns the local path. */
export declare function downloadFile(conn: SshConnection, remotePath: string, localPath: string): Promise<string>;
/** List a remote directory. */
export declare function listRemoteDir(conn: SshConnection, remotePath: string): Promise<RemoteEntry[]>;
/**
 * Recursively copy a directory. direction "up" pushes local→remote,
 * "down" pulls remote→local. Returns the number of files transferred.
 */
export declare function syncDir(conn: SshConnection, localDir: string, remoteDir: string, direction?: "up" | "down"): Promise<number>;
