import { Menu } from "@base-ui/react/menu";
import { cn } from "cn";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

/** One level of effort, or thinking, a model can be run at. */
type ModelSelectorEffort = {
  id: string;
  name: string;
  /**
   * At the end of the row, such as a "Recommended" tag or a warning about
   * usage. Several tags go in one fragment.
   */
  end?: ReactNode;
  disabled?: boolean;
};

type ModelSelectorModel = {
  id: string;
  name: string;
  /** A line under the name. */
  description?: ReactNode;
  /**
   * Before the name, in the menu only, level with the name rather than with the
   * name and its line together. When any model has one, the others keep the
   * space, so the names start in the same place.
   */
  icon?: ReactNode;
  /**
   * At the end of the row, in a column of its own for every model, such as an
   * "Upgrade" tag. Several tags go in one fragment. Left of the check.
   */
  end?: ReactNode;
  /**
   * The levels this model runs at, from the lowest up, and they may differ from
   * one model to the next. A model with none, or with only one, has nothing to
   * choose, so it has no effort row and the button shows no effort for it.
   */
  efforts?: ModelSelectorEffort[];
  /**
   * The level this model is at when it is picked and the current one is not
   * among its `efforts`, such as the one that was chosen for another model.
   */
  defaultEffort?: string;
  /** A heading to list this model under. Models with the same heading are shown together. */
  group?: string;
  /** More to match when searching, besides the name and the id, such as the maker. */
  keywords?: string[];
  disabled?: boolean;
  /**
   * Called instead of picking the model, which is then not marked as chosen and
   * leaves `value` alone. For a model the person cannot use yet, where picking
   * it opens an upgrade.
   */
  onSelect?: () => void;
};

type ModelSelectorProps = {
  models: ModelSelectorModel[];
  /** The chosen model's id. Pass it with `onValueChange` to control it. */
  value?: string;
  defaultValue?: string;
  /**
   * Called with the model picked, and with the effort that goes with it: the
   * current one when the model offers it, otherwise the model's `defaultEffort`,
   * otherwise nothing. Set both from this and the pair is never out of step. A
   * model with a single effort gives that one. Ignore it to keep the current
   * effort as it is while the person tries other models. The efforts' own
   * `onEffortChange` is not called for this.
   */
  onValueChange?: (id: string, effort: string | undefined) => void;
  /**
   * The chosen effort's id. What is shown is the one that goes with the chosen
   * model, as for `onValueChange`, so an effort the model does not offer is not.
   */
  effort?: string;
  defaultEffort?: string;
  onEffortChange?: (id: string) => void;
  /** Names the effort row. */
  effortLabel?: string;
  /** At the top of the effort menu, saying what the levels mean. */
  effortDescription?: ReactNode;
  /** At the bottom of the menu, such as a note about plans with a link. */
  footer?: ReactNode;
  /**
   * Adds a search box to the menu, and the models are narrowed as you type. On
   * by default for more models than the list shows without scrolling. The effort
   * row is out of the way while there is something typed.
   */
  search?: boolean;
  searchPlaceholder?: string;
  /** Shown when nothing matches. */
  emptyLabel?: string;
  /** Shown on the button when no model is chosen. */
  placeholder?: string;
  disabled?: boolean;
  /** Which side of the button the menu opens on. It flips when there is no room. */
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  /** On the button. */
  className?: string;
  /** On the menu. It is 20rem wide unless this says otherwise. */
  contentClassName?: string;
};

/**
 * The value of a prop that may be controlled: the prop when it is given, and the
 * component's own otherwise, as the prompt input does for its text.
 */
function useControllable(value: string | undefined, defaultValue: string | undefined) {
  const [own, setOwn] = useState(defaultValue);

  return [value !== undefined ? value : own, setOwn] as const;
}

/** The models that fit in the list before it scrolls. More than this and it searches. */
const LIST_ROWS = 6;

/**
 * The effort that goes with a model: the one given when the model offers it,
 * otherwise the model's `defaultEffort` when that is one of its efforts. A model
 * with one effort has only that, and one with none has nothing.
 */
function resolveEffort(model: ModelSelectorModel | undefined, effort: string | undefined) {
  const efforts = model?.efforts ?? [];

  if (efforts.length < 2) {
    return efforts[0]?.id;
  }

  if (efforts.some((item) => item.id === effort)) {
    return effort;
  }

  return efforts.some((item) => item.id === model?.defaultEffort) ? model?.defaultEffort : undefined;
}

