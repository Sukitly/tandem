// @vitest-environment jsdom

import type { PromptTemplateSummary } from "@tandem/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ChatComposer } from "../src/chat/chat-composer.tsx";

vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => window.innerWidth < 768 }));
vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ openChange: vi.fn() })),
);

// The box scrolls the highlighted row into view itself; jsdom has no layout.
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

const commands: PromptTemplateSummary[] = [
  { name: "review", description: "Review the changes", argumentHint: "[focus]", origin: "project" },
  { name: "commit", description: "Write a commit", origin: "global" },
];

function composer() {
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(
    createElement(ChatComposer, {
      busy: false,
      queued: [],
      commands,
      onSend,
      onStop: vi.fn(),
      imageSupport: { kind: "accepted" },
    }),
  );
  return { textarea: screen.getByLabelText("Message") as HTMLTextAreaElement, onSend };
}

function type(textarea: HTMLTextAreaElement, value: string): void {
  fireEvent.change(textarea, { target: { value } });
}

/** Press a key on the box; `true` when the box took the key from the browser. */
function press(textarea: HTMLTextAreaElement, init: KeyboardEventInit): boolean {
  // `fireEvent` returns false when the event was cancelled, which is our "took the key".
  return fireEvent.keyDown(textarea, init) === false;
}

/** The commands the menu offers, by name. */
function offered(): string[] {
  return screen.queryAllByRole("option").map((item) => item.textContent?.match(/\/([a-z][a-z0-9-]*)/)?.[1] ?? "");
}

describe("chat composer commands", () => {
  test("a message beginning with a slash offers the matching commands", () => {
    const { textarea } = composer();
    type(textarea, "/");
    expect(offered()).toEqual(["review", "commit"]);

    type(textarea, "/com");
    expect(offered()).toEqual(["commit"]);
  });

  test("Tab fills the highlighted command into the box, and the menu closes once an argument follows", () => {
    const { textarea } = composer();
    type(textarea, "/");
    press(textarea, { key: "ArrowDown" });
    press(textarea, { key: "Tab" });
    expect(textarea.value).toBe("/commit ");

    // The argument is being typed, so there is nothing left to complete.
    expect(offered()).toEqual([]);
  });

  test("Enter fills the highlighted command in and sends it in one gesture", async () => {
    const { textarea, onSend } = composer();
    type(textarea, "/rev");
    expect(press(textarea, { key: "Enter" })).toBe(true);
    // The settled command is what goes out, not the half-typed `/rev` the server could not expand.
    expect(onSend).toHaveBeenCalledWith("/review ", [], [], "steer");
    expect(textarea.value).toBe("/review ");
    await waitFor(() => expect(textarea.value).toBe(""));
  });

  test("Escape dismisses the menu until the message changes", () => {
    const { textarea } = composer();
    type(textarea, "/");
    press(textarea, { key: "Escape" });
    expect(offered()).toEqual([]);

    type(textarea, "/c");
    expect(offered()).toEqual(["commit"]);
  });

  test("an ordinary message offers nothing", () => {
    const { textarea } = composer();
    type(textarea, "hello /review");
    expect(offered()).toEqual([]);
  });

  test("ordinary typing keeps its keys, menu open or not", () => {
    const { textarea } = composer();
    // A space and a Shift+Enter newline are the browser's, whether or not the menu is up: the box must not swallow
    // them, or the message cannot be written past the first word.
    expect(press(textarea, { key: " " })).toBe(false);
    expect(press(textarea, { key: "Enter", shiftKey: true })).toBe(false);

    type(textarea, "/rev");
    expect(press(textarea, { key: " " })).toBe(false);
    expect(press(textarea, { key: "Enter", shiftKey: true })).toBe(false);

    // Only the keys the menu owns are taken.
    expect(press(textarea, { key: "ArrowDown" })).toBe(true);
    expect(press(textarea, { key: "Escape" })).toBe(true);
  });

  test("the box is a combobox whose listbox and active row are named", () => {
    const { textarea } = composer();
    expect(textarea.getAttribute("role")).toBe("combobox");
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(textarea.getAttribute("aria-activedescendant")).toBeNull();

    type(textarea, "/");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    // `aria-controls` names the listbox, and `aria-activedescendant` the highlighted row within it.
    const controls = textarea.getAttribute("aria-controls");
    expect(document.getElementById(controls as string)?.getAttribute("role")).toBe("listbox");
    const first = textarea.getAttribute("aria-activedescendant");
    expect(document.getElementById(first as string)?.textContent).toContain("/review");

    press(textarea, { key: "ArrowDown" });
    const second = textarea.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(document.getElementById(second as string)?.textContent).toContain("/commit");
  });

  test("a press outside the box dismisses the menu, one in it does not", () => {
    const { textarea } = composer();
    type(textarea, "/c");
    fireEvent.pointerDown(textarea);
    expect(offered()).toEqual(["commit"]);

    fireEvent.pointerDown(document.body);
    expect(offered()).toEqual([]);
  });
});
