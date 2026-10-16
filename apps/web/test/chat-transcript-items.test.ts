import { describe, expect, test } from "vitest";
import { parseDiffLine, toolDescription } from "../src/chat/transcript-items.tsx";

describe("transcript items helpers", () => {
  test("describes argument context without mapping tool names or statuses", () => {
    expect(toolDescription({ path: "src/app.ts" })).toBe("src/app.ts");
    expect(toolDescription({ path: "src/app.ts", offset: 10, limit: 20 })).toBe("src/app.ts:10-29");
    expect(toolDescription({ path: "src/app.ts", limit: 5 })).toBe("src/app.ts:1-5");
    expect(toolDescription({ path: "src/app.ts", offset: 10 })).toBe("src/app.ts:10");
    expect(toolDescription({ command: "bun run test" })).toBe("bun run test");
    expect(toolDescription({ threadId: 42 })).toBe("#42");
    expect(toolDescription({ threadId: "42" })).toBe("#42");
    expect(toolDescription({ query: "custom tool input" })).toBe('{"query":"custom tool input"}');
    expect(toolDescription({})).toBe("");
  });

  test("structures and parses raw unified diff lines", () => {
    const addLine = parseDiffLine("+172 expect(button).toBeDefined();");
    expect(addLine.type).toBe("add");
    expect(addLine.lineNumber).toBe("172");
    expect(addLine.text).toBe("expect(button).toBeDefined();");

    const deleteLine = parseDiffLine("- 50 const oldVal = 1;");
    expect(deleteLine.type).toBe("delete");
    expect(deleteLine.lineNumber).toBe("50");
    expect(deleteLine.text).toBe("const oldVal = 1;");

    const contextLine = parseDiffLine("  168 import React from 'react';");
    expect(contextLine.type).toBe("context");
    expect(contextLine.lineNumber).toBe("168");
    expect(contextLine.text).toBe("import React from 'react';");
  });
});
