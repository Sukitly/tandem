import type { DiagramPlugin } from "streamdown";

/**
 * A mermaid plugin that loads the real one when a diagram is first drawn. A script that failed to load is asked for
 * again by the next diagram, not remembered as failed.
 */
export function lazyMermaidFrom(load: () => Promise<{ mermaid: DiagramPlugin }>): DiagramPlugin {
  let loading: Promise<DiagramPlugin> | undefined;
  const plugin = (): Promise<DiagramPlugin> => {
    loading ??= load().then(
      (module) => module.mermaid,
      (error: unknown) => {
        loading = undefined;
        throw error;
      },
    );
    return loading;
  };
  return {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid(config) {
      return {
        initialize: (next) => {
          void plugin().then((loaded) => loaded.getMermaid(next));
        },
        render: async (id, source) => (await plugin()).getMermaid(config).render(id, source),
      };
    },
  };
}

/**
 * Mermaid, which is several megabytes and drawn by few conversations, so its code is loaded when a diagram is first
 * drawn, not when the page starts. What it draws, and how safely, is `@streamdown/mermaid`'s.
 */
export const lazyMermaid = lazyMermaidFrom(() => import("@streamdown/mermaid"));
