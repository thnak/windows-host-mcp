export type ShellKind = "powershell" | "cmd" | "bash";
/** Fully-resolved configuration for a single Windows host. */
export interface HostConfig {
    name: string;
    description?: string;
    /** Free-form capability tags, e.g. ["cuda", "gpu"] or ["rocm"]. */
    labels: string[];
    host: string;
    port: number;
    username: string;
    privateKey: Buffer;
    passphrase?: string;
    defaultShell: ShellKind;
    defaultCwd?: string;
    readyTimeoutMs: number;
}
export interface AppConfig {
    hosts: HostConfig[];
    /** Name of the host that is active on startup. */
    defaultHost: string;
}
/** Load and validate configuration. Supports a multi-host JSON file or single-host env vars. */
export declare function loadConfig(): AppConfig;
