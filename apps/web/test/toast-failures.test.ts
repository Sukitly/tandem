// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useWorkbench, WorkbenchProvider } from "../src/app/workbench.tsx";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("../src/hooks/use-mobile.ts", () => ({
  useIsMobile: () => false,
}));

vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    workspaces: { remove: vi.fn().mockRejectedValue(new Error("Permission denied")) },
    conversations: { state: {} },
    files: {},
    comments: {},
  }),
}));

vi.mock("../src/rpc/use-replicated-state.ts", () => ({
  useReplicatedState: () => ({ conversations: [] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function TriggerFailure({ title, error }: { title: string; error: unknown }) {
  const { reportFailure } = useWorkbench();
  useEffect(() => {
    reportFailure(title, error);
  }, [reportFailure, title, error]);
  return null;
}

describe("toast error reporting", () => {
  test("reportFailure dispatches toast.error with title and description", () => {
    render(
      createElement(
        WorkbenchProvider,
        null,
        createElement(TriggerFailure, {
          title: "Action failed",
          error: new Error("Network timeout"),
        }),
      ),
    );

    expect(toast.error).toHaveBeenCalledWith("Action failed", {
      description: "Network timeout",
    });
  });

  test("reportFailure handles non-Error objects gracefully", () => {
    render(
      createElement(
        WorkbenchProvider,
        null,
        createElement(TriggerFailure, {
          title: "Unexpected error",
          error: "Something went wrong",
        }),
      ),
    );

    expect(toast.error).toHaveBeenCalledWith("Unexpected error", {
      description: "Something went wrong",
    });
  });

  test("removeProject failure dispatches toast.error", async () => {
    function TriggerRemove() {
      const { removeProject } = useWorkbench();
      useEffect(() => {
        removeProject(1);
      }, [removeProject]);
      return null;
    }

    render(createElement(WorkbenchProvider, null, createElement(TriggerRemove)));

    // wait for workspaces.remove rejection
    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Could not remove the project", {
        description: "Permission denied",
      });
    });
  });
});
