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
export class Session {
  private state: SessionState;

  constructor(config: HostConfig) {
    this.state = {
      cwd: config.defaultCwd,
      env: {},
      shell: config.defaultShell,
    };
  }

  get(): SessionState {
    return { cwd: this.state.cwd, env: { ...this.state.env }, shell: this.state.shell };
  }

  update(patch: {
    cwd?: string;
    env?: Record<string, string | null>;
    shell?: ShellKind;
  }): SessionState {
    if (patch.cwd !== undefined) this.state.cwd = patch.cwd;
    if (patch.shell !== undefined) this.state.shell = patch.shell;
    if (patch.env !== undefined) {
      // Merge; an empty-string value still sets the var, a null value deletes it.
      const next = { ...this.state.env };
      for (const [k, v] of Object.entries(patch.env)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      this.state.env = next;
    }
    return this.get();
  }

  /** Resolve effective shell/cwd/env for a call, applying per-call overrides on top of session state. */
  resolve(overrides: {
    shell?: ShellKind;
    cwd?: string;
    env?: Record<string, string>;
  }): { shell: ShellKind; cwd?: string; env: Record<string, string> } {
    return {
      shell: overrides.shell ?? this.state.shell,
      cwd: overrides.cwd ?? this.state.cwd,
      env: { ...this.state.env, ...(overrides.env ?? {}) },
    };
  }
}
