import type { ConversationView as DurableConversationView } from "@earendil-works/pi-durable";

/**
 * Where a page fetches an image of a conversation:
 * `GET /image/<server>/<conversation>/<entry>/<messageIndex>/<blockIndex>`.
 */
export const IMAGE_PATH = "/image";

/**
 * The URL path of one image block of a conversation's transcript on the server `serverId` (`BootstrapResponse`).
 * Entry IDs are only unique within one state directory, and so is the server ID: with it, a browser that cached an
 * image of another state directory, served on the same port, does not show it for an entry with the same ID.
 */
export function imagePath(serverId: string, ref: ImageRef): string {
  return `${IMAGE_PATH}/${encodeURIComponent(serverId)}/${ref.conversationId}/${ref.entryId}/${ref.messageIndex}/${ref.blockIndex}`;
}

/** Where an image is in a conversation: its entry, the position of the message in the entry, and of the block in it. */
export interface ImageRef {
  conversationId: number;
  entryId: number;
  /** 0-based, among the entry's model messages. */
  messageIndex: number;
  /** 0-based, among the message's content blocks. */
  blockIndex: number;
}

/**
 * An image block as a page receives it: the image's type and where to fetch it, not its data. An image of a message
 * still queued has no entry yet, so it has no `ref`.
 */
export interface PageImageBlock {
  type: "image";
  mimeType: string;
  ref?: ImageRef;
}

/** An image a page sends with a message: the file's bytes, as base64, and the type it says it is. */
export interface ImageInput {
  data: string;
  mimeType: string;
}

/** The largest message pi-protocol encodes or decodes: its `DEFAULT_MAX_FRAME_LENGTH`, which Tandem does not change. */
const PROTOCOL_FRAME_BYTES = 16 * 1024 * 1024;

/** What a message holds besides its images' base64: its text, comment IDs, and the protocol's framing. */
const MESSAGE_OVERHEAD_BYTES = 1024 * 1024;

/**
 * The original images of one message, together, at most: the base64 of that many bytes (4 characters for every 3)
 * and the rest of the message fit in one protocol frame. 11.25 MiB.
 */
export const MAX_MESSAGE_IMAGE_BYTES = Math.floor(((PROTOCOL_FRAME_BYTES - MESSAGE_OVERHEAD_BYTES) * 3) / 4);

/** The types a page may send; the server reads the type from the bytes, and converts BMP. */
export const IMAGE_INPUT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"] as const;

/** Swaps every image block of a type for `PageImageBlock`, wherever it is nested. */
export type WithImageRefs<T> = T extends string | number | boolean | null | undefined
  ? T // Branded IDs are numbers too: kept as they are.
  : T extends { type: "image"; data: string }
    ? PageImageBlock
    : T extends readonly (infer Item)[]
      ? readonly WithImageRefs<Item>[]
      : T extends object
        ? { [Key in keyof T]: WithImageRefs<T[Key]> }
        : T;

/** A conversation's view as pages receive it: pi-durable's, with each image's data replaced by where to fetch it. */
export type ConversationView = WithImageRefs<DurableConversationView>;
