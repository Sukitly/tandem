import { Button } from "@/components/ui/button.tsx";
import { MessageScrollerItem } from "@/components/ui/message-scroller.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

/**
 * The top of a transcript whose older messages a compaction took out of the view: a button that fetches the next
 * page of them. It is a row of the scroller, so it must be inside a `MessageList`.
 */
export function EarlierMessages({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  return (
    <MessageScrollerItem messageId="earlier">
      <div className="flex justify-center">
        <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={onLoad}>
          {loading && <Spinner data-icon="inline-start" />}
          {loading ? "Loading earlier messages" : "Show earlier messages"}
        </Button>
      </div>
    </MessageScrollerItem>
  );
}
