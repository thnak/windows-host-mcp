import type { HostConfig, ShellKind } from "./config.js";
export interface SessionState {
    /** Default working directory applied when a call omits cwd. */
    cwd?: string;
    /** Default environment variables merged into every command. */
    env: Record<string, string>;
    /** Default shell applied when a call omits shell. */
    shell: ShellKind;
}
/**
 * In-memory session state, seeded from config. run_command / start_job fall
 * back to these values when a call does not override them. This lets the agent
 * "cd" once and keep a working directory + env across tool calls.
 */
export declare class Session {
    private state;
    constructor(config: HostConfig);
    get(): SessionState;
    update(patch: {
        cwd?: string;
        env?: Record<string, string | null>;
        shell?: ShellKind;
    }): SessionState;
    /** Resolve effective shell/cwd/env for a call, applying per-call overrides on top of session state. */
    resolve(overrides: {
        shell?: ShellKind;
        cwd?: string;
        env?: Record<string, string>;
    }): {
        shell: ShellKind;
        cwd?: string;
        env: Record<string, string>;
    };
}
