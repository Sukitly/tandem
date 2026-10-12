import type { Parent, Root, RootContent } from "mdast";

/**
 * What the agent writes is untrusted: it may repeat what a file or a web page told it. So raw HTML shows as the text
 * it is, except for line breaks, which models put in table cells. Links work only to the web and to mail; images load
 * only from the web. Other links and images, such as a path in the project, which would open within Tandem's own
 * page, show as their text.
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
