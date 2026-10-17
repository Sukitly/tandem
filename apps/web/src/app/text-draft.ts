export interface TextDraftSnapshot {
  text: string;
  sending: boolean;
  error: string | null;
}

/** Page-memory text input. reset is reusable; dispose is terminal and makes mutations no-ops. */
export class TextDraft {
  #snapshot: TextDraftSnapshot;
  #revision = 0;
  #generation = 0;
  #disposed = false;
  readonly #listeners = new Set<() => void>();

  constructor(text = "") {
    this.#snapshot = { text, sending: false, error: null };
  }
  readonly getSnapshot = (): TextDraftSnapshot => this.#snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  #update(change: Partial<TextDraftSnapshot>): void {
    if (this.#disposed) return;
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of this.#listeners) listener();
  }
  setText(text: string): void {
    if (this.#disposed || text === this.#snapshot.text) return;
    this.#revision += 1;
    this.#update({ text });
  }
  setError(error: string | null): void {
    this.#update({ error });
  }
  async send(submit: () => Promise<unknown>): Promise<boolean> {
    if (this.#disposed || this.#snapshot.sending) return false;
    const revision = this.#revision;
    const generation = this.#generation;
    this.#update({ sending: true, error: null });
    try {
      if (this.#disposed || generation !== this.#generation) return false;
      await submit();
      if (this.#disposed || generation !== this.#generation) return false;
      if (revision === this.#revision) this.setText("");
      return true;
    } catch (failure) {
      if (generation === this.#generation) this.setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      if (generation === this.#generation) this.#update({ sending: false });
    }
  }
  reset(): void {
    if (this.#disposed) return;
    this.#generation += 1;
    this.#revision += 1;
    this.#update({ text: "", sending: false, error: null });
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#generation += 1;
    this.#revision += 1;
    this.#disposed = true;
    this.#snapshot = { text: "", sending: false, error: null };
    for (const listener of this.#listeners) listener();
    this.#listeners.clear();
  }
}
