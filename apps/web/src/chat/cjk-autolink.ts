import type { Link, Parent, PhrasingContent, Root, Text } from "mdast";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { visit } from "unist-util-visit";

/** Punctuation of Chinese, Japanese and Korean text. It is not part of an address, but GFM reads it as one. */
const CJK_PUNCTUATION = new Set("。．，、？！：；（）【】「」『』〈〉《》");
const ADDRESS_START = /^(https?:\/\/|mailto:|www\.)/i;
const autolinkLiteral = gfmAutolinkLiteralFromMarkdown().transforms ?? [];

/**
 * An address written in CJK text, as in `见 https://example.com。然后` or `（https://example.com）`, ends where the
 * punctuation begins. GFM autolinks do not stop there, so the link would take the full stop and whatever follows it.
 * This cuts such a link at the first CJK punctuation mark, and reads what is left as text, which may hold another
 * address.
 */
export function cjkAutolink(): (tree: Root) => undefined {
  return (tree) => {
    visit(tree, "link", (link, index, parent) => {
      if (parent === undefined || index === undefined || !isBareAddress(link)) return;
      const cut = [...link.url].findIndex((character) => CJK_PUNCTUATION.has(character));
      if (cut <= 0) return;
      const end = [...link.url].slice(0, cut).join("").length;
      const replacement: PhrasingContent[] = [
        { ...link, url: link.url.slice(0, end), children: [{ type: "text", value: link.url.slice(0, end) }] },
        ...textWithAddresses(link.url.slice(end)),
      ];
      (parent as Parent).children.splice(index, 1, ...replacement);
      // The next node to visit is the one after the replacement.
      return index + replacement.length;
    });
  };
}

/** A link that GFM made from an address in the text, which is its own text, and not one the author wrote. */
function isBareAddress(link: Link): boolean {
  const [only] = link.children;
  return link.children.length === 1 && only?.type === "text" && only.value === link.url && ADDRESS_START.test(link.url);
}

/** Text with the addresses in it turned back into links, and each CJK punctuation mark apart from them. */
function textWithAddresses(source: string): PhrasingContent[] {
  const nodes: PhrasingContent[] = [];
  let start = 0;
  let position = 0;
  for (const character of source) {
    if (CJK_PUNCTUATION.has(character)) {
      nodes.push(...autolinked(source.slice(start, position)), { type: "text", value: character });
      start = position + character.length;
    }
    position += character.length;
  }
  nodes.push(...autolinked(source.slice(start)));
  return nodes;
}

/** What GFM makes of a piece of text, which has no CJK punctuation in it. */
function autolinked(text: string): PhrasingContent[] {
  if (text === "") return [];
  const paragraph: Parent = { type: "paragraph", children: [{ type: "text", value: text } satisfies Text] };
  // An address with nothing after its scheme is not one.
  if (ADDRESS_START.exec(text)?.[0] !== text) {
    const root: Root = { type: "root", children: [paragraph as Root["children"][number]] };
    for (const transform of autolinkLiteral) transform(root);
  }
  return paragraph.children as PhrasingContent[];
}
