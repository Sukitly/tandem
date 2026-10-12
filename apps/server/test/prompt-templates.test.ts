// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the templates' own `${...}` placeholders are the subject.
import { describe, expect, test } from "vitest";
import {
  expandPromptTemplate,
  type PromptTemplate,
  parseCommandArgs,
  parseFrontmatter,
  parsePromptTemplate,
  substituteArgs,
} from "../src/services/prompt-templates.ts";

const template = (name: string, content: string): PromptTemplate => ({
  name,
  description: "",
  content,
  origin: "project",
});

describe("parseFrontmatter", () => {
  test("splits a leading `---` block from the body, reading simple scalars", () => {
    const raw = '---\ndescription: Review changes\nargument-hint: "[focus]"\n---\nDo it.\n';
    expect(parseFrontmatter(raw)).toEqual({
      frontmatter: { description: "Review changes", "argument-hint": "[focus]" },
      body: "Do it.",
    });
  });

  test("without a frontmatter block the whole text is the body", () => {
    expect(parseFrontmatter("Do it.\n")).toEqual({ frontmatter: {}, body: "Do it.\n" });
    expect(parseFrontmatter("---\nno closing fence\n")).toEqual({
      frontmatter: {},
      body: "---\nno closing fence\n",
    });
  });
});

describe("parsePromptTemplate", () => {
  test("the file's name is the command, and its first non-empty line is the description", () => {
    expect(parsePromptTemplate("review.md", "\n  Review the changes\nmore\n", "global")).toEqual({
      name: "review",
      description: "Review the changes",
      content: "\n  Review the changes\nmore\n",
      origin: "global",
    });
  });

  test("a long first line is shortened for the menu", () => {
    const { description } = parsePromptTemplate("x.md", "a".repeat(80), "project");
    expect(description).toBe(`${"a".repeat(60)}...`);
  });
});

describe("parseCommandArgs", () => {
  test("splits on spaces, respecting quotes", () => {
    expect(parseCommandArgs('one "two three" four')).toEqual(["one", "two three", "four"]);
    expect(parseCommandArgs("")).toEqual([]);
    expect(parseCommandArgs("   ")).toEqual([]);
  });
});

describe("substituteArgs", () => {
  test("positional, all, default, and slice placeholders", () => {
    expect(substituteArgs("$1 and $2", ["a", "b"])).toEqual("a and b");
    expect(substituteArgs("$@ / $ARGUMENTS", ["a", "b"])).toEqual("a b / a b");
    expect(substituteArgs("${1:-fallback}", [])).toEqual("fallback");
    expect(substituteArgs("${1:-fallback}", ["given"])).toEqual("given");
    expect(substituteArgs("${@:-none}", ["a", "b"])).toEqual("a b");
    expect(substituteArgs("${@:2}", ["a", "b", "c"])).toEqual("b c");
    expect(substituteArgs("${@:2:1}", ["a", "b", "c"])).toEqual("b");
    expect(substituteArgs("$9", ["a"])).toEqual("");
  });

  test("an inserted argument is never expanded again", () => {
    expect(substituteArgs("$1", ["$2"])).toEqual("$2");
  });
});

describe("expandPromptTemplate", () => {
  const templates = [template("review", "Review ${1:-everything}.")];

  test("a message naming a template becomes its text", () => {
    expect(expandPromptTemplate("/review", templates)).toBe("Review everything.");
    expect(expandPromptTemplate("/review auth", templates)).toBe("Review auth.");
  });

  test("anything else is returned as it is", () => {
    expect(expandPromptTemplate("hello", templates)).toBe("hello");
    expect(expandPromptTemplate("/unknown", templates)).toBe("/unknown");
    expect(expandPromptTemplate("/reviewish", templates)).toBe("/reviewish");
  });
});
