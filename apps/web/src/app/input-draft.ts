import { type AttachedImage, attachImages } from "@/chat/attached-images.ts";

export interface DraftSnapshot {
  text: string;
  images: readonly AttachedImage[];
  sending: boolean;
  error: string | null;
}

/** Page-memory input state, independent of panels, connections, and responsive component trees. */
export class InputDraft {
  #snapshot: DraftSnapshot;
  #revision = 0;
  #generation = 0;
  #attachments: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<() => void>();

  constructor(text = "") {
    this.#snapshot = { text, images: [], sending: false, error: null };
  }

  readonly getSnapshot = (): DraftSnapshot => this.#snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #update(change: Partial<DraftSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of this.#listeners) listener();
  }

  setText(text: string): void {
    if (text === this.#snapshot.text) return;
    this.#revision += 1;
    this.#update({ text });
  }

  setError(error: string | null): void {
    this.#update({ error });
  }

  detach(id: number): void {
    const images = this.#snapshot.images.filter((image) => {
      if (image.id !== id) return true;
      URL.revokeObjectURL(image.url);
      return false;
    });
    this.#update({ images });
  }

  /** Serial reads account for all preceding attachments, not a stale component snapshot. */
  attach(files: File[], maxPerMessage?: number): Promise<void> {
    const generation = this.#generation;
    const run = async (): Promise<void> => {
      if (generation !== this.#generation) return;
      try {
        const { attached, refused } = await attachImages(files, this.#snapshot.images);
        if (generation !== this.#generation) {
          for (const image of attached) URL.revokeObjectURL(image.url);
          return;
        }
        const room =
          maxPerMessage === undefined ? attached.length : Math.max(0, maxPerMessage - this.#snapshot.images.length);
        const kept = attached.slice(0, room);
        for (const image of attached.slice(kept.length)) URL.revokeObjectURL(image.url);
        this.#update({
          images: [...this.#snapshot.images, ...kept],
          error:
            refused ??
            (kept.length < attached.length
              ? `The current model takes at most ${maxPerMessage} images in a message`
              : null),
        });
      } catch (failure) {
        if (generation === this.#generation)
          this.setError(failure instanceof Error ? failure.message : "The image could not be read");
      }
    };
    this.#attachments = this.#attachments.then(run);
    return this.#attachments;
  }

  /** Completion belongs to the draft even if its original composer has since unmounted. */
  async send(submit: (images: readonly AttachedImage[]) => Promise<unknown>): Promise<boolean> {
    if (this.#snapshot.sending) return false;
    const revision = this.#revision;
    const generation = this.#generation;
    const sent = this.#snapshot.images;
    this.#update({ sending: true, error: null });
    try {
      await submit(sent);
      if (generation !== this.#generation) return true;
      if (revision === this.#revision) this.setText("");
      for (const image of sent) URL.revokeObjectURL(image.url);
      this.#update({ images: this.#snapshot.images.filter((image) => !sent.includes(image)) });
      return true;
    } catch (failure) {
      if (generation === this.#generation) this.setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      if (generation === this.#generation) this.#update({ sending: false });
    }
  }

  dispose(): void {
    this.#generation += 1;
    this.#revision += 1;
    for (const image of this.#snapshot.images) URL.revokeObjectURL(image.url);
    this.#update({ text: "", images: [], sending: false, error: null });
  }
}
