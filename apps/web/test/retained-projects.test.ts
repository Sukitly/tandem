import { expect, test } from "vitest";
import { retainedProjects } from "../src/app/retained-projects.ts";

test("only visible, visited projects are retained and switches never duplicate them", () => {
  const empty: readonly number[] = [];
  expect(retainedProjects(empty, 1, false, [1, 2])).toBe(empty);
  const first = retainedProjects(empty, 1, true, [1, 2]);
  expect(first).toEqual([1]);
  const both = retainedProjects(first, 2, true, [1, 2]);
  expect(both).toEqual([1, 2]);
  expect(retainedProjects(both, 1, true, [1, 2])).toBe(both);
  expect(retainedProjects(both, null, false, [1, 2])).toBe(both);
});

test("authoritative deletion releases a retained project, even when selection is stale", () => {
  expect(retainedProjects([1, 2], 1, true, [2])).toEqual([2]);
  expect(retainedProjects([1], null, false, [])).toEqual([]);
  const previous = [1, 2];
  expect(retainedProjects(previous, null, false, undefined)).toBe(previous);
});
