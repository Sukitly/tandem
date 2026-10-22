// @vitest-environment jsdom

import { MAX_MESSAGE_IMAGE_BYTES } from "@tandem/contracts";
import { describe, expect, test, vi } from "vitest";
import { attachImages, imageFiles } from "../src/chat/attached-images.ts";

// jsdom has no object URLs.
URL.createObjectURL = vi.fn(() => "blob:image");

const png = (name = "shot.png", bytes: BlobPart[] = ["png"]) => new File(bytes, name, { type: "image/png" });

describe("attaching images", () => {
  test("reads image files as base64, and leaves out files that are not images", async () => {
    const { attached, refused } = await attachImages(
      [png(), new File(["text"], "notes.txt", { type: "text/plain" })],
      [],
    );
    expect(refused).toBeUndefined();
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({
      name: "shot.png",
      input: { data: btoa("png"), mimeType: "image/png" },
      url: "blob:image",
      bytes: 3,
    });
  });

  test("names a pasted image, which has no file name", async () => {
    const { attached } = await attachImages([png("")], []);
    expect(attached[0]?.name).toBe("Pasted image");
  });

  test("stops at the size a message's images may have together, counting those attached already", async () => {
    const big = new File([new Uint8Array(MAX_MESSAGE_IMAGE_BYTES - 10)], "big.png", { type: "image/png" });
    const first = await attachImages([big], []);
    expect(first.attached).toHaveLength(1);
    const second = await attachImages(
      [png("a.png", [new Uint8Array(5)]), png("b.png", [new Uint8Array(6)])],
      first.attached,
    );
    expect(second.attached.map((image) => image.name)).toEqual(["a.png"]);
    expect(second.refused).toBe("Images of one message are at most 11.25 MB together");
  });
});

describe("the image files among files that were added", () => {
  test("are the files that are images", () => {
    const files = [png(), new File(["x"], "a.txt", { type: "text/plain" })];
    expect(imageFiles(files).map((file) => file.name)).toEqual(["shot.png"]);
    expect(imageFiles([])).toEqual([]);
  });
});
