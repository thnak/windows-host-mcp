/**
 * Self-update: this package has no npm-registry publish, so it's installed
 * as a git checkout (see README — `git clone` + `npm link`). Updating is
 * therefore a git operation done in place: fetch tags, check out the latest
 * release tag, and reinstall dependencies. dist/ is committed to the repo
 * (see CLAUDE.md for why), so a checkout alone leaves a working build —
 * no rebuild step needed.
 */
export declare function runUpdate(): Promise<void>;
