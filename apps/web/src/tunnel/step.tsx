import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * One step of the setup: where it happens, what to do there, and the page it happens on. A finished step shrinks to
 * what it left behind, so the steps still to do stand out.
 */
export function Step({
  number,
  title,
  where,
  done = false,
  last = false,
  children,
}: {
  number: number;
  title: string;
  where: "Cloudflare" | "Tandem" | "Phone" | "Terminal";
  done?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={
            done
              ? "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              : "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums"
          }
        >
          {done ? <CheckIcon className="size-4" /> : number}
        </span>
        {!last && <span aria-hidden="true" className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className={last ? "min-w-0 space-y-3" : "min-w-0 space-y-3 pb-8"}>
        <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className={done ? "font-medium text-muted-foreground" : "font-medium"}>{title}</h2>
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {where}
          </Badge>
        </div>
        {children}
      </div>
    </li>
  );
}

/** The one place a step sends a person, opened beside Tandem so this page stays where it was. */
export function OpenLink({
  href,
  children,
  variant = "outline",
}: {
  href: string;
  children: ReactNode;
  variant?: "outline" | "default";
}) {
  return (
    <a className={buttonVariants({ variant, size: "sm" })} href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLinkIcon aria-hidden="true" data-icon="inline-end" />
    </a>
  );
}

/** What to do on the page a step opened, in the order the page asks for it. */
export function OnThatPage({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">On that page:</p>
      <ol className="list-decimal space-y-2 pl-5 marker:text-muted-foreground">{children}</ol>
    </div>
  );
}

/** Values to type into a Cloudflare form, each with its label as the form shows it. */
export function FormValues({ values }: { values: readonly { label: string; value: string; empty?: string }[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-1.5 rounded-lg bg-muted p-3">
      {values.map(({ label, value, empty }) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0">
            {value === "" ? (
              <span className="text-muted-foreground">{empty ?? "Leave empty"}</span>
            ) : (
              <Copyable value={value} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A value shown as it is to be typed, with a button that copies it. */
export function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code className="font-mono [overflow-wrap:anywhere]">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy ${value}`}
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </span>
  );
}

/** What finishing the step looks like, so a person can tell it worked before moving on. */
export function Outcome({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Done when:</span> {children}
    </p>
  );
}

export function Warning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
