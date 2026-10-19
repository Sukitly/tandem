// @vitest-environment jsdom

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ProjectDirectory } from "@tandem/contracts";
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AddProjectDialog } from "../src/app/add-project-dialog.tsx";
import { cleanup, fireEvent, render, screen, waitFor } from "./render.tsx";

const workspaces = vi.hoisted(() => ({ browse: vi.fn(), add: vi.fn() }));

vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ workspaces }),
}));

const home: ProjectDirectory = {
  path: "/home/user",
  parent: "/home",
  directories: [{ name: "app", path: "/home/user/app" }],
};
const child: ProjectDirectory = { path: "/home/user/app", parent: home.path, directories: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Harness() {
  const [open, setOpen] = useState(true);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Open picker"),
    createElement(AddProjectDialog, { open, onOpenChange: setOpen }),
  );
}

async function selected(path: string): Promise<void> {
  await waitFor(() => expect(screen.getByRole("status", { name: "Selected directory" }).textContent).toBe(path));
}

function disabled(name: string): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}

beforeEach(() => {
  workspaces.browse.mockReset().mockResolvedValue(home);
  workspaces.add.mockReset().mockResolvedValue(1);
});

afterEach(cleanup);

describe("add project dialog interactions", () => {
  test("loads directories, opens a child, and submits only the selected path", async () => {
    const loading = deferred<ProjectDirectory>();
    workspaces.browse.mockReturnValueOnce(loading.promise).mockResolvedValueOnce(child);
    render(createElement(Harness));
    expect(disabled("Add project")).toBe(true);
    expect(workspaces.browse).toHaveBeenCalledWith(null, BACKGROUND_CONTEXT);
    await act(async () => loading.resolve(home));
    await selected(home.path);
    fireEvent.click(screen.getByRole("button", { name: "app" }));
    await selected(child.path);
    expect(workspaces.browse).toHaveBeenLastCalledWith(child.path, BACKGROUND_CONTEXT);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(workspaces.add).toHaveBeenCalledExactlyOnceWith({ path: child.path }, BACKGROUND_CONTEXT);
  });

  test("navigates to the parent and home and submits the parent directory", async () => {
    const parent: ProjectDirectory = { path: "/home", parent: "/", directories: [] };
    workspaces.browse.mockResolvedValueOnce(home).mockResolvedValueOnce(parent).mockResolvedValueOnce(home);
    render(createElement(Harness));
    await selected(home.path);
    fireEvent.click(screen.getByRole("button", { name: "Parent directory" }));
    await selected(parent.path);
    expect(workspaces.browse).toHaveBeenLastCalledWith(parent.path, BACKGROUND_CONTEXT);
    fireEvent.click(screen.getByRole("button", { name: "Home directory" }));
    await selected(home.path);
    expect(workspaces.browse).toHaveBeenLastCalledWith(null, BACKGROUND_CONTEXT);
    workspaces.browse.mockResolvedValueOnce(parent);
    fireEvent.click(screen.getByRole("button", { name: "Parent directory" }));
    await selected(parent.path);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(workspaces.add).toHaveBeenCalledWith({ path: parent.path }, BACKGROUND_CONTEXT));
  });

  test("retries failed reads without allowing a stale directory to be added", async () => {
    workspaces.browse.mockRejectedValueOnce(new Error("Home unavailable"));
    render(createElement(Harness));
    await screen.findByText("Home unavailable");
    expect(disabled("Add project")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await selected(home.path);
    expect(screen.queryByText("Home unavailable")).toBeNull();
    workspaces.browse.mockRejectedValueOnce(new Error("Permission denied"));
    fireEvent.click(screen.getByRole("button", { name: "app" }));
    await screen.findByText("Permission denied");
    expect(disabled("Add project")).toBe(true);
    expect(screen.getByRole("status", { name: "Selected directory" }).textContent).toBe("Choose a directory");
    workspaces.browse.mockResolvedValueOnce(child);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await selected(child.path);
    expect(workspaces.browse).toHaveBeenLastCalledWith(child.path, BACKGROUND_CONTEXT);
    expect(disabled("Add project")).toBe(false);
  });

  test("ignores a pending read after closing and reopening the dialog", async () => {
    const previous = deferred<ProjectDirectory>();
    const current = deferred<ProjectDirectory>();
    workspaces.browse.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    render(createElement(Harness));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open picker" }));
    await waitFor(() => expect(workspaces.browse).toHaveBeenCalledTimes(2));
    await act(async () => previous.resolve(child));
    expect(disabled("Add project")).toBe(true);
    expect(screen.getByRole("status", { name: "Selected directory" }).textContent).toBe("Choose a directory");
    await act(async () => current.resolve(home));
    await selected(home.path);
  });

  test("keeps the selected path after a refused add and allows resubmission", async () => {
    workspaces.add.mockRejectedValueOnce(new Error("Directory no longer exists"));
    render(createElement(Harness));
    await selected(home.path);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    await screen.findByText("Directory no longer exists");
    expect(disabled("Add project")).toBe(false);
    await selected(home.path);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(workspaces.add).toHaveBeenCalledTimes(2);
    expect(workspaces.add).toHaveBeenLastCalledWith({ path: home.path }, BACKGROUND_CONTEXT);
  });

  test("does not close a reopened dialog when a previous add completes", async () => {
    const previous = deferred<number>();
    workspaces.add.mockReturnValueOnce(previous.promise);
    render(createElement(Harness));
    await selected(home.path);
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(disabled("Loading Add project")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open picker" }));
    await selected(home.path);
    await act(async () => previous.resolve(1));
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(disabled("Add project")).toBe(false);
  });

  test("refuses form submission while browsing or while an add is in flight", async () => {
    const loading = deferred<ProjectDirectory>();
    const adding = deferred<number>();
    workspaces.browse.mockReturnValueOnce(loading.promise);
    workspaces.add.mockReturnValueOnce(adding.promise);
    render(createElement(Harness));
    const form = document.querySelector("form");
    if (form === null) throw new Error("Missing project form");
    fireEvent.submit(form);
    expect(workspaces.add).not.toHaveBeenCalled();
    await act(async () => loading.resolve(home));
    await selected(home.path);
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(workspaces.add).toHaveBeenCalledTimes(1));
    await act(async () => adding.resolve(1));
  });
});
