// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ThemeProvider, useTheme } from "../src/theme.tsx";

let systemDark = false;
beforeEach(() => {
  localStorage.clear();
  systemDark = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return systemDark;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

function Probe() {
  const { choice, setChoice } = useTheme();
  return (
    <>
      <output aria-label="Choice">{choice}</output>
      <button type="button" onClick={() => setChoice("dark")}>
        Dark
      </button>
      <button type="button" onClick={() => setChoice("light")}>
        Light
      </button>
    </>
  );
}

const choice = () => screen.getByLabelText("Choice").textContent;

test("starts from the stored choice, or the system's", () => {
  localStorage.setItem("tandem.theme", "dark");
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(choice()).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  cleanup();
  document.documentElement.classList.remove("dark");

  localStorage.clear();
  systemDark = true;
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(choice()).toBe("system");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

test("choosing a theme applies it and remembers it", () => {
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Dark" }));
  expect(choice()).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("tandem.theme")).toBe("dark");

  act(() => fireEvent.click(screen.getByRole("button", { name: "Light" })));
  expect(choice()).toBe("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem("tandem.theme")).toBe("light");
});
