import { Client } from "ssh2";
import type { ClientChannel, SFTPWrapper } from "ssh2";
import type { HostConfig } from "../config.js";
/**
 * Manages a single lazily-created SSH connection to the Windows host. One TCP
 * connection multiplexes many channels (each exec / sftp opens its own), so a
 * singleton is enough for the stated use case. Reconnects transparently after
 * a drop.
 */
export declare class SshConnection {
    private readonly config;
    private client;
    private connecting;
    constructor(config: HostConfig);
    /** Whether a live client is currently cached (lazy: false until first use). */
    isConnected(): boolean;
    /** Resolve a live, ready SSH client, connecting (or reconnecting) as needed. */
    getClient(): Promise<Client>;
    /** Open an exec channel for a fully-formed command line. */
    exec(commandLine: string, opts?: {
        pty?: boolean;
    }): Promise<ClientChannel>;
    /** Open an SFTP session. */
    sftp(): Promise<SFTPWrapper>;
    /** Close the connection (used on shutdown). */
    close(): void;
}
