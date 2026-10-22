import { expect, test } from "vitest";
import { languageOfFile } from "../src/files/file-language.ts";

test("a file's language is its extension, in lower case", () => {
  expect(languageOfFile("app.ts")).toBe("ts");
  expect(languageOfFile("Component.TSX")).toBe("tsx");
  expect(languageOfFile("docker-compose.yml")).toBe("yml");
});

test("only the last extension counts", () => {
  expect(languageOfFile("archive.test.json")).toBe("json");
});

test("a file with no extension is named by the whole name", () => {
  expect(languageOfFile("Dockerfile")).toBe("dockerfile");
  expect(languageOfFile("Makefile")).toBe("makefile");
});

test("a dot file is named by the whole name, not by what follows its dot", () => {
  expect(languageOfFile(".bashrc")).toBe(".bashrc");
});
