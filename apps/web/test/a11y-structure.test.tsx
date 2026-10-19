// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EmptyWorkspace } from "../src/app/empty-workspace.tsx";
import { NotFoundPage } from "../src/app/pages.tsx";
import { PairScreen } from "../src/auth/pair-screen.tsx";
import { renderInRouter } from "./in-router.tsx";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock("../src/app/sidebar-brand.tsx", () => ({ SidebarToggle: () => null }));
vi.mock("../src/app/sidebar.tsx", () => ({ SidebarToggle: () => null }));

test("the pairing screen has a main landmark and a level-one heading", () => {
  render(<PairScreen />);
  expect(screen.getByRole("main")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Pair this device");
});

test("a workspace without an open conversation has a level-one heading", () => {
  const { rerender } = render(<EmptyWorkspace empty={true} addProject={() => {}} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Add a project");

  rerender(<EmptyWorkspace empty={false} addProject={() => {}} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("No conversation open");
});

test("a page that is not found has a level-one heading", async () => {
  await renderInRouter(<NotFoundPage />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Page not found");
});