/** The models in the order of their first heading. Those with none are one section with no heading. */
function toSections(models: ModelSelectorModel[]) {
  const sections: { name: string | undefined; models: ModelSelectorModel[] }[] = [];

  for (const model of models) {
    let section = sections.find((item) => item.name === model.group);

    if (!section) {
      section = { name: model.group, models: [] };
      sections.push(section);
    }

    section.models.push(model);
  }

  return sections;
}

/** Filtering is only turned on for a menu that searches, so the one that does not is as it was. */
function FilterFrame({
  on,
  query,
  onQueryChange,
  children,
}: {
  on: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  children: ReactNode;
}) {
  if (!on) {
    return children;
  }

  return (
    <Menu.FilterProvider value={query} onValueChange={onQueryChange} autoHighlight>
      {children}
    </Menu.FilterProvider>
  );
}

/** The items that are filtered have to be in a list, and those that are not searching are not. */
function ListFrame({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <Menu.List>{children}</Menu.List> : children;
}

/**
 * The model, and how hard it thinks, that the next message goes to. A quiet
 * button for the prompt input's toolbar that shows the model and its effort, and
 * opens a menu of the models, each with a line about it. The efforts of the
 * chosen model are one row down, in a menu of their own.
 *
 * Choosing something only tells you: switching models mid-reply is fine, as the
 * choice applies to the next message, and `disabled` is there if it is not.
 */
function ModelSelector({
  models,
  value,
  defaultValue,
  onValueChange,
  effort,
  defaultEffort,
  onEffortChange,
  effortLabel = "Effort",
  effortDescription,
  footer,
  search = models.length > LIST_ROWS,
  searchPlaceholder = "Search models",
  emptyLabel = "No models found",
  placeholder = "Select a model",
  disabled,
  side = "top",
  align = "end",
  className,
  contentClassName,
}: ModelSelectorProps) {
  const [modelId, setModelId] = useControllable(value, defaultValue);
  const [effortId, setEffortId] = useControllable(effort, defaultEffort);
  const [query, setQuery] = useState("");
  const model = models.find((item) => item.id === modelId);
  const efforts = model?.efforts ?? [];
  const currentEffort =
    efforts.length > 1 ? efforts.find((item) => item.id === resolveEffort(model, effortId)) : undefined;
  const hasIcons = models.some((item) => item.icon);
  const sections = toSections(models);
  const grouped = models.some((item) => item.group);
  // What is typed narrows the models, and the effort row would be filtered with
  // them, so it waits until the box is empty again.
  const showEffort = efforts.length > 1 && query.trim() === "";

  function pickModel(id: string) {
    const picked = models.find((item) => item.id === id);

    if (!picked) {
      return;
    }

    if (picked.onSelect) {
      picked.onSelect();

      return;
    }

    const resolved = resolveEffort(picked, effortId);

    setModelId(id);
    setEffortId(resolved);
    onValueChange?.(id, resolved);
  }

  function pickEffort(id: string) {
    setEffortId(id);
    onEffortChange?.(id);
  }

  function renderModel(item: ModelSelectorModel) {
    return (
      <DropdownMenuRadioItem
        key={item.id}
        value={item.id}
        disabled={item.disabled}
        // What the search matches: the name, the id and the keywords, not the
        // line or the end, so that "upgrade" does not find every locked model.
        label={search ? [item.name, item.id, ...(item.keywords ?? [])].join(" ") : undefined}
        // A radio item keeps the menu open unless it is told not to, and a
        // picked model is the end of the matter.
        closeOnClick
        // The icon, the end and the check sit level with the name, not between
        // it and its line, and the right edge is kept for the check on every row,
        // so the ends line up whether or not a model can be checked. How the row
        // is spaced is in the style file.
        className="gap-2.5 rounded-lg py-1.5 focus:[&_[data-slot=model-selector-description]]:text-muted-foreground [&_[data-slot=dropdown-menu-radio-item-indicator]]:top-1.5 [&_[data-slot=dropdown-menu-radio-item-indicator]]:h-5"
      >
        {hasIcons && (
          // Kept to the top of the row, so the icon is level with the name, not
          // between it and its line.
          <span className="h-5 w-4 flex shrink-0 items-center justify-center self-start">{item.icon}</span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{item.name}</span>
          {item.description && (
            <span data-slot="model-selector-description" className="text-muted-foreground text-xs">
              {item.description}
            </span>
          )}
        </span>
        {item.end && <span className="h-5 gap-1.5 flex shrink-0 items-center self-start">{item.end}</span>}
      </DropdownMenuRadioItem>
    );
  }

  return (
    <FilterFrame on={search} query={query} onQueryChange={setQuery}>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // A button will not shrink below its text on its own, so without
              // `min-w-0` a long name pushes the toolbar's other buttons out of
              // the box. With it the name gives way, cut short by the ellipsis.
              className={cn("font-normal text-muted-foreground text-sm max-w-full min-w-0 shrink", className)}
            />
          }
        >
          <span
            data-placeholder={!model || undefined}
            className="data-[placeholder=true]:text-muted-foreground truncate"
          >
            {model ? model.name : placeholder}
          </span>
          {currentEffort && <span className="opacity-70 shrink-0">{currentEffort.name}</span>}
          <ChevronDownIcon className="size-3 opacity-70 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={side}
          align={align}
          className={cn("w-80 rounded-xl max-w-(--available-width)", contentClassName)}
        >
          {search && (
            <>
              <div className="pb-1.5">
                <InputGroup className="h-8 rounded-lg border-transparent bg-input/30 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
                  <Menu.Input
                    render={<InputGroupInput />}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    autoComplete="off"
                  />
                  <InputGroupAddon className="pl-1.5">
                    <SearchIcon className="size-3.5 text-muted-foreground" />
                  </InputGroupAddon>
                </InputGroup>
              </div>
              <Menu.Empty className="py-6 text-muted-foreground text-sm text-center">{emptyLabel}</Menu.Empty>
            </>
          )}
          <ListFrame on={search}>
            {/* The list scrolls and the rows under it stay, so a long list does
                not push the effort row and the note off the end, or grow the
                menu to fill the screen. */}
            <DropdownMenuRadioGroup
              value={modelId ?? ""}
              onValueChange={pickModel}
              // The list can end in the middle of a row, so it fades where there
              // is more instead of being cut.
              className="max-h-80 scroll-fade-y overflow-y-auto overscroll-contain"
            >
              {grouped
                ? sections.map((section) => (
                    <Fragment key={section.name ?? ""}>
                      {section.name === undefined ? (
                        section.models.map(renderModel)
                      ) : (
                        <DropdownMenuGroup className="mt-3 first:mt-0">
                          <DropdownMenuLabel className="pt-1 pb-0.5 font-normal">{section.name}</DropdownMenuLabel>
                          {section.models.map(renderModel)}
                        </DropdownMenuGroup>
                      )}
                    </Fragment>
                  ))
                : models.map(renderModel)}
            </DropdownMenuRadioGroup>
            {showEffort && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="rounded-lg py-2">
                    {/* Fills the row, so the value sits against the arrow. */}
                    <span className="gap-2 flex flex-1 items-center justify-between">
                      {effortLabel}
                      {currentEffort && <span className="text-muted-foreground">{currentEffort.name}</span>}
                    </span>
                  </DropdownMenuSubTrigger>
                  {/* Apart from the menu it came from, rather than laid over its edge. */}
                  <DropdownMenuSubContent sideOffset={4} className="w-64 rounded-xl">
                    <DropdownMenuRadioGroup value={currentEffort?.id ?? ""} onValueChange={pickEffort}>
                      {effortDescription && (
                        <DropdownMenuLabel className="py-1.5 font-normal">{effortDescription}</DropdownMenuLabel>
                      )}
                      {efforts.map((item) => (
                        <DropdownMenuRadioItem
                          key={item.id}
                          value={item.id}
                          disabled={item.disabled}
                          closeOnClick
                          className="rounded-lg py-1.5"
                        >
                          <span className="flex-1">{item.name}</span>
                          {item.end && <span className="gap-1.5 flex shrink-0 items-center">{item.end}</span>}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}
          </ListFrame>
          {footer && (
            <>
              <DropdownMenuSeparator />
              <div className="px-1.5 py-2 text-muted-foreground text-xs">{footer}</div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </FilterFrame>
  );
}

export type { ModelSelectorEffort, ModelSelectorModel, ModelSelectorProps };
export { ModelSelector };
