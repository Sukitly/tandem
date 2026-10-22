import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { type ComponentProps, type CSSProperties, type ReactNode, useId } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A part of a segment, shown when its row is opened, such as one file of the files. */
type ContextUsageDetail = {
  id: string;
  label: ReactNode;
  value: number;
};

/** What a part of the context window is taken up by, such as the system prompt or the conversation. */
type ContextUsageSegment = {
  id: string;
  label: ReactNode;
  /** How much of the window it takes, in the unit of `max`. */
  value: number;
  /**
   * Any CSS colour, for its cells or its part of the bar, and its row. Left out, the segments take the
   * theme's chart colours in turn, `--chart-1` to `--chart-5` and round again.
   */
  color?: string;
  /** What it is made of. A row that has them opens to show them. */
  details?: ContextUsageDetail[];
  /** At the end of the row, before its value, such as a button that compacts the conversation. */
  action?: ReactNode;
};

/** A figure that is not a part of the window, such as what it cost. */
type ContextUsageRow = {
  label: ReactNode;
  value: ReactNode;
};

type ContextUsageCardProps = {
  /** The most the window holds, in any unit. Nothing is drawn when it is not more than 0. */
  max: number;
  /**
   * How much of it is used. Left out, it is the segments added up. When it is
   * given as well, it is what the number, the percentage and what is left say,
   * and the segments should add up to it.
   */
  used?: number;
  /** In the header, before the badge. */
  title?: ReactNode;
  /** At the end of the header, such as the model, as an official `Badge`. */
  badge?: ReactNode;
  /**
   * What the used part is made of, in the order it is drawn. Left out, the used
   * part is one colour and there is no list.
   */
  segments?: ContextUsageSegment[];
  /** After the list of segments: figures that are not parts of the window. Formatted by you. */
  rows?: ContextUsageRow[];
  /** In the footer, at the end, such as a button that starts a new chat. */
  action?: ReactNode;
  /** The percentage of the window from which the percentage is in the colour of a warning. */
  warnAt?: number;
  /** The percentage from which it, what is left and the button are in the colour of an error. */
  dangerAt?: number;
  /**
   * Writes a figure, in the language of the reader. The default is compact
   * ("175.6K", and "17.6万" in Chinese). It is used for the number, the list,
   * what is left, and by the other labels.
   */
  formatValue?: (value: number) => string;
  /** The window, after the number that is used. Defaults to "of 200K tokens". */
  maxLabel?: (max: string) => ReactNode;
  /** What is left, in the footer. Defaults to "24.4K left". */
  remainingLabel?: (left: string) => ReactNode;
  /** Whether the footer says what is left. */
  showRemaining?: boolean;
  /** Names the drawing of the window for screen readers. Defaults to "175.6K of 200K used". */
  meterLabel?: (used: string, max: string) => string;
  /**
   * How the window is drawn. `grid` is a grid of cells, which the eye can count.
   * `bar` is one bar, the simple way: the used part along it, divided between the
   * segments when there are some, and in one colour when there are none.
   */
  meter?: "grid" | "bar";
  className?: string;
};

const COLUMNS = 40;
const ROWS = 6;
/** The cells that make up the window. A cell is a 240th of it. */
const CELLS = COLUMNS * ROWS;
/** The theme's colours for the segments that have none of their own. */
const CHART_COLORS = 5;

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompact(value: number) {
  return compact.format(value);
}

function colorOf(segment: ContextUsageSegment, index: number) {
  return segment.color ?? `var(--chart-${(index % CHART_COLORS) + 1})`;
}

/**
 * How full the window is, and how that is to be shown. The percentage is the
 * rounded one that is written, so the tone is never at odds with what is read.
 */
function measure(used: number, max: number, warnAt: number, dangerAt: number) {
  const percent = Math.min(100, Math.max(0, Math.round((used / max) * 100)));
  const tone = percent >= dangerAt ? "danger" : percent >= warnAt ? "warning" : undefined;

  return { percent, tone, left: Math.max(0, max - used) };
}

/**
 * How many cells each value fills. They are in proportion, the whole is
 * rounded, and the cells are shared out by the largest remainders so that the
 * rounding does not move a segment's edge by more than a cell. A value over 0
 * is never left with no cell, or it could not be seen. Values that add up to
 * more than the window are scaled down to it.
 */
function cellCounts(values: number[], max: number) {
  const positive = values.map((value) => Math.max(0, value));
  const sum = positive.reduce((total, value) => total + value, 0);
  const scale = sum > max ? max / sum : 1;
  const exact = positive.map((value) => ((value * scale) / max) * CELLS);
  const counts = exact.map(Math.floor);
  let missing = Math.min(CELLS, Math.round(exact.reduce((a, b) => a + b, 0))) - counts.reduce((a, b) => a + b, 0);

  for (const { index } of exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest)) {
    if (missing <= 0) {
      break;
    }

    counts[index] = (counts[index] ?? 0) + 1;
    missing -= 1;
  }

  // The cell for a value that was rounded away comes from the largest one when
  // the window is full, and from the empty part when it is not.
  for (const [index, value] of positive.entries()) {
    if (value > 0 && counts[index] === 0) {
      counts[index] = 1;
    }
  }

  while (counts.reduce((a, b) => a + b, 0) > CELLS) {
    const largest = counts.indexOf(Math.max(...counts));
    counts[largest] = (counts[largest] ?? 0) - 1;
  }

  return counts;
}

