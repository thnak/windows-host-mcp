/** Build a standard MCP tool result carrying both readable text and structured data. */
export function result(structured, text) {
    return {
        content: [{ type: "text", text: text ?? JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
    };
}
/** Build an error tool result. */
export function errorResult(err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
        content: [{ type: "text", text: `Error: ${message}` }],
        structuredContent: { error: message },
        isError: true,
    };
}
//# sourceMappingURL=context.js.map