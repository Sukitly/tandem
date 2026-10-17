import { type AttachedImage, attachImages } from "@/chat/attached-images.ts";
import { TextDraft, type TextDraftSnapshot } from "./text-draft.ts";

export interface MessageDraftSnapshot extends TextDraftSnapshot {
  images: readonly AttachedImage[];
}

/** A chat draft composes text sending with model-limited attachments and owned object URLs. */
export class MessageDraft {
  readonly #text: TextDraft;
  readonly #stopText: () => void;
  #images: readonly AttachedImage[] = [];
  #snapshot: MessageDraftSnapshot;
  #generation = 0;
  #disposed = false;
  #attachments: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<() => void>();

  constructor(text = "") {
    this.#text = new TextDraft(text);
    this.#snapshot = { ...this.#text.getSnapshot(), images: this.#images };
    this.#stopText = this.#text.subscribe(() => this.#publish());
  }
  readonly getSnapshot = (): MessageDraftSnapshot => this.#snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  #publish(): void {
    if (this.#disposed) return;
    this.#snapshot = { ...this.#text.getSnapshot(), images: this.#images };
    for (const listener of this.#listeners) listener();
  }
  setText(text: string): void {
    this.#text.setText(text);
  }
  setError(error: string | null): void {
    this.#text.setError(error);
  }
  detach(id: number): void {
    if (this.#disposed) return;
    this.#images = this.#images.filter((image) => {
      if (image.id !== id) return true;
      URL.revokeObjectURL(image.url);
      return false;
    });
    this.#publish();
  }
  /** Serial reads account for all preceding attachments, not a stale component snapshot. */
  attach(files: File[], maxPerMessage?: number): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const generation = this.#generation;
    const run = async (): Promise<void> => {
      if (generation !== this.#generation) return;
      try {
        const { attached, refused } = await attachImages(files, this.#images);
        if (generation !== this.#generation) {
          for (const image of attached) URL.revokeObjectURL(image.url);
          return;
        }
        const room = maxPerMessage === undefined ? attached.length : Math.max(0, maxPerMessage - this.#images.length);
        const kept = attached.slice(0, room);
        for (const image of attached.slice(kept.length)) URL.revokeObjectURL(image.url);
        this.#images = [...this.#images, ...kept];
        this.setError(
          refused ??
            (kept.length < attached.length
              ? `The current model takes at most ${maxPerMessage} images in a message`
              : null),
        );
      } catch (failure) {
        if (generation === this.#generation)
          this.setError(failure instanceof Error ? failure.message : "The image could not be read");
      }
    };
    this.#attachments = this.#attachments.then(run);
    return this.#attachments;
  }
  async send(submit: (images: readonly AttachedImage[]) => Promise<unknown>): Promise<boolean> {
    if (this.#disposed) return false;
    const generation = this.#generation;
    const sent = this.#images;
    return this.#text.send(async () => {
      await submit(sent);
      if (generation !== this.#generation) return;
      for (const image of sent) URL.revokeObjectURL(image.url);
      this.#images = this.#images.filter((image) => !sent.includes(image));
      this.#publish();
    });
  }
  reset(): void {
    if (this.#disposed) return;
    this.#generation += 1;
    this.#attachments = Promise.resolve();
    for (const image of this.#images) URL.revokeObjectURL(image.url);
    this.#images = [];
    this.#text.reset();
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#generation += 1;
    this.#disposed = true;
    for (const image of this.#images) URL.revokeObjectURL(image.url);
    this.#images = [];
    this.#stopText();
    this.#text.dispose();
    this.#snapshot = { ...this.#text.getSnapshot(), images: this.#images };
    for (const listener of this.#listeners) listener();
    this.#listeners.clear();
  }
}
