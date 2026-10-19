import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const patterns = readFileSync(fileURLToPath(new URL("../../../.dockerignore", import.meta.url)), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

/** A `.dockerignore` pattern as a regular expression: anchored at the context root, and also matching what is inside. */
function toRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern.charAt(index);
    if (pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 2;
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}(?:/.*)?$`);
}

const matchers = patterns.map(toRegExp);
const excluded = (path: string): boolean => matchers.some((matcher) => matcher.test(path));

test.each([
  "node_modules/react/index.js",
  "apps/web/node_modules/react/index.js",
  "apps/web/node_modules/.vite-temp/vite.config.ts.timestamp.mjs",
  "apps/server/node_modules/.bin/vitest",
  "packages/client/node_modules/@tandem/contracts",
  "apps/web/dist/index.html",
  "apps/web/dist/assets/index-abc.js",
  "apps/server/.env",
  "apps/server/.env.local",
  ".env.production",
  "apps/server/.tandem/app.sqlite",
  "apps/server/debug.log",
  "apps/web/.DS_Store",
  ".git/HEAD",
  "compose.override.yaml",
])("keeps host-only file out of the image build context: %s", (path) => {
  expect(excluded(path)).toBe(true);
});

test.each([
  "Dockerfile",
  "compose.yaml",
  "package.json",
  "bun.lock",
  "apps/server/package.json",
  "apps/server/src/main.ts",
  "apps/web/package.json",
  "apps/web/index.html",
  "apps/web/src/main.tsx",
  "apps/web/public/favicon.ico",
  "packages/contracts/src/index.ts",
  "scripts/sandbox.sh",
])("sends source file to the image build context: %s", (path) => {
  expect(excluded(path)).toBe(false);
});
