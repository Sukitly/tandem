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

/** Why images a page sent cannot go with the message: a message the user can act on. */
export class ImageRefused extends Error {}

/** The shape of `images` in a submission, before anything is decoded: a list of base64 strings with a type. */
export function parseImageInputs(value: unknown): ImageInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ImageRefused("images must be a list");
  let total = 0;
  return value.map((item) => {
    const { data, mimeType } = (item ?? {}) as Partial<ImageInput>;
    if (typeof data !== "string" || typeof mimeType !== "string")
      throw new ImageRefused("Each image needs its data and type");
    // The original bytes: three of them for every four characters of base64.
    total += Math.floor((data.length * 3) / 4);
    if (total > MAX_MESSAGE_IMAGE_BYTES)
      throw new ImageRefused(`The images are over ${MAX_MESSAGE_IMAGE_BYTES / (1024 * 1024)} MB together`);
    return { data, mimeType };
  });
}

/**
 * The images of a message, each fitted to the model: oriented, converted, and shrunk to its limits. The type is read
 * from the bytes, not taken from the page.
 */
export async function prepareImages(
  images: readonly ImageInput[],
  model: ImageModel,
  processor: ImageProcessor,
): Promise<ImageContent[]> {
  if (images.length === 0) return [];
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
