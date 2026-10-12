import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { useConnected } from "@/rpc/connection.tsx";
import { TERMINAL_OPTIONS, TerminalConnection, type TerminalLink } from "./terminal-connection.ts";

/**
 * One terminal of the server, drawn by xterm. It fits its box: the size it fits to is sent to the server, where the
 * newest size of any page wins. Its colors follow the theme.
 */
export function TerminalView({ id, active }: { id: string; active: boolean }) {
  const { token } = useConnected();
  const box = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<TerminalLink>("connecting");
  const parts = useRef<Parts | null>(null);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const terminal = new Terminal({ ...TERMINAL_OPTIONS, theme: themeOf(element) });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    // Drawn on the GPU where it can be; xterm's own renderer otherwise, or once the GPU context is lost.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // No WebGL: the DOM renderer stays.
    }
    const connection = new TerminalConnection({
      origin: window.location.origin,
      token,
      id,
      screen: {
        write: (data, done) => terminal.write(data, done),
        reset: () => terminal.reset(),
        resize: (cols, rows) => {
          if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
        },
      },
      onLink: setLink,
    });
    const input = terminal.onData((data) => connection.input(data));
    // A key xterm turns into bytes as binary data, such as a mouse report in some modes.
    const binary = terminal.onBinary((data) => connection.input(data));
    const current: Parts = { element, terminal, fit, connection };
    parts.current = current;
    const observer = new ResizeObserver(() => fitToBox(current));
    observer.observe(element);
    // Focused, as when the user comes back to this page: its size becomes the terminal's again.
    const onFocus = (): void => fitToBox(current);
    element.addEventListener("focusin", onFocus);
    fitToBox(current);

    // The theme is the root element's `dark` class.
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = themeOf(element);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      element.removeEventListener("focusin", onFocus);
      themeObserver.disconnect();
      input.dispose();
      binary.dispose();
      connection.close();
      terminal.dispose();
      parts.current = null;
    };
  }, [id, token]);

  // Shown again: this page's size becomes the terminal's, and keys go to it.
  useEffect(() => {
    const current = parts.current;
    if (!active || current === null) return;
    fitToBox(current);
    current.terminal.focus();
  }, [active]);

  return (
    <div className="relative h-full min-h-0 bg-background p-2">
      <div ref={box} className="h-full min-h-0" />
      {link === "connecting" && (
        <p className="absolute top-2 right-3 text-xs text-muted-foreground" aria-live="polite">
          Connecting…
        </p>
      )}
    </div>
  );
}

interface Parts {
  element: HTMLElement;
  terminal: Terminal;
  fit: FitAddon;
  connection: TerminalConnection;
}

/**
 * Fit the terminal to its box, and send that size to the server, where the newest size of any page wins. A hidden
 * box has no size: fitting it would ask for the smallest terminal, so it is left as it is.
 */
function fitToBox({ element, terminal, fit, connection }: Parts): void {
  if (element.clientWidth === 0 || element.clientHeight === 0) return;
  const size = fit.proposeDimensions();
  if (size === undefined || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return;
  const cols = Math.max(2, size.cols);
  const rows = Math.max(1, size.rows);
  connection.resize({ cols, rows });
  if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
}

/** The theme's colors, as the browser computes them: xterm parses only colors a canvas understands. */
function themeOf(element: HTMLElement): ITheme {
  const probe = document.createElement("span");
  element.appendChild(probe);
  const color = (variable: string): string => {
    probe.style.color = `var(${variable})`;
    return getComputedStyle(probe).color;
  };
  const theme: ITheme = {
    background: color("--background"),
    foreground: color("--foreground"),
    cursor: color("--foreground"),
    cursorAccent: color("--background"),
    selectionBackground: color("--muted"),
  };
  probe.remove();
  return theme;
}