/** The cells of the window in order: the colour of each used one, and `null` for the ones that are left. */
function drawCells(segments: ContextUsageSegment[], used: number, max: number) {
  const values = segments.length > 0 ? segments.map((s) => s.value) : [used];
  const counts = cellCounts(values, max);
  const cells: ({ color?: string } | null)[] = [];

  for (const [index, count] of counts.entries()) {
    const color = segments[index] ? colorOf(segments[index], index) : undefined;

    for (let cell = 0; cell < count; cell++) {
      cells.push({ color });
    }
  }

  while (cells.length < CELLS) {
    cells.push(null);
  }

  return cells;
}

/**
 * The parts of the used bar, each with its share of the window in percent. They
 * are scaled to the window when they add up to more than it. A part that has no
 * value is left out, and the one that is left has a colour of its own only when
 * it is a segment.
 */
function barParts(segments: ContextUsageSegment[], used: number, max: number) {
  const parts =
    segments.length > 0
      ? segments.map((segment, index) => ({
          key: segment.id,
          color: colorOf(segment, index) as string | undefined,
          value: Math.max(0, segment.value),
        }))
      : [{ key: "used", color: undefined, value: Math.max(0, used) }];
  const sum = parts.reduce((total, part) => total + part.value, 0);
  const scale = sum > max ? max / sum : 1;

  return parts
    .filter((part) => part.value > 0)
    .map((part) => ({
      key: part.key,
      color: part.color,
      width: ((part.value * scale) / max) * 100,
    }));
}

/** What is passed to a part to colour it: its own colour is a custom property, so a style file can use it. */
function seriesStyle(color: string | undefined): CSSProperties | undefined {
  return color ? ({ "--series": color } as CSSProperties) : undefined;
}

