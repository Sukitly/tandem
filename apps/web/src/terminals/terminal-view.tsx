import type { TerminalConnection, TerminalLink } from "@tandem/client";
import { clampTerminalSize, TERMINAL_SCROLLBACK } from "@tandem/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { useConnected } from "@/rpc/connection.tsx";

/** How a page draws a terminal; the server keeps as many lines. */
const TERMINAL_OPTIONS = {
  scrollback: TERMINAL_SCROLLBACK,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  cursorBlink: true,
  // xterm's 16 colors are made for a dark background: on the light theme, cyan and green text is hard to read. Text
  // below this contrast with its background is drawn lighter or darker until it reaches it; 4.5 is WCAG AA.
  minimumContrastRatio: 4.5,
} as const;

/** Hides the cursor: the shell's own sequence for it, DECTCEM. */
const HIDE_CURSOR = "\x1b[?25l";

/**
 * One terminal of the server, drawn by xterm. It fits its box: the size it fits to is sent to the server, where the
 * newest size of any page wins. Its colors follow the theme. Once its shell has ended, it shows no cursor and takes no
 * keys, since nothing would read them.
 */
export function TerminalView({ id, active, ended }: { id: string; active: boolean; ended: boolean }) {
  const { openTerminal } = useConnected();
  const isMobile = useIsMobile();
  // Renderer choice belongs to the terminal instance, not the current viewport breakpoint.
  const [useWebgl] = useState(() => !isMobile);
  const box = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<TerminalLink>("connecting");
  const parts = useRef<Parts | null>(null);
  // Read by the screen's writes: a screen sent again after the shell ended draws its cursor, which is hidden again.
  const endedRef = useRef(ended);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const terminal = new Terminal({
      ...TERMINAL_OPTIONS,
      theme: themeOf(element),
      disableStdin: endedRef.current,
      cursorBlink: !endedRef.current,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    // Drawn on the GPU where it can be (desktop); DOM renderer on mobile or once the GPU context is lost.
    if (useWebgl) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        terminal.loadAddon(webgl);
      } catch {
        // No WebGL: the DOM renderer stays.
      }
    }
    const connection = openTerminal(
      id,
      {
        write: (data) => {
          terminal.write(data);
          if (endedRef.current) terminal.write(HIDE_CURSOR);
        },
        reset: () => terminal.reset(),
        resize: (cols, rows) => {
          if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
        },
      },
      { onLink: setLink, onError: (error) => console.error(error) },
    );
    const input = terminal.onData((data) => connection.input(data));
    // Bytes that are not text, such as mouse reports: one character per byte.
    const binary = terminal.onBinary((data) => connection.inputBinary(data));
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
  }, [id, openTerminal, useWebgl]);

  useEffect(() => {
    endedRef.current = ended;
    const terminal = parts.current?.terminal;
    if (!ended || terminal === undefined) return;
    terminal.options.disableStdin = true;
    terminal.options.cursorBlink = false;
    terminal.write(HIDE_CURSOR);
  }, [ended]);

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
      {link === "closed" && (
        <div
          className="absolute top-2 right-3 flex items-center gap-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          Disconnected
          <Button size="xs" variant="outline" onClick={() => parts.current?.connection.reconnect()}>
            Reconnect
          </Button>
        </div>
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
  const proposed = fit.proposeDimensions();
  if (proposed === undefined || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
  const size = clampTerminalSize(proposed);
  connection.resize(size);
  if (size.cols !== terminal.cols || size.rows !== terminal.rows) terminal.resize(size.cols, size.rows);
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
