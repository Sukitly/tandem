// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AppSidebarProvider } from "../src/app/sidebar-provider.tsx";
import { ChatComposer } from "../src/chat/chat-composer.tsx";
import { SidebarTrigger, useSidebar } from "../src/components/ui/sidebar.tsx";

vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => false }));
vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ openChange: vi.fn() })),
);

afterEach(() => {
  cleanup();
  localStorage.removeItem("tandem.keyboardMode");
});

function SidebarState() {
  return createElement("output", { "aria-label": "Sidebar state" }, useSidebar().state);
}

function workbench(defaultOpen = true) {
  return render(
    createElement(
      AppSidebarProvider,
      { defaultOpen },
      createElement(SidebarState),
      createElement(SidebarTrigger),
      createElement(ChatComposer, {
        busy: false,
        queued: [],
        imageSupport: { kind: "none" },
        onSend: vi.fn().mockResolvedValue(undefined),
        onStop: vi.fn(),
      }),
      createPortal(createElement("input", { "aria-label": "Dialog input" }), document.body),
    ),
  );
}

const sidebarState = () => screen.getByLabelText("Sidebar state").textContent;

describe("sidebar shortcuts", () => {
  test.each([true, false])("Ctrl+B edits the message without toggling the sidebar (open: %s)", (open) => {
    localStorage.setItem("tandem.keyboardMode", "emacs");
    workbench(open);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    textarea.setSelectionRange(3, 3);

    expect(fireEvent.keyDown(textarea, { key: "b", ctrlKey: true })).toBe(false);
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.value).toBe("hello");
    expect(sidebarState()).toBe(open ? "expanded" : "collapsed");
  });

  test("disables conflicting Ctrl+B throughout the page", () => {
    workbench();
    for (const target of [screen.getByLabelText("Message"), screen.getByLabelText("Dialog input"), document.body]) {
      fireEvent.keyDown(target, { key: "b", ctrlKey: true });
      expect(sidebarState()).toBe("expanded");
    }
  });

  test.each([{ metaKey: true }, { ctrlKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }])(
    "does not intercept non-conflicting modifier combinations: %o",
    (modifiers) => {
      const listener = vi.fn();
      window.addEventListener("keydown", listener);
      try {
        workbench();
        fireEvent.keyDown(document.body, { key: "b", ...modifiers });
        expect(listener).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener("keydown", listener);
      }
    },
  );

  test("sidebar buttons still toggle normally", () => {
    workbench();
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(sidebarState()).toBe("collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(sidebarState()).toBe("expanded");
  });

  test("does not intercept unrelated global keys and removes the listener on unmount", () => {
    const listener = vi.fn();
    window.addEventListener("keydown", listener);
    try {
      const { unmount } = workbench();
      fireEvent.keyDown(document.body, { key: "b" });
      fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });
      expect(listener).toHaveBeenCalledTimes(2);
      fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
      expect(listener).toHaveBeenCalledTimes(2);
      unmount();
      fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
      expect(listener).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });
});
