import { Client } from "ssh2";
/**
 * Manages a single lazily-created SSH connection to the Windows host. One TCP
 * connection multiplexes many channels (each exec / sftp opens its own), so a
 * singleton is enough for the stated use case. Reconnects transparently after
 * a drop.
 */
export class SshConnection {
    config;
    client = null;
    connecting = null;
    constructor(config) {
        this.config = config;
    }
    /** Whether a live client is currently cached (lazy: false until first use). */
    isConnected() {
        return this.client !== null;
    }
    /** Resolve a live, ready SSH client, connecting (or reconnecting) as needed. */
    async getClient() {
        if (this.client)
            return this.client;
        if (this.connecting)
            return this.connecting;
        this.connecting = new Promise((resolve, reject) => {
            const client = new Client();
            const onError = (err) => {
                this.client = null;
                this.connecting = null;
                reject(err);
            };
            client
                .on("ready", () => {
                this.client = client;
                this.connecting = null;
                resolve(client);
            })
                .on("error", onError)
                .on("close", () => {
                // Drop the cached client so the next call reconnects.
                if (this.client === client)
                    this.client = null;
            })
                .connect({
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                privateKey: this.config.privateKey,
                passphrase: this.config.passphrase,
                readyTimeout: this.config.readyTimeoutMs,
                keepaliveInterval: 15000,
                keepaliveCountMax: 4,
            });
        });
        return this.connecting;
    }
    /** Open an exec channel for a fully-formed command line. */
    async exec(commandLine, opts = {}) {
        const client = await this.getClient();
        return new Promise((resolve, reject) => {
            client.exec(commandLine, { pty: opts.pty ?? false }, (err, channel) => {
                if (err)
                    reject(err);
                else
                    resolve(channel);
            });
        });
    }
    /** Open an SFTP session. */
    async sftp() {
        const client = await this.getClient();
        return new Promise((resolve, reject) => {
            client.sftp((err, sftp) => {
                if (err)
                    reject(err);
                else
                    resolve(sftp);
            });
        });
    }
    /** Close the connection (used on shutdown). */
    close() {
        if (this.client) {
            this.client.end();
            this.client = null;
        }
        this.connecting = null;
    }
}
//# sourceMappingURL=connection.js.map