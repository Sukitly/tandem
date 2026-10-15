import { describe, expect, test } from "vitest";
import { describeTool, parseDiffLine } from "../src/chat/transcript-items.tsx";

describe("transcript items helpers", () => {
  test("describes standard file and agent tools", () => {
    expect(describeTool({ name: "read", args: { path: "src/app.ts" }, status: "done" }).title).toBe("Read src/app.ts");
    expect(
      describeTool({ name: "read", args: { path: "src/app.ts", offset: 10, limit: 20 }, status: "running" }).title,
    ).toBe("Reading src/app.ts:10-29");
    expect(describeTool({ name: "edit", args: { path: "src/index.ts" }, status: "done" }).title).toBe(
      "Edited src/index.ts",
    );
    expect(describeTool({ name: "write", args: { path: "src/new.ts" }, status: "failed" }).title).toBe(
      "Failed to write src/new.ts",
    );
    expect(describeTool({ name: "reply_to_comment", args: { threadId: "42" }, status: "done" }).title).toBe(
      "Replied to comment #42",
    );
    expect(describeTool({ name: "custom_op", args: {}, status: "cancelled" }).title).toBe(
      "Cancelled calling custom_op",
    );
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
