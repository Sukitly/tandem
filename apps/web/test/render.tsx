import { type RenderOptions, render as renderReact } from "@testing-library/react";
import type { ReactNode } from "react";
import { SnapshotProvider } from "../src/app/query-client.tsx";

export { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

/** Every render owns an isolated query cache; rerenders retain it just like an authenticated application session. */
export function render(ui: ReactNode, options?: RenderOptions) {
  const Wrapper = options?.wrapper;
  return renderReact(ui, {
    ...options,
    wrapper: ({ children }) => (
      <SnapshotProvider>{Wrapper === undefined ? children : <Wrapper>{children}</Wrapper>}</SnapshotProvider>
    ),
  });
}
