import type { ConversationView } from "@tandem/contracts";
import { describe, expect, test } from "vitest";
import { toTranscript } from "../src/chat/transcript.ts";

type Entry = ConversationView["entries"][number];

function view(entries: unknown[], docs: Record<string, unknown> = {}): ConversationView {
  return { conversation: { id: 1 }, entries: entries as Entry[], docs } as unknown as ConversationView;
}

const noUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } };

function assistant(content: unknown[] | string, stopReason = "stop", extra: Record<string, unknown> = {}) {
  return {
    role: "assistant",
    content: typeof content === "string" ? [{ type: "text", text: content }] : content,
    stopReason,
    usage: noUsage,
    ...extra,
  };
}

const busy = { run: { taskId: 1, inputs: [1] } };

describe("toTranscript", () => {
  test("shows user and assistant messages and skips system prompts", () => {
    const transcript = toTranscript(
      view([
        { id: 1, kind: "pi.user", model: [{ role: "user", content: "hi" }] },
        { id: 2, kind: "pi.system", model: [{ role: "system", content: "prompt" }] },
        { id: 3, kind: "pi.assistant", model: [assistant("hello")] },
      ]),
    );
    expect(transcript).toEqual({
      items: [
        { kind: "user", key: "1:0", text: "hi", images: [] },
        { kind: "assistant", key: "3:0", parts: [{ kind: "text", text: "hello" }], ending: "complete" },
      ],
      busy: false,
      silent: false,
      turnHasContent: true,
      queued: [],
      usage: { tokens: 0, cost: 0 },
    });
  });

  test("marks interrupted and failed answers", () => {
    const { items } = toTranscript(
      view([
        { id: 1, kind: "pi.assistant", model: [assistant("half", "aborted")] },
        { id: 2, kind: "pi.assistant", model: [assistant([], "error", { errorMessage: "rate limited" })] },
      ]),
    );
    expect(items).toEqual([
      { kind: "assistant", key: "1:0", parts: [{ kind: "text", text: "half" }], ending: "interrupted" },
      { kind: "assistant", key: "2:0", parts: [], ending: "failed", error: "rate limited" },
    ]);
  });

  test("puts thinking, text, and tool calls in order, with results, running output, and diffs", () => {
    const calls = [
      { type: "toolCall", id: "a", name: "bash", arguments: { command: "ls" } },
      { type: "toolCall", id: "b", name: "edit", arguments: { path: "x.ts" } },
      { type: "toolCall", id: "c", name: "read", arguments: { path: "y.ts" } },
      { type: "toolCall", id: "d", name: "read", arguments: { path: "z.ts" } },
    ];
    const { items } = toTranscript(
      view(
        [
          {
            id: 1,
            kind: "pi.assistant",
            model: [assistant([{ type: "thinking", thinking: "plan" }, { type: "text", text: "Looking" }, ...calls])],
          },
          {
            id: 2,
            kind: "pi.tool-result",
            model: [
              {
                role: "toolResult",
                toolCallId: "a",
                toolName: "bash",
                content: [{ type: "text", text: "a.ts" }],
                isError: false,
              },
            ],
          },
          {
            id: 3,
            kind: "pi.tool-result",
            model: [
              {
                role: "toolResult",
                toolCallId: "b",
                toolName: "edit",
                content: [{ type: "text", text: "Replaced" }],
                details: { diff: "-1 old\n+1 new" },
                isError: true,
              },
            ],
          },
        ],
        { "pi.live": { ...busy, tools: [{ callId: "c", status: "running", output: "partial" }] } },
      ),
    );
    expect(items[0]).toMatchObject({
      parts: [
        { kind: "thinking", text: "plan" },
        { kind: "text", text: "Looking" },
        { kind: "tool", callId: "a", status: "done", output: "a.ts" },
        { kind: "tool", callId: "b", status: "failed", output: "Replaced", diff: "-1 old\n+1 new" },
        { kind: "tool", callId: "c", status: "running", output: "partial" },
        { kind: "tool", callId: "d", status: "pending", output: "" },
      ],
    });
    // Tools are running, so the agent is not silent.
    expect(items).toHaveLength(1);
  });

  test("adds the answer being generated and the queued messages while busy", () => {
    const transcript = toTranscript(
      view([], {
        "pi.live": { ...busy, generation: { attempt: 2, message: assistant("partial") } },
        "pi.inbox": {
          items: [
            { id: 4, mode: "steer", content: "look here" },
            { id: 5, mode: "followUp", content: [{ type: "text", text: "then this" }] },
            { id: 6, mode: "write", entry: {} },
          ],
        },
      }),
    );
    expect(transcript.items).toEqual([
      { kind: "assistant", key: "streaming:2", parts: [{ kind: "text", text: "partial" }], ending: "streaming" },
    ]);
    expect(transcript.busy).toBe(true);
    expect(transcript.queued).toEqual([
      { id: 4, mode: "steer", text: "look here", images: 0 },
      { id: 5, mode: "followUp", text: "then this", images: 0 },
    ]);
  });

  test("tells when the agent is silent, and whether the turn has shown anything yet", () => {
    const user = { id: 1, kind: "pi.user", model: [{ role: "user", content: "go" }] };
    const before = toTranscript(view([user], { "pi.live": { ...busy, generation: { attempt: 1 } } }));
    expect(before).toMatchObject({ silent: true, turnHasContent: false });

    const answered = { id: 2, kind: "pi.assistant", model: [assistant("step one", "toolUse")] };
    const between = toTranscript(view([user, answered], { "pi.live": busy }));
    expect(between).toMatchObject({ silent: true, turnHasContent: true });

    const streaming = toTranscript(
      view([user], { "pi.live": { ...busy, generation: { attempt: 1, message: assistant("hi") } } }),
    );
    expect(streaming.silent).toBe(false);

    const compacting = toTranscript(view([user, answered], { "pi.live": { compactions: [{ taskId: 3 }] } }));
    expect(compacting).toMatchObject({ silent: false });
    expect(compacting.items.at(-1)).toEqual({ kind: "compacting", key: "compacting" });
  });

  test("counts the context the last answer used, the spend, and starts over after a compaction", () => {
    const usage = (totalTokens: number) => ({ ...noUsage, totalTokens });
    const entries = [
      { id: 1, kind: "pi.assistant", model: [assistant("one", "stop", { usage: usage(5000) })] },
      { id: 2, kind: "pi.assistant", model: [assistant("two", "stop", { usage: usage(7000) })] },
    ];
    const docs = {
      "pi.usage": { models: { "a/b": { cost: { total: 0.25 } } }, tools: { bash: { cost: { total: 0.05 } } } },
    };
    expect(toTranscript(view(entries, docs)).usage).toEqual({ tokens: 7000, cost: 0.3 });
    const compacted = toTranscript(view([...entries, { id: 3, kind: "pi.compaction", model: [] }], docs));
    expect(compacted.usage.tokens).toBe(0);
    expect(compacted.items.at(-1)).toEqual({ kind: "compaction", key: "3" });
  });

  test("keeps the images of user messages, tool results, and queued messages", () => {
    const ref = (block: number) => ({ conversationId: 1, entryId: 1, message: 0, block });
    const transcript = toTranscript(
      view(
        [
          {
            id: 1,
            kind: "pi.user",
            model: [
              {
                role: "user",
                content: [
                  { type: "text", text: "see" },
                  { type: "image", mimeType: "image/png", ref: ref(1) },
                ],
              },
            ],
          },
          {
            id: 2,
            kind: "pi.assistant",
            model: [assistant([{ type: "toolCall", id: "r", name: "read", arguments: { path: "a.png" } }], "toolUse")],
          },
          {
            id: 3,
            kind: "pi.tool-result",
            model: [
              {
                role: "toolResult",
                toolCallId: "r",
                toolName: "read",
                content: [{ type: "image", mimeType: "image/jpeg", ref: ref(0) }],
                isError: false,
              },
            ],
          },
        ],
        { "pi.inbox": { items: [{ id: 9, mode: "followUp", content: [{ type: "image", mimeType: "image/png" }] }] } },
      ),
    );
    expect(transcript.items[0]).toMatchObject({
      kind: "user",
      text: "see",
      images: [{ mimeType: "image/png", ref: ref(1) }],
    });
    const [tool] = (transcript.items[1] as Extract<(typeof transcript.items)[number], { kind: "assistant" }>).parts;
    expect(tool).toMatchObject({ kind: "tool", status: "done", images: [{ mimeType: "image/jpeg" }] });
    expect(transcript.queued).toEqual([{ id: 9, mode: "followUp", text: "", images: 1 }]);
  });
});
