import { choicePreference, flagPreference } from "@/lib/preferences.ts";

export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const KEYBOARD_MODES = ["platform", "emacs"] as const;
export type KeyboardMode = (typeof KEYBOARD_MODES)[number];

export const SEND_MODES = ["steer", "followUp"] as const;
export type SendMode = (typeof SEND_MODES)[number];

export const DIFF_STYLES = ["unified", "split"] as const;
export type DiffStyle = (typeof DIFF_STYLES)[number];

export const PANEL_TABS = ["files", "changes", "terminal", "preview"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/**
 * Everything the page remembers between visits, declared once: where each is kept, which values it takes, and what it is
 * until someone chooses. Components read and write them with `usePreference`; a store that must hold one as part of its
 * own state uses `readPreference` and `writePreference`.
 */
export const userPreferences = {
  /** Also read by the inline script in `index.html`, which applies it before the page first paints. */
  theme: choicePreference("tandem.theme", THEME_CHOICES, "system"),
  keyboardMode: choicePreference("tandem.keyboardMode", KEYBOARD_MODES, "platform"),
  /** Of narrow layouts only: on a desktop, Enter always steers. */
  sendMode: choicePreference("tandem.sendMode", SEND_MODES, "steer"),
  /** Of desktop layouts only: a narrow layout always starts with the panel away. */
  filesShown: flagPreference("tandem.filesShown", true),
  showHiddenFiles: flagPreference("tandem.showHiddenFiles", false),
  panelTab: choicePreference("tandem.panelTab", PANEL_TABS, "files"),
  fileWrap: flagPreference("tandem.fileWrap", false),
  /** One for the diff in the panel, one for it full screen, and one for it in a narrow layout. */
  diffStyle: {
    inline: choicePreference("tandem.diffStyle", DIFF_STYLES, "unified"),
    fullscreen: choicePreference("tandem.diffStyle.zoomed", DIFF_STYLES, "split"),
    narrow: choicePreference("tandem.diffStyle.mobile", DIFF_STYLES, "unified"),
  },
  diffWrap: {
    inline: flagPreference("tandem.diffWrap", false),
    fullscreen: flagPreference("tandem.diffWrap.zoomed", false),
  },
} as const;

/** The widths of the conversation and the panel, kept by `react-resizable-panels` in a format of its own. */
export const PANEL_LAYOUT_KEY = "tandem.layout";
