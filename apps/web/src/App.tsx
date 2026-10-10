import { HEALTH_PATH, type HealthResponse } from "@tandem/contracts";
import { useEffect, useState } from "react";

type Status = { kind: "loading" } | { kind: "ok"; version: string } | { kind: "error"; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    fetch(HEALTH_PATH)
      .then((response) => response.json() as Promise<HealthResponse>)
      .then((body) => setStatus({ kind: "ok", version: body.version }))
      .catch((error: unknown) => setStatus({ kind: "error", message: String(error) }));
  }, []);

  return (
    <main>
      <h1>Tandem</h1>
      <p>
        {status.kind === "loading" && "Connecting to the server..."}
        {status.kind === "ok" && `Server is up (v${status.version}).`}
        {status.kind === "error" && `Server is unreachable: ${status.message}`}
      </p>
    </main>
  );
}
