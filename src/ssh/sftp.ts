import { readdir as fsReaddir } from "node:fs/promises";
import { join as pathJoin, basename } from "node:path";
import type { SFTPWrapper, FileEntry } from "ssh2";
import type { SshConnection } from "./connection.js";

export interface RemoteEntry {
  name: string;
  size: number;
  isDirectory: boolean;
  modifyTime: number;
}

/** Windows OpenSSH SFTP accepts forward slashes; normalize backslashes for safety. */
function toRemote(p: string): string {
  return p.replace(/\\/g, "/");
}

async function withSftp<T>(conn: SshConnection, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const sftp = await conn.sftp();
  try {
    return await fn(sftp);
  } finally {
    sftp.end();
  }
}

/** Upload a local file to the Windows host. Returns the remote path. */
export async function uploadFile(
  conn: SshConnection,
  localPath: string,
  remotePath: string,
): Promise<string> {
  const remote = toRemote(remotePath);
  await withSftp(conn, (sftp) =>
    new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remote, (err) => (err ? reject(err) : resolve()));
    }),
  );
  return remote;
}

/** Download a file from the Windows host to this machine. Returns the local path. */
export async function downloadFile(
  conn: SshConnection,
  remotePath: string,
  localPath: string,
): Promise<string> {
  const remote = toRemote(remotePath);
  await withSftp(conn, (sftp) =>
    new Promise<void>((resolve, reject) => {
      sftp.fastGet(remote, localPath, (err) => (err ? reject(err) : resolve()));
    }),
  );
  return localPath;
}

/** List a remote directory. */
export async function listRemoteDir(
  conn: SshConnection,
  remotePath: string,
): Promise<RemoteEntry[]> {
  const remote = toRemote(remotePath);
  return withSftp(conn, (sftp) =>
    new Promise<RemoteEntry[]>((resolve, reject) => {
      sftp.readdir(remote, (err, list: FileEntry[]) => {
        if (err) return reject(err);
        resolve(
          list.map((e) => ({
            name: e.filename,
            size: e.attrs.size,
            isDirectory: (e.attrs.mode & 0o170000) === 0o040000,
            modifyTime: e.attrs.mtime,
          })),
        );
      });
    }),
  );
}

async function ensureRemoteDir(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  await new Promise<void>((resolve) => {
    sftp.mkdir(remoteDir, () => resolve()); // ignore "already exists"
  });
}

/**
 * Recursively copy a directory. direction "up" pushes local→remote,
 * "down" pulls remote→local. Returns the number of files transferred.
 */
export async function syncDir(
  conn: SshConnection,
  localDir: string,
  remoteDir: string,
  direction: "up" | "down" = "up",
): Promise<number> {
  const remote = toRemote(remoteDir);
  return withSftp(conn, async (sftp) => {
    if (direction === "up") return syncUp(sftp, localDir, remote);
    return syncDown(sftp, remote, localDir);
  });
}

async function syncUp(sftp: SFTPWrapper, localDir: string, remoteDir: string): Promise<number> {
  await ensureRemoteDir(sftp, remoteDir);
  let count = 0;
  const entries = await fsReaddir(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const local = pathJoin(localDir, entry.name);
    const remote = `${remoteDir}/${entry.name}`;
    if (entry.isDirectory()) {
      count += await syncUp(sftp, local, remote);
    } else if (entry.isFile()) {
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
      });
      count++;
    }
  }
  return count;
}

async function syncDown(sftp: SFTPWrapper, remoteDir: string, localDir: string): Promise<number> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(localDir, { recursive: true });
  let count = 0;
  const entries = await new Promise<FileEntry[]>((resolve, reject) => {
    sftp.readdir(remoteDir, (err, list) => (err ? reject(err) : resolve(list)));
  });
  for (const entry of entries) {
    const remote = `${remoteDir}/${entry.filename}`;
    const local = pathJoin(localDir, basename(entry.filename));
    const isDir = (entry.attrs.mode & 0o170000) === 0o040000;
    if (isDir) {
      count += await syncDown(sftp, remote, local);
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.fastGet(remote, local, (err) => (err ? reject(err) : resolve()));
      });
      count++;
    }
  }
  return count;
}
