import { useCallback, useSyncExternalStore } from "react";

/** Optional browser preferences. Storage denial or quota exhaustion must never disable the application. */
const remembered = new Map<string, string | null>();
const unsaved = new Set<string>();
/** Storage access never throws: unavailable storage and failed writes fall back to page memory. */
export const preferences = {
  getItem(key: string): string | null {
    if (unsaved.has(key)) return remembered.get(key) ?? null;
    try {
      const value = localStorage.getItem(key);
      remembered.set(key, value);
      return value;
    } catch {
      return remembered.get(key) ?? null;
    }
  },
  setItem(key: string, value: string): void {
    remembered.set(key, value);
    try {
      localStorage.setItem(key, value);
      unsaved.delete(key);
    } catch {
      unsaved.add(key);
    }
  },
  removeItem(key: string): void {
    remembered.set(key, null);
    try {
      localStorage.removeItem(key);
      unsaved.delete(key);
    } catch {
      unsaved.add(key);
    }
  },
};

/** What a page remembers between visits: where it is kept, and how a stored string and a value stand for each other. */
export interface Preference<T extends string | boolean> {
  readonly key: string;
  /** The value a stored string stands for. What is absent, or is not a value of the preference, reads as its default. */
  parse(stored: string | null): T;
  format(value: T): string;
}

/** One of `values`, stored as it is. */
export function choicePreference<T extends string>(key: string, values: readonly T[], fallback: T): Preference<T> {
  return { key, parse: (stored) => values.find((value) => value === stored) ?? fallback, format: (value) => value };
}

/** Yes or no, stored as `"true"` or `"false"`. */
export function flagPreference(key: string, fallback: boolean): Preference<boolean> {
  return {
    key,
    parse: (stored) => (stored === "true" ? true : stored === "false" ? false : fallback),
    format: (value) => String(value),
  };
}

const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readPreference<T extends string | boolean>(preference: Preference<T>): T {
  return preference.parse(preferences.getItem(preference.key));
}

/** Remembers `value`, and tells every component showing the preference. */
export function writePreference<T extends string | boolean>(preference: Preference<T>, value: T): void {
  preferences.setItem(preference.key, preference.format(value));
  for (const listener of [...listeners]) listener();
}

/** A preference as state: every component that shows it is updated when any of them changes it. */
export function usePreference<T extends string | boolean>(preference: Preference<T>): readonly [T, (value: T) => void] {
  const read = useCallback(() => readPreference(preference), [preference]);
  const value = useSyncExternalStore(subscribe, read, read);
  const write = useCallback((next: T) => writePreference(preference, next), [preference]);
  return [value, write];
}
