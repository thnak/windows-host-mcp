/** Escape a value for a PowerShell single-quoted string ('' escapes a quote). */
function psSingleQuote(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
/** Escape a value for a bash single-quoted string. */
function bashSingleQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
/**
 * Build a PowerShell script (env + cwd + command + exit-code propagation) and
 * pack it into a `-EncodedCommand` invocation. Base64-of-UTF16LE completely
 * sidesteps SSH/PowerShell quoting: the command travels as opaque data.
 */
function wrapPowershell(command, opts) {
    const lines = [];
    // Quiet the progress stream (it is serialized as CLIXML noise onto stderr
    // over SSH) and make output UTF-8 so it decodes cleanly on our side.
    lines.push("$ProgressPreference='SilentlyContinue'");
    lines.push("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8");
    for (const [k, v] of Object.entries(opts.env ?? {})) {
        // Env var names are simple identifiers on Windows; value is quoted.
        lines.push(`$env:${k}=${psSingleQuote(v)}`);
    }
    if (opts.cwd) {
        lines.push(`Set-Location -LiteralPath ${psSingleQuote(opts.cwd)}`);
    }
    lines.push(command);
    // Propagate the last native process exit code back over SSH.
    lines.push("exit $LASTEXITCODE");
    const script = lines.join("\n");
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const flags = opts.interactive
        ? "-NoProfile -ExecutionPolicy Bypass"
        : "-NoProfile -NonInteractive -ExecutionPolicy Bypass";
    return `powershell ${flags} -EncodedCommand ${encoded}`;
}
/**
 * Build a cmd.exe invocation. cmd quoting is fragile, so this is best-effort;
 * PowerShell is the recommended default. The `/c` exit code is the last
 * command's exit code automatically.
 */
function wrapCmd(command, opts) {
    const parts = [];
    if (opts.cwd)
        parts.push(`cd /d "${opts.cwd}"`);
    for (const [k, v] of Object.entries(opts.env ?? {})) {
        parts.push(`set "${k}=${v}"`);
    }
    parts.push(command);
    const inner = parts.join(" && ");
    // Wrap the whole line in quotes; inner double-quotes are preserved by cmd's
    // /s + surrounding-quote rule.
    return `cmd.exe /s /c "${inner}"`;
}
/** Build a bash -lc invocation (WSL / Git-Bash on the Windows host). */
function wrapBash(command, opts) {
    const parts = [];
    if (opts.cwd)
        parts.push(`cd ${bashSingleQuote(opts.cwd)}`);
    for (const [k, v] of Object.entries(opts.env ?? {})) {
        parts.push(`export ${k}=${bashSingleQuote(v)}`);
    }
    parts.push(command);
    const script = parts.join(" && ");
    return `bash -lc ${bashSingleQuote(script)}`;
}
/**
 * Turn a raw user command + shell/cwd/env into the exact command line to hand
 * to ssh2's exec(). Returns a single string that runs the command in the
 * chosen Windows shell with the requested working directory and environment.
 */
export function wrapCommand(command, opts) {
    switch (opts.shell) {
        case "powershell":
            return wrapPowershell(command, opts);
        case "cmd":
            return wrapCmd(command, opts);
        case "bash":
            return wrapBash(command, opts);
    }
}
//# sourceMappingURL=shell.js.map