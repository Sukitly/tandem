// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ChatComposer } from "../src/chat/chat-composer.tsx";

vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => window.innerWidth < 768 }));
vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ openChange: vi.fn() })),
);
Element.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem("tandem.keyboardMode");
  localStorage.removeItem("tandem.sendMode");
});
function setup(busy = true, stopping = false) {
  const send = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn();
  render(
    <ChatComposer
      busy={busy}
      stopping={stopping}
      queued={[]}
      imageSupport={{ kind: "none" }}
      onSend={send}
      onStop={stop}
      commands={[{ name: "review", description: "Review changes", origin: "project" }]}
    />,
  );
  const input = screen.getByRole("combobox", { name: "Message" }) as HTMLTextAreaElement;
  return { send, stop, input };
}
test("while the agent works, an empty box offers Stop and a message offers Send", () => {
  const { input, stop } = setup();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(stop).toHaveBeenCalledOnce();

  fireEvent.change(input, { target: { value: "Next message" } });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();

  fireEvent.change(input, { target: { value: "" } });
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
});
test("when the agent is idle, only Send is offered", () => {
  setup(false);
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
});
test("Stop remains reachable while a send is pending", async () => {
  const { input, send, stop } = setup();
  let finish!: () => void;
  send.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.change(input, { target: { value: "Next message" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Send" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(stop).toHaveBeenCalledOnce();
  finish();
  await waitFor(() => expect(input.value).toBe(""));
});
test("a refused message stays in the box and brings Send back", async () => {
  const { input, send } = setup();
  send.mockRejectedValueOnce(new Error("refused"));
  fireEvent.change(input, { target: { value: "Next message" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
  expect(input.value).toBe("Next message");
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});
test("Escape stops the agent, with a message in the box or without, and the message stays", () => {
  const { input, send, stop } = setup();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(stop).toHaveBeenCalledTimes(1);

  fireEvent.change(input, { target: { value: "Draft" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(stop).toHaveBeenCalledTimes(2);
  expect(input.value).toBe("Draft");
  expect(send).not.toHaveBeenCalled();
});
test("a held Escape stops the agent once", () => {
  const { input, stop } = setup();
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.keyDown(input, { key: "Escape", repeat: true });
  fireEvent.keyDown(input, { key: "Escape", repeat: true });
  expect(stop).toHaveBeenCalledOnce();
});
test("Escape does nothing while the agent is idle or already stopping", () => {
  const idle = setup(false);
  fireEvent.keyDown(idle.input, { key: "Escape" });
  expect(idle.stop).not.toHaveBeenCalled();
  cleanup();

  const stopping = setup(true, true);
  fireEvent.keyDown(stopping.input, { key: "Escape" });
  expect(stopping.stop).not.toHaveBeenCalled();
});
test("Escape in a composition, or with a modifier, does not stop the agent", () => {
  const { input, stop } = setup();
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  fireEvent.keyDown(input, { key: "Escape", shiftKey: true });
  fireEvent.keyDown(input, { key: "Escape", ctrlKey: true });
  expect(stop).not.toHaveBeenCalled();
});
test("Escape puts the slash command menu away before it stops the agent", () => {
  const { input, stop } = setup();
  fireEvent.change(input, { target: { value: "/" } });
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(stop).not.toHaveBeenCalled();

  fireEvent.keyDown(input, { key: "Escape" });
  expect(stop).toHaveBeenCalledOnce();
});
test("mobile follow-up can be selected and sent without a modifier key", async () => {
  vi.stubGlobal("innerWidth", 390);
  const { input, send } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Composer options" }));
  // A touch screen chooses how a message is sent, not keyboard shortcuts.
  expect(await screen.findByRole("menuitemradio", { name: "Steer current turn" })).toBeTruthy();
  expect(screen.queryByRole("menuitemradio", { name: "Emacs editing" })).toBeNull();
  expect(screen.queryByRole("menuitemradio", { name: "Platform defaults" })).toBeNull();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Queue follow-up" }));
  fireEvent.change(input, { target: { value: "Later" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(send).toHaveBeenCalledWith("Later", [], [], "followUp");
  expect(localStorage.getItem("tandem.sendMode")).toBe("followUp");
  await waitFor(() => expect(input.value).toBe(""));
});
test("desktop ignores the saved mobile mode for Enter, slash commands, and the send button", async () => {
  localStorage.setItem("tandem.sendMode", "followUp");
  const { input, send } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Composer options" }));
  expect(await screen.findByRole("menuitemradio", { name: "Emacs editing" })).toBeTruthy();
  expect(screen.queryByRole("menuitemradio", { name: "Queue follow-up" })).toBeNull();
  expect(screen.queryByRole("menuitemradio", { name: "Steer current turn" })).toBeNull();
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
  for (const text of ["Steer now", "/rev"]) {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenLastCalledWith(text === "/rev" ? "/review " : text, [], [], "steer");
    await waitFor(() => expect(input.value).toBe(""));
  }
  fireEvent.change(input, { target: { value: "Button" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(send).toHaveBeenLastCalledWith("Button", [], [], "steer");
  await waitFor(() => expect(input.value).toBe(""));
  fireEvent.change(input, { target: { value: "Later" } });
  fireEvent.keyDown(input, { key: "Enter", altKey: true });
  expect(send).toHaveBeenLastCalledWith("Later", [], [], "followUp");
  await waitFor(() => expect(input.value).toBe(""));
  expect(localStorage.getItem("tandem.sendMode")).toBe("followUp");
});
test("platform shortcuts and native history are not intercepted by default; Emacs is opt-in", async () => {
  const { input } = setup(false);
  fireEvent.change(input, { target: { value: "hello world" } });
  for (const key of ["a", "f", "b", "y", "z"]) expect(fireEvent.keyDown(input, { key, ctrlKey: true })).toBe(true);
  expect(
    fireEvent(input, new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true })),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Composer options" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Emacs editing" }));
  input.setSelectionRange(5, 5);
  expect(fireEvent.keyDown(input, { key: "k", ctrlKey: true })).toBe(false);
  expect(input.value).toBe("hello");
  expect(localStorage.getItem("tandem.keyboardMode")).toBe("emacs");
});
test("slash options activate through click and restore combobox focus", () => {
  const { input, send } = setup(false);
  fireEvent.change(input, { target: { value: "/" } });
  fireEvent.click(screen.getByRole("option", { name: /review/ }));
  expect(input.value).toBe("/review ");
  expect(document.activeElement).toBe(input);
  expect(send).not.toHaveBeenCalled();
});
