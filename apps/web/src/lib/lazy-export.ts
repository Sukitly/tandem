import { type ComponentType, type LazyExoticComponent, lazy } from "react";

/**
 * A component of a module that is loaded when it is first drawn, not when the page starts. `lazy` takes a module's
 * default export, and these modules export their component by name. A load that failed stays failed until the page is
 * reloaded, as React keeps it so; the error boundary around the view says so and offers the reload.
 */
// biome-ignore lint/suspicious/noExplicitAny: `lazy` itself takes any component, whatever its props.
export function lazyExport<K extends string, C extends ComponentType<any>>(
  load: () => Promise<Record<K, C>>,
  name: K,
): LazyExoticComponent<C> {
  return lazy(async () => ({ default: (await load())[name] }));
}
