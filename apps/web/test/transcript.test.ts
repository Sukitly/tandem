import type { ConversationView } from "@tandem/contracts";
import { describe, expect, test } from "vitest";
import { compactionHead, toTranscript } from "../src/chat/transcript.ts";

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

  test("aggregates consecutive failed attempts with no parts into one item with attempts count", () => {
    const { items } = toTranscript(
      view([
        { id: 1, kind: "pi.assistant", model: [assistant([], "error", { errorMessage: "first failure" })] },
        { id: 2, kind: "pi.assistant", model: [assistant([], "error", { errorMessage: "second failure" })] },
      ]),
    );
    expect(items).toEqual([
      { kind: "assistant", key: "1:0", parts: [], ending: "failed", error: "second failure", attempts: 2 },
    ]);
  });

  test("de-emphasizes a failure only after later content in the same turn", () => {
    const failed = {
      id: 1,
      kind: "pi.assistant",
      model: [assistant([], "error", { errorMessage: "WebSocket error" })],
    };
    const progress = { id: 2, kind: "pi.assistant", model: [assistant("Continuing")] };
    expect(toTranscript(view([failed, progress])).items[0]).toMatchObject({ ending: "failed", continued: true });
    const newTurn = { id: 3, kind: "pi.user", model: [{ role: "user", content: "Try again" }] };
    expect(toTranscript(view([failed, newTurn, progress])).items[0]).not.toHaveProperty("continued");
  });

  test("uses live content as evidence of continuation, but does not infer retrying from a busy run", () => {
    const failed = {
      id: 1,
      kind: "pi.assistant",
      model: [assistant([], "error", { errorMessage: "WebSocket error" })],
    };
    const before = toTranscript(view([failed], { "pi.live": { ...busy, generation: { attempt: 2 } } }));
    expect(before.items[0]).not.toHaveProperty("continued");
    const after = toTranscript(
      view([failed], { "pi.live": { ...busy, generation: { attempt: 2, message: assistant("Continuing") } } }),
    );
    expect(after.items[0]).toMatchObject({ ending: "failed", continued: true });
  });

  test("empty or interrupted answers do not establish continuation after a failure", () => {
    for (const message of [assistant([]), assistant("partial", "aborted")]) {
      const { items } = toTranscript(
        view([
          { id: 1, kind: "pi.assistant", model: [assistant([], "error", { errorMessage: "WebSocket error" })] },
          { id: 2, kind: "pi.assistant", model: [message] },
        ]),
      );
      expect(items[0]).not.toHaveProperty("continued");
    }
  });

  test("puts thinking, text, and tool calls in order, with results, running output, and patches", () => {
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
                details: { patch: "--- x.ts\n+++ x.ts\n@@ -1 +1 @@\n-old\n+new\n" },
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
        {
          kind: "tool",
          callId: "b",
          status: "failed",
          output: "Replaced",
          patch: "--- x.ts\n+++ x.ts\n@@ -1 +1 @@\n-old\n+new\n",
        },
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
      { id: 4, mode: "steer", text: "look here", imageCount: 0 },
      { id: 5, mode: "followUp", text: "then this", imageCount: 0 },
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
    expect(compacting.items.at(-1)).toEqual({ kind: "compacting", key: "compacting", retrying: false });

    // An attempt that failed has a `retry`; the line says another follows.
    const retrying = toTranscript(
      view([user, answered], { "pi.live": { compactions: [{ taskId: 3, retry: { at: 1, error: "overloaded" } }] } }),
    );
    expect(retrying.items.at(-1)).toEqual({ kind: "compacting", key: "compacting", retrying: true });
  });

  test("counts the context the last answer used, the spend, and starts over at a compaction", () => {
    const usage = (totalTokens: number) => ({ ...noUsage, totalTokens });
    const entries = [
      { id: 1, kind: "pi.assistant", model: [assistant("one", "stop", { usage: usage(5000) })] },
      { id: 2, kind: "pi.assistant", model: [assistant("two", "stop", { usage: usage(7000) })] },
    ];
    const docs = {
      "pi.usage": { models: { "a/b": { cost: { total: 0.25 } } }, tools: { bash: { cost: { total: 0.05 } } } },
    };
    expect(toTranscript(view(entries, docs)).usage).toEqual({ tokens: 7000, cost: 0.3 });
    // The view drops what the summary replaced and puts the compaction first, so the line heads what was kept.
    const compacted = toTranscript(view([{ id: 3, kind: "pi.compaction", model: [] }, ...entries], docs));
    expect(compacted.items[0]).toEqual({ kind: "compaction", key: "3" });
    // The kept answers were written before it and report the context as it was, so nothing is counted yet.
    expect(compacted.usage.tokens).toBe(0);
    // The first answer after it is the one that reports how much the summary left.
    const answered = toTranscript(
      view(
        [
          { id: 3, kind: "pi.compaction", model: [] },
          ...entries,
          { id: 4, kind: "pi.assistant", model: [assistant("three", "stop", { usage: usage(2000) })] },
        ],
        docs,
      ),
    );
    expect(answered.usage.tokens).toBe(2000);
  });

  describe("entries from before a compaction", () => {
    const compaction = { id: 9, kind: "pi.compaction", model: [] };
    const kept = [
      { id: 5, kind: "pi.user", model: [{ role: "user", content: "kept question" }] },
      {
        id: 6,
        kind: "pi.assistant",
        model: [assistant("kept answer", "stop", { usage: { ...noUsage, totalTokens: 9000 } })],
      },
    ];
    const older = [
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "old question" }] },
      {
        id: 2,
        kind: "pi.assistant",
        model: [assistant([{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }])],
      },
      {
        id: 3,
        kind: "pi.tool-result",
        model: [{ role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "a.ts" }] }],
      },
      { id: 4, kind: "pi.assistant", model: [assistant("old answer")] },
    ];

    test("go above the compaction, marked as earlier, with the line between them and what was kept", () => {
      const { items } = toTranscript(view([compaction, ...kept]), view(older).entries);
      expect(items.map((item) => [item.kind, item.key, "earlier" in item ? item.earlier : undefined])).toEqual([
        ["user", "1:0", true],
        ["assistant", "2:0", true],
        ["assistant", "4:0", true],
        ["compaction", "9", undefined],
        ["user", "5:0", undefined],
        ["assistant", "6:0", undefined],
      ]);
    });

    test("show the results of their tool calls", () => {
      const { items } = toTranscript(view([compaction, ...kept]), view(older).entries);
      expect(items[1]).toMatchObject({ parts: [{ kind: "tool", callId: "c1", output: "a.ts" }] });
    });

    test("do not count towards the context, and leave one line for the compaction", () => {
      const olderCompaction = { id: 3, kind: "pi.compaction", model: [] };
      const earlier = view([
        older[0],
        olderCompaction,
        {
          id: 4,
          kind: "pi.assistant",
          model: [assistant("then", "stop", { usage: { ...noUsage, totalTokens: 50_000 } })],
        },
      ]).entries;
      const transcript = toTranscript(view([compaction, ...kept]), earlier);
      expect(transcript.items.filter((item) => item.kind === "compaction")).toHaveLength(1);
      expect(transcript.usage.tokens).toBe(0);
    });

    test("are what compactionHead says the view left out: those before the first entry it kept", () => {
      expect(compactionHead(view([compaction, ...kept]))).toEqual({ id: 9, firstKept: 5 });
      // Nothing kept: everything before the compaction itself.
      expect(compactionHead(view([compaction]))).toEqual({ id: 9, firstKept: 9 });
      expect(compactionHead(view(kept))).toBeUndefined();
      expect(compactionHead(view([]))).toBeUndefined();
    });
  });

  test("keeps the images of user messages, tool results, and queued messages", () => {
    const ref = (blockIndex: number) => ({ conversationId: 1, entryId: 1, messageIndex: 0, blockIndex });
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
    expect(transcript.queued).toEqual([{ id: 9, mode: "followUp", text: "", imageCount: 1 }]);
  });
});
