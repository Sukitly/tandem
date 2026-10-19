import { useMatch, useParams } from "@tanstack/react-router";

/** An id as an address holds it: a whole number written out, and nothing else. */
export function idOf(text: string | undefined): number | null {
  if (text === undefined || !/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

/** The conversation the address names, if it names one. */
export function useConversationId(): number | null {
  return idOf(useParams({ strict: false }).conversationId);
}

/** The project a new conversation is being started in, if the address names one. */
export function useNewConversationWorkspaceId(): number | null {
  return idOf(useParams({ strict: false }).workspaceId);
}

/** Whether the public access page is the one open. */
export function useOnPublicAccess(): boolean {
  return useMatch({ from: "/session/public-access", shouldThrow: false }) !== undefined;
}
