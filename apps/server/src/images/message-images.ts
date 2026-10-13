import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { type ImageInput, MAX_MESSAGE_IMAGE_BYTES } from "@tandem/contracts";
import { DEFAULT_IMAGE_LIMITS, type ImageLimits, type ImageProcessor } from "./image-processor.ts";
import { detectSupportedImageMimeType } from "./image-type.ts";

/** What a model takes of images: whether it does, within which limits, and how many in one message. */
export interface ImageModel {
  readonly vision: boolean;
  readonly limits: ImageLimits;
  readonly maxPerMessage?: number;
}

/**
 * The model's image input: `DEFAULT_IMAGE_LIMITS` overridden by its `inputLimits.images.resize`, as pi-durable's `read`
 * reads them. Without a model, it counts as one that takes images within the defaults.
 */
export function imageModel(model: Model<string> | undefined): ImageModel {
  const images = model?.inputLimits?.images;
  const resize = images?.resize;
  return {
    vision: model?.input.includes("image") ?? true,
    limits: {
      maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
      maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
      maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
    },
    ...(images?.maxPerMessage === undefined ? {} : { maxPerMessage: images.maxPerMessage }),
  };
}

/**
 * Why images cannot go with the message, in words the user can act on: too large together, a model that takes none,
 * or a file that is not an image. A page that sends images in the wrong shape gets `invalidInput` instead.
 */
export class ImageRefused extends Error {}

/** Refuses images over `MAX_MESSAGE_IMAGE_BYTES` together, counted from their base64 before anything is decoded. */
export function checkImageTotal(images: readonly ImageInput[]): void {
  let total = 0;
  for (const { data } of images) {
    // The original bytes: three of them for every four characters of base64.
    total += Math.floor((data.length * 3) / 4);
    if (total > MAX_MESSAGE_IMAGE_BYTES)
      throw new ImageRefused(`The images are over ${megabytes(MAX_MESSAGE_IMAGE_BYTES)} together`);
  }
}

/** `bytes` in MB as people write it: `11.25 MB`. */
export function megabytes(bytes: number): string {
  return `${Number((bytes / (1024 * 1024)).toFixed(2))} MB`;
}

/**
 * The images of a message, each fitted to `model`, the conversation's: oriented, converted, and shrunk to its limits.
 * The type is read from the bytes, not taken from the page. Without a model the images are refused: there are no
 * limits to fit them to, and nothing would answer the message.
 */
export async function prepareImages(
  images: readonly ImageInput[],
  model: ImageModel | undefined,
  processor: ImageProcessor,
): Promise<ImageContent[]> {
  if (images.length === 0) return [];
  if (model === undefined) throw new ImageRefused("Choose an available model before sending images.");
  if (!model.vision) throw new ImageRefused("The current model does not take images. Choose one that does.");
  if (model.maxPerMessage !== undefined && images.length > model.maxPerMessage)
    throw new ImageRefused(`The current model takes at most ${model.maxPerMessage} images in a message`);
  const prepared: ImageContent[] = [];
  for (const [index, image] of images.entries()) {
    const bytes = new Uint8Array(Buffer.from(image.data, "base64"));
    const mimeType = detectSupportedImageMimeType(bytes);
    const which = images.length === 1 ? "The image" : `Image ${index + 1}`;
    if (mimeType === undefined) throw new ImageRefused(`${which} is not a PNG, JPEG, GIF, WebP, or BMP file`);
    const fitted = await processor.prepare(bytes, mimeType, model.limits);
    if (fitted === undefined) throw new ImageRefused(`${which} cannot be read, or made small enough for the model`);
    prepared.push({ type: "image", data: fitted.data, mimeType: fitted.mimeType });
  }
  return prepared;
}
