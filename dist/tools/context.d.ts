import type { HostManager } from "../hostManager.js";
/** Shared dependencies handed to every tool group. */
export interface AppContext {
    manager: HostManager;
}
/** Build a standard MCP tool result carrying both readable text and structured data. */
export declare function result(structured: object, text?: string): {
    content: {
        type: "text";
        text: string;
    }[];
    structuredContent: Record<string, unknown>;
};
/** Build an error tool result. */
export declare function errorResult(err: unknown): {
    content: {
        type: "text";
        text: string;
    }[];
    structuredContent: {
        error: string;
    };
    isError: boolean;
};
