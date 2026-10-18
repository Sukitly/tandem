// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { createWorkbenchStore } from "../src/app/workbench-store.ts";

beforeEach(() => localStorage.clear());

test("workbenches isolate UI state and keep actions stable", () => {
  const first = createWorkbenchStore(false, "#12");
  const second = createWorkbenchStore(false, "#13");
  const showTab = first.getState().showTab;
  first.getState().showTab("terminal");
  expect(first.getState().panelTab).toBe("terminal");
  expect(second.getState().panelTab).toBe("files");
  expect(first.getState().showTab).toBe(showTab);
  expect(Object.keys(first.getState())).not.toContain("conversations");
  expect(Object.keys(first.getState())).not.toContain("files");
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

test("only workspace routes change retained conversation intent", () => {
  const store = createWorkbenchStore(false, "#12");
  store.getState().followRoute({ kind: "publicAccess" });
  store.getState().followRoute({ kind: "unknown", hash: "#future" });
  expect(store.getState().selected).toBe(12);
  store.getState().followRoute({ kind: "conversation", id: 13 });
  expect(store.getState().selected).toBe(13);
  store.getState().followRoute({ kind: "none" });
  expect(store.getState().selected).toBeNull();
});
