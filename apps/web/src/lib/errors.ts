import { toast } from "sonner";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tell the person an action failed, and why, where they are looking: a toast, with the reason beneath the title. */
export function reportFailure(title: string, error: unknown): void {
  toast.error(title, { description: errorMessage(error) });
}
