import type { ConversationView as DurableConversationView } from "@earendil-works/pi-durable";

/** Where a page fetches an image of a conversation: `GET /image/<conversation>/<entry>/<message>/<block>`. */
export const IMAGE_PATH = "/image";

/** The URL path of one image block of a conversation's transcript. */
export function imagePath(ref: ImageRef): string {
  return `${IMAGE_PATH}/${ref.conversationId}/${ref.entryId}/${ref.message}/${ref.block}`;
}

/** Where an image is in a conversation: its entry, the message of the entry, and the block of the message. */
export interface ImageRef {
  conversationId: number;
  entryId: number;
  message: number;
  block: number;
}

/**
 * An image block as a page receives it: the image's type and where to fetch it, not its data. An image of a message
 * still queued has no entry yet, so it has no `ref`.
 */
export interface ImageBlockRef {
  type: "image";
  mimeType: string;
  ref?: ImageRef;
}

/** An image a page sends with a message: the file's bytes, as base64, and the type it says it is. */
export interface ImageInput {
  data: string;
  mimeType: string;
}

/** The original images of one message, together, at most: the protocol takes 16 MB per message, base64 and all. */
export const MAX_MESSAGE_IMAGE_BYTES = 12 * 1024 * 1024;

/** The types a page may send; the server reads the type from the bytes, and converts BMP. */
export const IMAGE_INPUT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"] as const;

/** Swaps every image block of a type for `ImageBlockRef`, wherever it is nested. */
type WithImageRefs<T> = T extends string | number | boolean | null | undefined
  ? T // Branded IDs are numbers too: kept as they are.
  : T extends { type: "image"; data: string }
    ? ImageBlockRef
    : T extends readonly (infer Item)[]
      ? readonly WithImageRefs<Item>[]
      : T extends object
        ? { [Key in keyof T]: WithImageRefs<T[Key]> }
        : T;

/** A conversation's view as pages receive it: pi-durable's, with each image's data replaced by where to fetch it. */
export type ConversationView = WithImageRefs<DurableConversationView>;
