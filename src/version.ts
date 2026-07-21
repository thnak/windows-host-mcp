import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** package.json sits one level above dist/ (built) or src/ (dev) — either way, one level up from this file. */
export const VERSION: string = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).version;
