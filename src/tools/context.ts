import type { HostManager } from "../hostManager.js";

/** Shared dependencies handed to every tool group. */
export interface AppContext {
  manager: HostManager;
}

/** Build a standard MCP tool result carrying both readable text and structured data. */
export function result(structured: object, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(structured, null, 2) }],
    structuredContent: structured as Record<string, unknown>,
  };
}

/** Build an error tool result. */
export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    structuredContent: { error: message },
    isError: true,
  };
}
