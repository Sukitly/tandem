import { IMAGE_INPUT_TYPES, type ImageInput, MAX_MESSAGE_IMAGE_BYTES } from "@tandem/contracts";

/** An image chosen for the next message: what is sent, and a URL of it for its thumbnail. */
export interface AttachedImage {
  id: number;
  name: string;
  input: ImageInput;
  url: string;
  bytes: number;
}

const ACCEPTED = new Set<string>(IMAGE_INPUT_TYPES);

/** The `accept` of a file input for the images a message takes. */
export const IMAGE_ACCEPT = IMAGE_INPUT_TYPES.join(",");

let nextId = 1;

/**
 * The image files among `files`, read for sending, after `current`; the files sent as they are, since the server fits
 * them to the model. Files that are not images are left out; images over the size a message may carry are refused
 * with a message.
 */
export async function attachImages(
  files: Iterable<File>,
  current: readonly AttachedImage[],
): Promise<{ attached: AttachedImage[]; refused?: string }> {
  const images = [...files].filter((file) => ACCEPTED.has(file.type));
  let total = current.reduce((sum, image) => sum + image.bytes, 0);
  const attached: AttachedImage[] = [];
  for (const file of images) {
    if (total + file.size > MAX_MESSAGE_IMAGE_BYTES) {
      return {
        attached,
        refused: `Images of one message are at most ${MAX_MESSAGE_IMAGE_BYTES / (1024 * 1024)} MB together`,
      };
    }
    total += file.size;
    let data: string;
    try {
      data = await base64Of(file);
    } catch (error) {
      for (const image of attached) URL.revokeObjectURL(image.url);
      throw error;
    }
    attached.push({
      id: nextId++,
      name: file.name === "" ? "Pasted image" : file.name,
      input: { data, mimeType: file.type },
      url: URL.createObjectURL(file),
      bytes: file.size,
    });
  }
  return { attached };
}

/** The files among `files`, which a paste, a drop or the file picker hands over, that are images a message takes. */
export function imageFiles(files: Iterable<File>): File[] {
  return [...files].filter((file) => ACCEPTED.has(file.type));
}

async function base64Of(file: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read"));
    reader.readAsDataURL(file);
  });
  // `data:<type>;base64,<data>`
  return url.slice(url.indexOf(",") + 1);
}
