import type { ConversationView } from "@tandem/contracts";
import { describe, expect, test } from "vitest";
import { toTranscript } from "../src/chat/transcript.ts";

type Entry = ConversationView["entries"][number];

function view(entries: unknown[], docs: Record<string, unknown> = {}): ConversationView {
  return { conversation: { id: 1 }, entries: entries as Entry[], docs } as unknown as ConversationView;
}

function assistant(text: string, stopReason = "stop", errorMessage?: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
  };
}

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
        { kind: "user", key: "1:0", text: "hi" },
        { kind: "assistant", key: "3:0", text: "hello", ending: "complete" },
      ],
      busy: false,
      queued: [],
    });
  });

  test("marks interrupted and failed answers", () => {
    const { items } = toTranscript(
      view([
        { id: 1, kind: "pi.assistant", model: [assistant("half", "aborted")] },
        { id: 2, kind: "pi.assistant", model: [assistant("", "error", "rate limited")] },
      ]),
    );
    expect(items).toEqual([
      { kind: "assistant", key: "1:0", text: "half", ending: "interrupted" },
      { kind: "assistant", key: "2:0", text: "", ending: "failed", error: "rate limited" },
    ]);
  });

  test("adds the answer being generated and the queued messages while busy", () => {
    const transcript = toTranscript(
      view([], {
        "pi.live": { run: { taskId: 1, inputs: [1] }, generation: { attempt: 2, message: assistant("partial") } },
        "pi.inbox": {
          items: [
            { id: 4, mode: "steer", content: "look here" },
            { id: 5, mode: "followUp", content: [{ type: "text", text: "then this" }] },
            { id: 6, mode: "write", entry: {} },
          ],
        },
      }),
    );
    expect(transcript).toEqual({
      items: [{ kind: "streaming", key: "streaming:2", text: "partial" }],
      busy: true,
      queued: [
        { id: 4, mode: "steer", text: "look here" },
        { id: 5, mode: "followUp", text: "then this" },
      ],
    });
  });

  test("shows a pending answer before its first words", () => {
    const { items } = toTranscript(
      view([], { "pi.live": { run: { taskId: 1, inputs: [1] }, generation: { attempt: 1 } } }),
    );
    expect(items).toEqual([{ kind: "streaming", key: "streaming:1", text: "" }]);
  });
});
