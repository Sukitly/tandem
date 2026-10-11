import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

const LAST_CWD_KEY = "tandem.lastCwd";

/** The conversation list, and a form to start one in a directory. Projects replace the directory field later. */
export function AppSidebar({ selected, onSelect }: { selected: number | null; onSelect: (id: number) => void }) {
  const { conversations } = useConnected();
  const list = useReplicatedState(conversations.state)?.conversations ?? [];
  const providers = useProvidersDialog();
  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">Tandem</SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NewConversation onCreated={onSelect} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {list.map((summary) => (
                <SidebarMenuItem key={summary.id}>
                  <SidebarMenuButton
                    isActive={summary.id === selected}
                    onClick={() => onSelect(summary.id)}
                    tooltip={summary.cwd}
                  >
                    <span>{summary.title ?? "New conversation"}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => providers.open()}>
              <KeyRoundIcon />
              <span>Model providers</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
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
    <form onSubmit={create}>
      <Field data-invalid={error !== null} className="gap-2">
        <SidebarInput
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="/absolute/path/to/repository"
          aria-label="Directory"
          aria-invalid={error !== null}
          spellCheck={false}
        />
        <Button type="submit" size="sm" disabled={creating || cwd.trim() === ""}>
          <PlusIcon />
          New conversation
        </Button>
        {error !== null && <FieldError>{error}</FieldError>}
      </Field>
    </form>
  );
}
