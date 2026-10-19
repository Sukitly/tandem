// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { createWorkbenchStore } from "../src/app/workbench-store.ts";

beforeEach(() => localStorage.clear());

test("workbenches isolate UI state and keep actions stable", () => {
  const first = createWorkbenchStore(false);
  const second = createWorkbenchStore(false);
  const showTab = first.getState().showTab;
  first.getState().showTab("terminal");
  expect(first.getState().panelTab).toBe("terminal");
  expect(second.getState().panelTab).toBe("files");
  expect(first.getState().showTab).toBe(showTab);
  expect(Object.keys(first.getState())).not.toContain("conversations");
  expect(Object.keys(first.getState())).not.toContain("files");
});

test("which page is open is the address, so the store keeps no copy of it", () => {
  const keys = Object.keys(createWorkbenchStore(false).getState());
  for (const name of ["selected", "draft", "select", "newConversation", "followRoute"])
    expect(keys).not.toContain(name);
});

test("mobile dismissal does not overwrite the desktop preference", () => {
  const store = createWorkbenchStore(false);
  store.getState().showFiles(true);
  store.getState().setMobile(true);
  expect(store.getState().filesShown).toBe(false);
  store.getState().showFiles(false);
  expect(localStorage.getItem("tandem.filesShown")).toBe("true");
  store.getState().setMobile(false);
  expect(store.getState().filesShown).toBe(true);
});
