import type { ShellKind } from "./config.js";
export interface WrapOptions {
    shell: ShellKind;
    cwd?: string;
    env?: Record<string, string>;
    /**
     * When true, avoid flags that suppress interactive stdin (e.g. PowerShell's
     * -NonInteractive). Use for jobs that read from stdin / a pty.
     */
    interactive?: boolean;
}
/**
 * Turn a raw user command + shell/cwd/env into the exact command line to hand
 * to ssh2's exec(). Returns a single string that runs the command in the
 * chosen Windows shell with the requested working directory and environment.
 */
export declare function wrapCommand(command: string, opts: WrapOptions): string;
