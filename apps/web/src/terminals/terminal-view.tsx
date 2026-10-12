import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { readToken } from "@/rpc/token.ts";
import { TERMINAL_OPTIONS, TerminalConnection, type TerminalLink } from "./terminal-connection.ts";

/**
 * One terminal of the server, drawn by xterm. It fits its box: the size it fits to is sent to the server, where the
 * newest size of any page wins. Its colors follow the theme.
 */
export function TerminalView({ id, active }: { id: string; active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<TerminalLink>("connecting");
  const parts = useRef<{ terminal: Terminal; fit: FitAddon; connection: TerminalConnection } | null>(null);

  useEffect(() => {
    const element = box.current;
    const token = readToken();
    if (element === null || token === undefined) return;
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
    parts.current = { terminal, fit, connection };

    const fitNow = (): void => {
      // A hidden tab has no size: fitting it would ask for the smallest terminal.
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      const size = fit.proposeDimensions();
      if (size === undefined || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return;
      connection.resize({ cols: Math.max(2, size.cols), rows: Math.max(1, size.rows) });
      if (size.cols !== terminal.cols || size.rows !== terminal.rows) terminal.resize(size.cols, size.rows);
    };
    const observer = new ResizeObserver(fitNow);
    observer.observe(element);
    fitNow();

    // The theme is the root element's `dark` class.
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = themeOf(element);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      binary.dispose();
      connection.close();
      terminal.dispose();
      parts.current = null;
    };
  }, [id]);

  // Shown again, or focused: this page's size becomes the terminal's, and keys go to it.
  useEffect(() => {
    const current = parts.current;
    if (!active || current === null) return;
    const size = current.fit.proposeDimensions();
    if (size !== undefined && Number.isFinite(size.cols) && Number.isFinite(size.rows)) {
      current.connection.resize({ cols: Math.max(2, size.cols), rows: Math.max(1, size.rows) });
    }
    current.terminal.focus();
  }, [active]);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const onFocus = (): void => {
      const current = parts.current;
      const size = current?.fit.proposeDimensions();
      if (current !== null && current !== undefined && size !== undefined && Number.isFinite(size.cols)) {
        current.connection.resize({ cols: Math.max(2, size.cols), rows: Math.max(1, size.rows) });
      }
    };
    element.addEventListener("focusin", onFocus);
    return () => element.removeEventListener("focusin", onFocus);
  }, []);

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
