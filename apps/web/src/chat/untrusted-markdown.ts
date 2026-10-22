import type { Parent, Root, RootContent } from "mdast";
import { parseFileLink } from "@/files/file-link.ts";

/**
 * What the agent writes is untrusted: it may repeat what a file or a web page told it. So raw HTML shows as the text
 * it is, except for line breaks, which models put in table cells. Links work only to the web, to mail, and to files
 * (which open in the files panel, see `parseFileLink`); images load only from the web. Other links and images show as
 * their text. This replaces the checks of addresses that a Markdown renderer makes of its own, which would rewrite or
 * empty a path such as `src/app.ts` or `app.ts:12`, which is not the same file; `keepAddress` stands behind it.
 */
export function untrustedMarkdown(): (tree: Root) => undefined {
  return (tree) => {
    const definitions = new Map<string, string>();
    collectDefinitions(tree, definitions);
    rewrite(tree, definitions);
  };
}

function collectDefinitions(parent: Parent, definitions: Map<string, string>): void {
  for (const child of parent.children) {
    if (child.type === "definition") definitions.set(child.identifier, child.url);
    else if ("children" in child) collectDefinitions(child, definitions);
  }
}

function rewrite(parent: Parent, definitions: Map<string, string>): void {
  parent.children = parent.children.flatMap((child): RootContent[] => {
    const replaced = replacement(child, definitions);
    if (replaced !== undefined) return replaced;
    if ("children" in child) rewrite(child, definitions);
    return [child];
  });
}

function replacement(node: RootContent, definitions: Map<string, string>): RootContent[] | undefined {
  switch (node.type) {
    case "html":
      return [/^<br\s*\/?>$/i.test(node.value.trim()) ? { type: "break" } : { type: "text", value: node.value }];
    case "link":
    case "linkReference": {
      const url = node.type === "link" ? node.url : definitions.get(node.identifier);
      if (url === undefined || isWeb(url) || url.startsWith("mailto:")) return undefined;
      if (parseFileLink(url) !== undefined) return undefined;
      rewrite(node, definitions);
      return node.children;
    }
    case "image":
    case "imageReference": {
      const url = node.type === "image" ? node.url : definitions.get(node.identifier);
      if (url === undefined || isWeb(url)) return undefined;
      return [{ type: "text", value: node.alt ?? "" }];
    }
    default:
      return undefined;
  }
}

function isWeb(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Which addresses are kept, of every link and image: the second wall behind `untrustedMarkdown`, which works on the
 * tree before the elements exist. This is react-markdown's `urlTransform`, and it is decided here and not by its
 * default, which would empty `app.ts:12`, read as having a scheme called `app.ts`. The web is kept, and for a link
 * mail and files. Everything else, such as `javascript:` and `data:`, is emptied, and so is an address with a control
 * character in it or a space before it, which a browser drops before it reads the scheme: ` javascript:` and
 * `java<tab>script:` run script.
 */
export function keepAddress(url: string, key: string): string {
  if (/^\s|\p{Cc}/u.test(url)) return "";
  if (isWeb(url)) return url;
  if (key === "href" && (url.startsWith("mailto:") || parseFileLink(url) !== undefined)) return url;
  return "";
}
