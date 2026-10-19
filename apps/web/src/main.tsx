import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { takePairingCode } from "./auth/pair-screen.tsx";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");

// Consumed once, before the first render: a fragment must leave the address bar before anything else runs.
const pairCode = takePairingCode();

createRoot(root).render(
  <StrictMode>
    <App pairCode={pairCode} />
  </StrictMode>,
);
