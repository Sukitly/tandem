import { DevicesDialogProvider } from "@/auth/devices-dialog.tsx";
import { ProvidersDialogProvider } from "@/models/providers-dialog.tsx";
import { ConnectionProvider } from "@/rpc/connection.tsx";
import { PublicAccessPage } from "@/tunnel/public-access.tsx";
import { ConnectionScreen } from "./connection-screen.tsx";
import { useOnPublicAccess } from "./current-route.ts";
import { DraftsProvider } from "./drafts.tsx";
import { WorkbenchFrame } from "./workbench-frame.tsx";

/** What every page but pairing is inside: one connection, its drafts, and the workbench. */
export function SessionLayout() {
  return (
    <DraftsProvider>
      <ConnectionProvider fallback={(state) => <ConnectionScreen state={state} />}>
        <DevicesDialogProvider>
          <ProvidersDialogProvider>
            <SessionFrame />
          </ProvidersDialogProvider>
        </DevicesDialogProvider>
      </ConnectionProvider>
    </DraftsProvider>
  );
}

/** The public access page takes the screen, and the workbench waits hidden, with its views and drafts as they were. */
export function SessionFrame() {
  const publicAccess = useOnPublicAccess();
  return (
    <>
      <div hidden={publicAccess}>
        <WorkbenchFrame />
      </div>
      {publicAccess && <PublicAccessPage />}
    </>
  );
}
