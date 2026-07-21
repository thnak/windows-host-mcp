/**
 * Self-update: check GitHub Releases for a newer tag than the running
 * version, then reinstall globally from that tag via `npm install -g
 * git+https://...#<tag>`. There's no npm-registry publish for this package,
 * so "install from a pinned git tag" is the update mechanism end to end —
 * the same command works for a first install (see README) and for updates.
 */
export declare function runUpdate(): Promise<void>;
