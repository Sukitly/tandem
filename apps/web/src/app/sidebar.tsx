import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationSummary } from "@tandem/contracts";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

const LAST_CWD_KEY = "tandem.lastCwd";

/** The conversation list, and a form to start one in a directory. Workspaces replace the directory field later. */
export function Sidebar({ selected, onSelect }: { selected: number | null; onSelect: (id: number) => void }) {
  const { conversations } = useConnected();
  const list = useReplicatedState(conversations.state)?.conversations ?? [];
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="px-4 pt-4 pb-2 font-medium text-sm">Tandem</div>
      <NewConversation onCreated={onSelect} />
      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ul className="grid gap-0.5">
          {list.map((summary) => (
            <li key={summary.id}>
              <ConversationLink summary={summary} active={summary.id === selected} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

function ConversationLink({
  summary,
  active,
  onSelect,
}: {
  summary: ConversationSummary;
  active: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(summary.id)}
      className={cn(
        "grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <span className="truncate">{summary.title ?? "New conversation"}</span>
      <span className="truncate text-muted-foreground text-xs" title={summary.cwd}>
        {summary.cwd}
      </span>
    </button>
  );
}

function NewConversation({ onCreated }: { onCreated: (id: number) => void }) {
  const { conversations } = useConnected();
  const [cwd, setCwd] = useState(() => localStorage.getItem(LAST_CWD_KEY) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const id = await conversations.create({ cwd: cwd.trim() }, BACKGROUND_CONTEXT);
      localStorage.setItem(LAST_CWD_KEY, cwd.trim());
      onCreated(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={create} className="grid gap-2 px-4 pb-3">
      <Input
        value={cwd}
        onChange={(event) => setCwd(event.target.value)}
        placeholder="/absolute/path/to/repository"
        aria-label="Directory"
        spellCheck={false}
      />
      <Button type="submit" size="sm" disabled={creating || cwd.trim() === ""}>
        <PlusIcon />
        New conversation
      </Button>
      {error !== null && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </form>
  );
}