function LegendRow({
  segment,
  color,
  formatValue,
}: {
  segment: ContextUsageSegment;
  color: string;
  formatValue: (value: number) => string;
}) {
  const details = segment.details ?? [];
  const swatch = (
    <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--series)] shrink-0" style={seriesStyle(color)} />
  );
  const end = (
    <span className="gap-2 ml-auto flex shrink-0 items-center">
      {segment.action}
      <span className="text-muted-foreground tabular-nums">{formatValue(segment.value)}</span>
    </span>
  );

  if (details.length === 0) {
    return (
      <li data-slot="context-usage-segment">
        <div className="gap-2 py-1.5 text-sm flex items-center">
          {swatch}
          <span className="min-w-0 truncate">{segment.label}</span>
          {end}
        </div>
      </li>
    );
  }

  return (
    <Collapsible render={<li />} data-slot="context-usage-segment">
      <div className="gap-2 py-1.5 text-sm flex items-center">
        {swatch}
        <CollapsibleTrigger className="gap-1 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 group/segment flex min-w-0 items-center outline-none">
          <span className="min-w-0 truncate">{segment.label}</span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground shrink-0 transition-transform group-data-panel-open/segment:rotate-180 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        {end}
      </div>
      <CollapsibleContent>
        <ul className="gap-1 pb-1.5 ps-4.5 flex flex-col">
          {details.map((detail) => (
            <li key={detail.id} className="gap-2 text-muted-foreground text-xs flex items-center justify-between">
              <span className="min-w-0 truncate">{detail.label}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">{formatValue(detail.value)}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * How much of a context window is used, as a card: the number and the
 * percentage, the window drawn as a grid of cells or as a bar, what the used
 * part is made of and what is left. It has no surface or border of its own, so it sits in a
 * `Popover`, as `ContextUsage` does, or in a card of yours. Everything but the
 * window is optional, so one with only a total is a card too.
 */
function ContextUsageCard({
  max,
  used: usedProp,
  title = "Context window",
  badge,
  segments = [],
  rows = [],
  action,
  warnAt = 80,
  dangerAt = 95,
  formatValue = formatCompact,
  maxLabel = (value) => `of ${value} tokens`,
  remainingLabel = (value) => `${value} left`,
  showRemaining = true,
  meterLabel = (used, total) => `${used} of ${total} used`,
  meter = "grid",
  className,
  ...props
}: ContextUsageCardProps & Omit<ComponentProps<"div">, keyof ContextUsageCardProps | "children">) {
  const titleId = useId();

  if (!(max > 0)) {
    return null;
  }

  const used = usedProp ?? segments.reduce((total, segment) => total + segment.value, 0);
  const { percent, tone, left } = measure(used, max, warnAt, dangerAt);
  const cells = meter === "grid" ? drawCells(segments, used, max) : [];
  const parts = meter === "bar" ? barParts(segments, used, max) : [];
  const meterName = meterLabel(formatValue(used), formatValue(max));

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, and this is a title with figures
    <div
      role="group"
      aria-labelledby={titleId}
      data-slot="context-usage-card"
      className={cn("flex flex-col", className)}
      {...props}
    >
      <div className="gap-4 p-4 flex flex-col">
        <div className="gap-2 flex items-center justify-between">
          <p id={titleId} className="font-medium text-sm min-w-0 truncate">
            {title}
          </p>
          {badge}
        </div>
        <div className="flex items-center justify-between">
          <p className="gap-1.5 flex min-w-0 items-baseline">
            <span className="font-medium text-xl tracking-tight tabular-nums">{formatValue(used)}</span>
            <span className="text-muted-foreground text-sm">{maxLabel(formatValue(max))}</span>
          </p>
          <span
            data-slot="context-usage-percent"
            data-tone={tone}
            className="rounded-4xl bg-muted px-2.5 py-0.5 font-medium text-muted-foreground text-sm data-[tone=danger]:bg-destructive/10 data-[tone=danger]:text-destructive data-[tone=warning]:bg-warning data-[tone=warning]:text-warning-foreground shrink-0 tabular-nums"
          >
            {percent}%
          </span>
        </div>
        {meter === "bar" ? (
          <div role="img" aria-label={meterName} className="h-2 gap-0.5 rounded-full bg-muted flex overflow-hidden">
            {parts.map((part) => (
              <span
                key={part.key}
                className="min-w-0.5 rounded-full bg-[var(--series,var(--primary))] h-full"
                style={{ ...seriesStyle(part.color), width: `${part.width}%` }}
              />
            ))}
          </div>
        ) : (
          <div role="img" aria-label={meterName} className="gap-0.5 grid grid-cols-[repeat(40,minmax(0,1fr))]">
            {cells.map((cell, index) => (
              <span
                // The cells are the same for as long as they are drawn, and have no identity of their own.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={index}
                data-filled={cell ? true : undefined}
                className="rounded-[2px] bg-muted data-[filled=true]:bg-[var(--series,var(--primary))] aspect-square"
                style={seriesStyle(cell?.color)}
              />
            ))}
          </div>
        )}
        {segments.length > 0 && (
          <ul className="gap-0.5 flex flex-col">
            {segments.map((segment, index) => (
              <LegendRow key={segment.id} segment={segment} color={colorOf(segment, index)} formatValue={formatValue} />
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <dl className="gap-1.5 border-t pt-4 text-xs flex flex-col">
            {rows.map((row, index) => (
              <div
                // The rows are the caller's, in a fixed order.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={index}
                className="flex items-center justify-between"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="font-mono tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {(showRemaining || action) && (
        <div data-slot="context-usage-footer" className="gap-3 border-t px-4 py-3 flex items-center justify-between">
          {showRemaining ? (
            <span
              data-tone={tone}
              className="text-muted-foreground text-sm data-[tone=danger]:text-destructive tabular-nums"
            >
              {remainingLabel(formatValue(left))}
            </span>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
    </div>
  );
}

type ContextUsageProps = ContextUsageCardProps & {
  /** The button's content. Defaults to the percentage and the window, "88% of 200K". */
  children?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Which side of the button the card opens on. It flips when there is no room. */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** On the button. */
  className?: string;
  /** On the popover. */
  contentClassName?: string;
};

/**
 * How much of the context window is used, as a quiet button with the percentage
 * that opens a `ContextUsageCard` on a click or a tap. The shadcn/ui Context
 * pattern is the same with a `HoverCard`, which opens only when a pointer
 * hovers, so it cannot be opened on a touch screen. From `dangerAt` the button
 * is in the colour of an error.
 */
function ContextUsage({
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = "top",
  align = "end",
  className,
  contentClassName,
  ...card
}: ContextUsageProps) {
  const { max, warnAt = 80, dangerAt = 95, formatValue = formatCompact } = card;

  if (!(max > 0)) {
    return null;
  }

  const used = card.used ?? (card.segments ?? []).reduce((total, segment) => total + segment.value, 0);
  const { percent, tone } = measure(used, max, warnAt, dangerAt);

  return (
    <Popover open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-tone={tone}
            className={cn("data-[tone=danger]:text-destructive tabular-nums", className)}
          />
        }
      >
        {children ?? `${percent}% of ${formatValue(max)}`}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className={cn("w-90 gap-0 p-0 max-w-[calc(100vw-2rem)]", contentClassName)}
      >
        <ContextUsageCard {...card} />
      </PopoverContent>
    </Popover>
  );
}

export type { ContextUsageCardProps, ContextUsageDetail, ContextUsageProps, ContextUsageRow, ContextUsageSegment };
export { ContextUsage, ContextUsageCard };
