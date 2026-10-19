import { CatchBoundary, type ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/errors.ts";
import { Button } from "./ui/button.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";

const reload = (): void => window.location.reload();

/**
 * What stands where a part of the page failed to draw: what could not be shown, why, and how to go on. A part that
 * fills its place offers to try again and to reload, since a reload is what mends a script that failed to load; a
 * part that is one line among others offers only to try again.
 */
function ErrorFallback({
  what,
  error,
  reset,
  compact = false,
}: {
  /** What could not be shown, as in "this message" or "the Changes tab". */
  what: string;
  error: unknown;
  reset(): void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm"
      >
        <TriangleAlertIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          Could not show {what}: {errorMessage(error)}
        </span>
        <Button size="sm" variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>Could not show {what}</EmptyTitle>
        <EmptyDescription className="[overflow-wrap:anywhere]">{errorMessage(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={reload}>
          Reload page
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * Keeps a part of the page that fails to draw from taking the rest with it: the part is replaced by what failed, and
 * everything around it carries on. It tries again when asked to, and when `resetKey` changes, as when the part is
 * about something else than it was.
 */
export function ErrorBoundary({
  what,
  resetKey,
  compact,
  children,
}: {
  what: string;
  resetKey?: unknown;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <CatchBoundary
      getResetKey={() => resetKey}
      onCatch={(error) => console.error(`Could not show ${what}`, error)}
      errorComponent={({ error, reset }) => (
        <ErrorFallback what={what} error={error} reset={reset} {...(compact === undefined ? {} : { compact })} />
      )}
    >
      {children}
    </CatchBoundary>
  );
}

/** What the router shows for a page that fails to draw, in place of the page and nothing else. */
export function PageError({ error, reset }: ErrorComponentProps) {
  console.error("Could not show this page", error);
  return <ErrorFallback what="this page" error={error} reset={reset} />;
}
