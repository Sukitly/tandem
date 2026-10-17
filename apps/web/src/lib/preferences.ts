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
