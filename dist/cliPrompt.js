import { createInterface } from "node:readline";
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
export class Prompter {
    output;
    rl;
    queue = [];
    waiters = [];
    ended = false;
    constructor(input = process.stdin, output = process.stdout) {
        this.output = output;
        this.rl = createInterface({ input, terminal: false });
        this.rl.on("line", (line) => {
            const waiter = this.waiters.shift();
            if (waiter)
                waiter(line);
            else
                this.queue.push(line);
        });
        this.rl.on("close", () => {
            this.ended = true;
            while (this.waiters.length)
                this.waiters.shift()("");
        });
    }
    nextLine() {
        if (this.queue.length)
            return Promise.resolve(this.queue.shift());
        if (this.ended)
            return Promise.resolve("");
        return new Promise((resolve) => this.waiters.push(resolve));
    }
    async ask(question, defaultValue) {
        const suffix = defaultValue ? ` [${defaultValue}]` : "";
        this.output.write(`${question}${suffix}: `);
        const answer = (await this.nextLine()).trim();
        return answer || defaultValue || "";
    }
    async askYesNo(question, defaultYes) {
        const suffix = defaultYes ? "Y/n" : "y/N";
        this.output.write(`${question} [${suffix}]: `);
        const answer = (await this.nextLine()).trim().toLowerCase();
        if (!answer)
            return defaultYes;
        return answer.startsWith("y");
    }
    close() {
        this.rl.close();
    }
}
//# sourceMappingURL=cliPrompt.js.map