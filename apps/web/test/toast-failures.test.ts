import { toast } from "sonner";
import { beforeEach, expect, test, vi } from "vitest";
import { reportFailure } from "../src/lib/errors.ts";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

test("reportFailure shows the title, with the reason of an Error beneath it", () => {
  reportFailure("Action failed", new Error("Network timeout"));
  expect(toast.error).toHaveBeenCalledWith("Action failed", { description: "Network timeout" });
});

test("reportFailure shows what is not an Error as text", () => {
  reportFailure("Unexpected error", "Something went wrong");
  expect(toast.error).toHaveBeenCalledWith("Unexpected error", { description: "Something went wrong" });
});
