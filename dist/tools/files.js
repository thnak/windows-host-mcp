import { z } from "zod";
import { errorResult, result } from "./context.js";
import { capAndSave } from "./output.js";
import { downloadFile, listRemoteDir, syncDir, uploadFile } from "../ssh/sftp.js";
import { batchUpload } from "../ssh/batchUpload.js";
import { batchDownload } from "../ssh/batchDownload.js";
import { selectLocalFiles } from "../localFiles.js";
const hostParam = z
    .string()
    .optional()
    .describe("Target host name; defaults to the active host.");
export function registerFileTools(server, ctx) {
    server.registerTool("upload_file", {
        title: "Upload a file to Windows",
        description: "Upload a file from this Linux machine to a Windows host over SFTP. Remote paths may use forward or back slashes.",
        inputSchema: {
            localPath: z.string().describe("Absolute path on this machine."),
            remotePath: z.string().describe("Destination path on Windows, e.g. C:/build/app.zip."),
            host: hostParam,
        },
    }, async ({ localPath, remotePath, host }) => {
        try {
            const target = ctx.manager.resolve(host);
            const remote = await uploadFile(target.conn, localPath, remotePath);
            return result({ host: target.name, uploaded: true, remotePath: remote }, `Uploaded to ${remote} on ${target.name}.`);
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("download_file", {
        title: "Download a file from Windows",
        description: "Download a file from a Windows host to this Linux machine over SFTP — e.g. a build artifact or log.",
        inputSchema: {
            remotePath: z.string().describe("Source path on Windows."),
            localPath: z.string().describe("Destination path on this machine."),
            host: hostParam,
        },
    }, async ({ remotePath, localPath, host }) => {
        try {
            const target = ctx.manager.resolve(host);
            const local = await downloadFile(target.conn, remotePath, localPath);
            return result({ host: target.name, downloaded: true, localPath: local }, `Downloaded to ${local} from ${target.name}.`);
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("list_remote_dir", {
        title: "List a Windows directory",
        description: "List the contents of a directory on a Windows host. Large listings are capped inline and the full listing spilled to a temp file (.whmcp-tmp/).",
        inputSchema: {
            remotePath: z.string().describe("Directory path on Windows, e.g. C:/build."),
            host: hostParam,
            truncate: z
                .boolean()
                .optional()
                .describe("Cap the number of entries returned inline and spill the full listing to a temp file instead of flooding the reply. Default true; pass false to return every entry inline."),
        },
    }, async ({ remotePath, host, truncate }) => {
        try {
            const target = ctx.manager.resolve(host);
            const entries = await listRemoteDir(target.conn, remotePath);
            const capped = truncate === false
                ? { shown: entries, truncated: false, total: entries.length, savedPath: undefined }
                : capAndSave(entries, "dir");
            return result({
                host: target.name,
                path: remotePath,
                entries: capped.shown,
                entriesTruncated: capped.truncated,
                totalEntries: capped.total,
                savedPath: capped.savedPath,
            });
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("sync_dir", {
        title: "Sync a directory to/from Windows",
        description: "Recursively copy a directory between this machine and a Windows host. direction 'up' pushes local→remote (e.g. source), 'down' pulls remote→local (e.g. artifacts).",
        inputSchema: {
            localDir: z.string().describe("Directory on this machine."),
            remoteDir: z.string().describe("Directory on Windows."),
            direction: z
                .enum(["up", "down"])
                .optional()
                .describe("'up' = local→remote (default), 'down' = remote→local."),
            host: hostParam,
        },
    }, async ({ localDir, remoteDir, direction, host }) => {
        try {
            const target = ctx.manager.resolve(host);
            const count = await syncDir(target.conn, localDir, remoteDir, direction ?? "up");
            return result({
                host: target.name,
                direction: direction ?? "up",
                filesTransferred: count,
                localDir,
                remoteDir,
            }, `Transferred ${count} file(s) ${direction ?? "up"} on ${target.name}.`);
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("batch_upload", {
        title: "Batch-upload files to Windows (zip transfer)",
        description: "Upload many local files to a Windows host in one shot. Select files by an explicit list, a regex " +
            "over paths relative to localDir, or (with neither) every file under localDir. Files are packed into " +
            "a single zip for transfer (fast, one round-trip) and unpacked on the remote side with Windows' " +
            "built-in Expand-Archive — no extra tooling required on either end. writePolicy controls what happens " +
            "when a destination file already exists: 'overwrite' (default) always replaces it, 'keep-newer' " +
            "replaces it only if the local copy's mtime is newer, 'skip-existing' never touches it.",
        inputSchema: {
            localDir: z.string().describe("Base local directory; file selection and relative paths are resolved against this."),
            files: z
                .array(z.string())
                .optional()
                .describe("Explicit file paths relative to localDir to upload as-is. When set, `pattern` and `recursive` are ignored."),
            pattern: z
                .string()
                .optional()
                .describe("Regex tested against each candidate file's path relative to localDir (forward-slash separated). " +
                "Ignored when `files` is set."),
            recursive: z
                .boolean()
                .optional()
                .describe("Recurse into subdirectories when selecting by pattern or whole-folder. Default true."),
            remoteDir: z.string().describe("Destination directory on Windows; created (including parents) if missing."),
            writePolicy: z
                .enum(["overwrite", "keep-newer", "skip-existing"])
                .optional()
                .describe("Conflict resolution for files that already exist remotely. Default 'overwrite'."),
            host: hostParam,
        },
    }, async ({ localDir, files, pattern, recursive, remoteDir, writePolicy, host }) => {
        try {
            const target = ctx.manager.resolve(host);
            const policy = writePolicy ?? "overwrite";
            const selected = await selectLocalFiles({
                baseDir: localDir,
                files,
                pattern,
                recursive: recursive ?? true,
            });
            if (selected.length === 0) {
                return result({ host: target.name, remoteDir, writePolicy: policy, filesMatched: 0 }, "No local files matched the selection; nothing to upload.");
            }
            const summary = await batchUpload(target.conn, selected, remoteDir, policy);
            const capped = capAndSave(summary.files, "batch-upload");
            return result({
                host: target.name,
                remoteDir,
                writePolicy: policy,
                filesMatched: selected.length,
                uploaded: summary.uploaded,
                overwritten: summary.overwritten,
                skipped: summary.skipped,
                errors: summary.errors,
                files: capped.shown,
                filesTruncated: capped.truncated,
                savedPath: capped.savedPath,
            }, `Batch upload to ${target.name}:${remoteDir} — ${summary.uploaded} new, ${summary.overwritten} overwritten, ` +
                `${summary.skipped} skipped, ${summary.errors} error(s) (policy: ${policy}).`);
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool("batch_download", {
        title: "Batch-download files from Windows (zip transfer)",
        description: "Download many files from a Windows host in one shot — the mirror of batch_upload. Select files by an " +
            "explicit list, a regex over paths relative to remoteDir, or (with neither) the whole folder. Files are " +
            "selected and zipped on the remote side with Windows' built-in Compress-Archive, downloaded in a single " +
            "SFTP transfer, and unpacked here. writePolicy controls what happens when a destination file already " +
            "exists locally: 'overwrite' (default) always replaces it, 'keep-newer' replaces it only if the remote " +
            "copy's mtime is newer, 'skip-existing' never touches it.",
        inputSchema: {
            remoteDir: z.string().describe("Base directory on Windows; file selection and relative paths are resolved against this."),
            files: z
                .array(z.string())
                .optional()
                .describe("Explicit file paths relative to remoteDir to download as-is. When set, `pattern` and `recursive` are ignored."),
            pattern: z
                .string()
                .optional()
                .describe("Regex tested against each candidate file's path relative to remoteDir (forward-slash separated). " +
                "Ignored when `files` is set."),
            recursive: z
                .boolean()
                .optional()
                .describe("Recurse into subdirectories when selecting by pattern or whole-folder. Default true."),
            localDir: z.string().describe("Destination directory on this machine; created (including parents) if missing."),
            writePolicy: z
                .enum(["overwrite", "keep-newer", "skip-existing"])
                .optional()
                .describe("Conflict resolution for files that already exist locally. Default 'overwrite'."),
            host: hostParam,
        },
    }, async ({ remoteDir, files, pattern, recursive, localDir, writePolicy, host }) => {
        try {
            const target = ctx.manager.resolve(host);
            const policy = writePolicy ?? "overwrite";
            const summary = await batchDownload(target.conn, remoteDir, localDir, policy, {
                files,
                pattern,
                recursive: recursive ?? true,
            });
            if (summary.files.length === 0) {
                return result({ host: target.name, remoteDir, localDir, writePolicy: policy, filesMatched: 0 }, "No remote files matched the selection; nothing to download.");
            }
            const capped = capAndSave(summary.files, "batch-download");
            return result({
                host: target.name,
                remoteDir,
                localDir,
                writePolicy: policy,
                filesMatched: summary.files.length,
                downloaded: summary.downloaded,
                overwritten: summary.overwritten,
                skipped: summary.skipped,
                errors: summary.errors,
                files: capped.shown,
                filesTruncated: capped.truncated,
                savedPath: capped.savedPath,
            }, `Batch download from ${target.name}:${remoteDir} — ${summary.downloaded} new, ${summary.overwritten} overwritten, ` +
                `${summary.skipped} skipped, ${summary.errors} error(s) (policy: ${policy}).`);
        }
        catch (err) {
            return errorResult(err);
        }
    });
}
//# sourceMappingURL=files.js.map