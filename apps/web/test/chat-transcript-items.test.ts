import { describe, expect, test } from "vitest";
import { toolDescription } from "../src/chat/transcript-items.tsx";

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
});
