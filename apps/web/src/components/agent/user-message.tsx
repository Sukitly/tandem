import { type ReactNode, useState } from "react";

import { AttachmentTile, type AttachmentTileProps } from "@/components/agent/attachment-tile";
import { ImageLightbox } from "@/components/agent/image-lightbox";
import { MessageListItem } from "@/components/agent/message-list";
import { Bubble, BubbleContent } from "@/components/ui/bubble";

/** A file sent with a message. The same fields as the tile in the prompt input. */
type UserMessageAttachment = Pick<AttachmentTileProps, "name" | "src" | "icon" | "description" | "failedLabel">;

type UserMessageProps = {
  /**
   * What the person typed. Shown as written, never parsed as markdown. Leave it
   * out for a message that is only files, and no bubble is drawn.
   */
  children?: ReactNode;
  /** Identifies the turn, so the list can anchor and scroll to it. */
  id: string;
  /** Settle the list near this turn when it arrives. On unless turned off. */
  anchor?: boolean;
  /**
   * The files that were sent with the message, above the bubble on the end side.
   * A picture opens in a lightbox on a click, with the other pictures of the
   * message a key away.
   */
  attachments?: UserMessageAttachment[];
  /** Names the row of files for screen readers. Defaults to "Attachments". */
  attachmentsLabel?: string;
  /**
   * How a picture is drawn. `tile` is a 96px square, cropped in the middle, so a
   * row is even whatever the pictures are. `original` keeps its proportions, up
   * to a height, so a screenshot or a plan can be read where it is: a wide
   * picture is not cut to the middle of it. A file with no picture is a square
   * in both.
   */
  pictures?: "tile" | "original";
  /**
   * A row of buttons under the bubble, on the end side: a `MessageActions` with
   * a copy button, for example.
   */
  actions?: ReactNode;
  className?: string;
};

/**
 * The person's turn in a conversation: a muted bubble on the end side, inside
 * a `MessageListItem`. It is the scroll anchor by default, so a new question
 * settles near the top of the list while the reply streams in below it.
 *
 * Files sent with it are the same tiles as in the prompt input, in rows above
 * the bubble that wrap and sit against the end side. Pictures can keep their
 * proportions with `pictures="original"`.
 *
 * The reply is not a bubble. Render it with `Markdown` in a plain
 * `MessageListItem`, since a long answer reads badly inside one.
 */
function UserMessage({
  children,
  id,
  anchor = true,
  attachments = [],
  attachmentsLabel = "Attachments",
  pictures = "tile",
  actions,
  className,
}: UserMessageProps) {
  const [viewing, setViewing] = useState<number | null>(null);
  const images = attachments.flatMap((attachment) =>
    attachment.src ? [{ src: attachment.src, name: attachment.name }] : [],
  );
  const hasText = children !== undefined && children !== null && children !== "";

  return (
    <MessageListItem id={id} align="end" anchor={anchor} className={className}>
      {attachments.length > 0 && (
        // `data-slot` is what puts the row on the end side: the message
        // content moves its direct children that have one.
        <ul
          aria-label={attachmentsLabel}
          data-slot="user-message-attachments"
          // Centred, so a tile is as tall as it is. Stretched to the tallest of its
          // row, a picture would sit at the top of a taller box, and its corners
          // would be those of the box, not of the picture.
          className="gap-2 flex max-w-full min-w-0 flex-wrap items-center justify-end"
        >
          {attachments.map((attachment, index) => (
            // Two files can have one name, and the list does not change.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={`${attachment.name}-${index}`} className="flex">
              <AttachmentTile
                // Only the fields of an attachment, not the rest of an object
                // that may carry more, such as an id, a state or a size.
                name={attachment.name}
                src={attachment.src}
                icon={attachment.icon}
                description={attachment.description}
                failedLabel={attachment.failedLabel}
                size={pictures === "original" ? "auto" : "default"}
                onView={() =>
                  // The place among the pictures, not among the files.
                  setViewing(attachments.slice(0, index).filter((other) => other.src).length)
                }
              />
            </li>
          ))}
        </ul>
      )}
      {hasText && (
        <Bubble align="end" variant="muted">
          {/* The text is what the person typed, so keep their line breaks and
              spaces instead of collapsing them the way markdown would. */}
          <BubbleContent className="whitespace-pre-wrap">{children}</BubbleContent>
        </Bubble>
      )}
      {actions}
      {images.length > 0 && <ImageLightbox images={images} index={viewing} onIndexChange={setViewing} />}
    </MessageListItem>
  );
}

export { UserMessage, type UserMessageAttachment };
