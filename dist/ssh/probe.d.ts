import type { ShellKind } from "../config.js";
import type { SshConnection } from "./connection.js";
/**
 * Check whether a path exists on the host and is a directory. Uses the shell's
 * own path semantics: bash paths (WSL/Git-Bash) are tested with `test -d`,
 * everything else with PowerShell's Test-Path (reliable for Windows paths).
 */
export declare function dirExists(conn: SshConnection, shell: ShellKind, path: string): Promise<boolean>;
export interface ToolInfo {
    name: string;
    found: boolean;
    path: string | null;
    version: string | null;
}
/** Tools probed by default in get_host_info. */
export declare const DEFAULT_TOOLS: string[];
/** Check presence + best-effort version of specific tools on the host. */
export declare function checkTools(conn: SshConnection, tools: string[]): Promise<ToolInfo[]>;
export interface HostInfo {
    os: string | null;
    osVersion: string | null;
    hostname: string | null;
    user: string | null;
    /** The default directory PowerShell lands in (host home, not the session cwd). */
    homeCwd: string | null;
    path: string[];
    tools: ToolInfo[];
}
/** Gather OS/user/shell/tool/PATH information in a single round-trip. */
export declare function getHostInfo(conn: SshConnection, tools: string[]): Promise<HostInfo>;
