/** Default location for hosts.json when the caller hasn't already pointed WINDOWS_HOSTS_CONFIG elsewhere. */
export declare function defaultConfigPath(): string;
/**
 * Interactive wizard: add/edit/remove hosts in hosts.json, then optionally
 * (re-)register the server with Claude Code pointing at that file. Safe to
 * re-run at any time — it loads whatever's already there.
 */
export declare function runConfig(args: string[]): Promise<void>;
