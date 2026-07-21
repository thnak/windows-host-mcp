import { readFileSync } from "node:fs";
function parseShell(v, ctx) {
    const s = (v ?? "powershell").trim().toLowerCase();
    if (s === "powershell" || s === "cmd" || s === "bash")
        return s;
    throw new Error(`${ctx}: shell must be one of powershell|cmd|bash, got: ${v}`);
}
function parsePort(v, ctx) {
    const port = Number(v ?? 22);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`${ctx}: port must be a valid port number, got: ${v}`);
    }
    return port;
}
function parseTimeout(v, ctx) {
    const t = Number(v ?? 20000);
    if (!Number.isFinite(t) || t <= 0)
        throw new Error(`${ctx}: readyTimeoutMs must be positive`);
    return t;
}
function readKey(keyPath, ctx) {
    try {
        return readFileSync(keyPath);
    }
    catch (err) {
        throw new Error(`${ctx}: cannot read key at ${keyPath}: ${err.message}`);
    }
}
function buildHost(raw) {
    const name = raw.name?.trim();
    if (!name)
        throw new Error(`Every host needs a "name"`);
    const ctx = `host "${name}"`;
    if (!raw.host?.trim())
        throw new Error(`${ctx}: "host" is required`);
    if (!raw.username?.trim())
        throw new Error(`${ctx}: "username" is required`);
    if (!raw.keyPath?.trim())
        throw new Error(`${ctx}: "keyPath" is required`);
    return {
        name,
        description: raw.description?.trim() || undefined,
        labels: (raw.labels ?? []).map((l) => l.trim()).filter(Boolean),
        host: raw.host.trim(),
        port: parsePort(raw.port, ctx),
        username: raw.username.trim(),
        privateKey: readKey(raw.keyPath.trim(), ctx),
        passphrase: raw.keyPassphrase?.trim() || undefined,
        defaultShell: parseShell(raw.shell, ctx),
        defaultCwd: raw.cwd?.trim() || undefined,
        readyTimeoutMs: parseTimeout(raw.readyTimeoutMs, ctx),
    };
}
/** Build a single host from the flat WINDOWS_SSH_* env vars (backward compatible). */
function hostFromEnv() {
    const keyPath = process.env.WINDOWS_SSH_KEY_PATH;
    if (!process.env.WINDOWS_SSH_HOST || !process.env.WINDOWS_SSH_USER || !keyPath) {
        throw new Error("No host configuration found. Set WINDOWS_HOSTS_CONFIG to a JSON file, or provide " +
            "WINDOWS_SSH_HOST, WINDOWS_SSH_USER, and WINDOWS_SSH_KEY_PATH for a single host.");
    }
    return buildHost({
        name: process.env.WINDOWS_SSH_HOST_NAME?.trim() || "default",
        host: process.env.WINDOWS_SSH_HOST,
        port: process.env.WINDOWS_SSH_PORT ? Number(process.env.WINDOWS_SSH_PORT) : undefined,
        username: process.env.WINDOWS_SSH_USER,
        keyPath,
        keyPassphrase: process.env.WINDOWS_SSH_KEY_PASSPHRASE,
        shell: process.env.WINDOWS_SSH_DEFAULT_SHELL,
        cwd: process.env.WINDOWS_SSH_DEFAULT_CWD,
        labels: process.env.WINDOWS_SSH_LABELS
            ? process.env.WINDOWS_SSH_LABELS.split(",")
            : undefined,
        readyTimeoutMs: process.env.WINDOWS_SSH_READY_TIMEOUT_MS
            ? Number(process.env.WINDOWS_SSH_READY_TIMEOUT_MS)
            : undefined,
    });
}
/** Load hosts from the JSON file pointed to by WINDOWS_HOSTS_CONFIG. */
function hostsFromFile(path) {
    let raw;
    try {
        raw = JSON.parse(readFileSync(path, "utf8"));
    }
    catch (err) {
        throw new Error(`Could not read/parse WINDOWS_HOSTS_CONFIG=${path}: ${err.message}`);
    }
    if (!raw.hosts || raw.hosts.length === 0) {
        throw new Error(`${path}: "hosts" must be a non-empty array`);
    }
    const hosts = raw.hosts.map(buildHost);
    const names = new Set();
    for (const h of hosts) {
        if (names.has(h.name))
            throw new Error(`Duplicate host name: ${h.name}`);
        names.add(h.name);
    }
    const defaultHost = raw.defaultHost?.trim() || hosts[0].name;
    if (!names.has(defaultHost)) {
        throw new Error(`defaultHost "${defaultHost}" is not among the configured hosts`);
    }
    return { hosts, defaultHost };
}
/** Load and validate configuration. Supports a multi-host JSON file or single-host env vars. */
export function loadConfig() {
    const file = process.env.WINDOWS_HOSTS_CONFIG?.trim();
    if (file)
        return hostsFromFile(file);
    const host = hostFromEnv();
    return { hosts: [host], defaultHost: host.name };
}
//# sourceMappingURL=config.js.map