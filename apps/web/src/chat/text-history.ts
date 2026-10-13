export interface TextSnapshot {
  value: string;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

interface TextChange {
  before: TextSnapshot;
  after: TextSnapshot;
}

/** A bounded history shared by native input and programmatic edits, independent of browser undo stacks. */
export class TextHistory {
  private past: TextChange[] = [];
  private future: TextChange[] = [];
  private typingAt = 0;

  record(before: TextSnapshot, after: TextSnapshot, typing = false): void {
    if (before.value === after.value) return;
    const last = this.past.at(-1);
    const now = Date.now();
    if (
      typing &&
      this.typingAt > 0 &&
      now - this.typingAt < 1000 &&
      last !== undefined &&
      last.after.value === before.value &&
      last.after.start === before.start &&
      before.start === before.end
    ) {
      last.after = after;
    } else {
      this.past.push({ before, after });
      if (this.past.length > 100) this.past.shift();
    }
    this.future = [];
    this.typingAt = typing ? now : 0;
  }

  breakTyping(): void {
    this.typingAt = 0;
  }

  undo(current: TextSnapshot): TextSnapshot | null {
    this.breakTyping();
    const change = this.past.pop();
    if (change === undefined) return null;
    this.future.push({ ...change, after: current });
    return change.before;
  }

  redo(current: TextSnapshot): TextSnapshot | null {
    this.breakTyping();
    const change = this.future.pop();
    if (change === undefined) return null;
    this.past.push({ ...change, before: current });
    return change.after;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.breakTyping();
  }
}
