import type { Context } from "@earendil-works/chord";
import {
  defineExtension,
  type Extension,
  type ToolDiagnostic,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
  wrapTool,
} from "@earendil-works/pi-durable";
import { type BinaryReader, getOrThrow } from "@earendil-works/pi-durable/env";
import { createReadTool } from "@earendil-works/pi-durable/tools";
import type { ImageProcessor } from "./images/image-processor.ts";
import { detectSupportedImageMimeTypeOf } from "./images/image-type.ts";
import { imageModel } from "./images/message-images.ts";

/** Characters that models write for a plain space in a path, as pi-durable's `read` normalizes them. */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * `read` for image files too. pi-durable 1.1.0's `read` refuses images; its next release reads them with an image
 * processor (`createCodingTools({ images })`), and this extension goes then. An image file is read here, fitted to the
 * conversation's model, and returned as one image block with a note on what was done to it; any other file is read by
 * the `read` it wraps.
 */
export function imageReading(processor: ImageProcessor): Extension {
  return defineExtension({
    name: "tandem.image-read",
    wraps: [wrapTool(createReadTool() as ToolRegistration, (read) => withImages(read, processor))],
  });
}

function withImages(read: ToolRegistration, processor: ImageProcessor): ToolRegistration {
  return {
    ...read,
    description:
      "Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp); images are sent as " +
      `attachments. ${read.description.replace(/^Read the contents of a text file\.\s*/, "")}`,
    async execute(args, api, context) {
      const path = (args as { path?: unknown }).path;
      const env = api.env;
      if (typeof path !== "string" || env === undefined) return read.execute(args, api, context);
      const absolute = getOrThrow(await env.absolutePath(normalized(path), context));
      const opened = await env.openBinaryReader(absolute, undefined, context);
      // A path that does not open is the wrapped tool's to report, in its words.
      if (!opened.ok) return read.execute(args, api, context);
      const reader = opened.value;
      try {
        const info = getOrThrow(await reader.info(context));
        const mimeType = await detectSupportedImageMimeTypeOf({
          size: info.size,
          read: async (offset, length) => getOrThrow(await reader.read(offset, length, context)),
        });
        if (mimeType === undefined) return read.execute(args, api, context);
        return await readImage(reader, info.size, path, mimeType, processor, api, context);
      } finally {
        await reader.close(context);
      }
    },
  };
}

async function readImage(
  reader: BinaryReader,
  size: number,
  path: string,
  mimeType: string,
  processor: ImageProcessor,
  api: ToolExecutionApi,
  context: Context,
): Promise<ToolExecutionResult> {
  const ref = (await api.agent(context)).model;
  const model = imageModel(ref === undefined ? undefined : api.models.getModel(ref.provider, ref.modelId));
  const bytes = getOrThrow(await reader.read(0, size, context));
  const prepared = await processor.prepare(bytes, mimeType, model.limits);
  if (prepared === undefined) {
    const message = `${path} is an image (${mimeType}) that cannot be prepared for the model`;
    return { content: [], isError: true, diagnostics: [{ severity: "error", code: "unsupported_image", message }] };
  }
  const notes = [`Read image file [${prepared.mimeType}].`];
  if (prepared.convertedFrom !== undefined)
    notes.push(`Converted from ${prepared.convertedFrom} to ${prepared.mimeType}.`);
  if (prepared.resized !== undefined) {
    const { from, to } = prepared.resized;
    const scale = (from.width / to.width).toFixed(2);
    notes.push(
      `Resized from ${from.width}x${from.height} to ${to.width}x${to.height}. Multiply coordinates by ${scale} to map them to the original.`,
    );
  }
  if (!model.vision) notes.push("The current model does not support images; it sees a placeholder instead.");
  const diagnostics: ToolDiagnostic[] = [{ severity: "info", code: "image", message: notes.join(" ") }];
  return { content: [{ type: "image", data: prepared.data, mimeType: prepared.mimeType }], diagnostics };
}

function normalized(path: string): string {
  const spaced = path.replace(UNICODE_SPACES, " ");
  return spaced.startsWith("@") ? spaced.slice(1) : spaced;
}
