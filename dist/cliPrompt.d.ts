/**
 * A line-by-line stdin prompter. Unlike node:readline/promises' question(),
 * which attaches a fresh one-shot 'line' listener per call, this keeps a
 * single listener attached for the interface's whole lifetime and queues
 * lines as they arrive. That matters because when stdin is a non-TTY pipe
 * (piped/scripted answers, as opposed to a human typing at a terminal),
 * readline emits every buffered 'line' event synchronously as soon as data
 * arrives — any line that arrives before the next question() call has a
 * listener attached is silently dropped, and that call then hangs forever.
 * Queuing sidesteps the race entirely and works the same for both piped and
 * interactive input.
 */
export declare class Prompter {
    private readonly output;
    private readonly rl;
    private readonly queue;
    private readonly waiters;
    private ended;
    constructor(input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream);
    private nextLine;
    ask(question: string, defaultValue?: string): Promise<string>;
    askYesNo(question: string, defaultYes: boolean): Promise<boolean>;
    close(): void;
}
