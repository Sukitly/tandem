import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useConnected } from "@/rpc/connection.tsx";

/** Asks for a directory on the server's machine and adds it as a project. */
export function AddProjectDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (workspaceId: number) => void;
}) {
  const { workspaces } = useConnected();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const close = (next: boolean): void => {
    onOpenChange(next);
    if (!next) {
      setPath("");
      setError(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setAdding(true);
    setError(null);
    workspaces
      .add({ path }, BACKGROUND_CONTEXT)
      .then(
        (id) => {
          onAdded(id);
          close(false);
        },
        (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
      )
      .finally(() => setAdding(false));
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a project</DialogTitle>
            <DialogDescription>
              A directory on the machine Tandem runs on. Its conversations work in it.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={error !== null}>
            <FieldLabel htmlFor="project-path">Directory</FieldLabel>
            <Input
              id="project-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="~/code/my-app"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            {error === null ? (
              <FieldDescription>An absolute path, or one starting with ~.</FieldDescription>
            ) : (
              <FieldError>{error}</FieldError>
            )}
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={adding || path.trim() === ""}>
              Add project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
