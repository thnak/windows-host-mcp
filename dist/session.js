/**
 * In-memory session state, seeded from config. run_command / start_job fall
 * back to these values when a call does not override them. This lets the agent
 * "cd" once and keep a working directory + env across tool calls.
 */
export class Session {
    state;
    constructor(config) {
        this.state = {
            cwd: config.defaultCwd,
            env: {},
            shell: config.defaultShell,
        };
    }
    get() {
        return { cwd: this.state.cwd, env: { ...this.state.env }, shell: this.state.shell };
    }
    update(patch) {
        if (patch.cwd !== undefined)
            this.state.cwd = patch.cwd;
        if (patch.shell !== undefined)
            this.state.shell = patch.shell;
        if (patch.env !== undefined) {
            // Merge; an empty-string value still sets the var, a null value deletes it.
            const next = { ...this.state.env };
            for (const [k, v] of Object.entries(patch.env)) {
                if (v === null)
                    delete next[k];
                else
                    next[k] = v;
            }
            this.state.env = next;
        }
        return this.get();
    }
    /** Resolve effective shell/cwd/env for a call, applying per-call overrides on top of session state. */
    resolve(overrides) {
        return {
            shell: overrides.shell ?? this.state.shell,
            cwd: overrides.cwd ?? this.state.cwd,
            env: { ...this.state.env, ...(overrides.env ?? {}) },
        };
    }
}
//# sourceMappingURL=session.js.map