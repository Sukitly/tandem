import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

async function fixture(t, mobile = true) {
  const services = fileURLToPath(new URL("./reader-services.ts", import.meta.url));
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    cacheDir: "node_modules/.vite-reader-browser",
    resolve: {
      alias: [
        { find: "@/rpc/connection.tsx", replacement: services },
        { find: "@/app/workbench.tsx", replacement: services },
        { find: "@/comments/project-comments.ts", replacement: services },
      ],
    },
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: mobile ? 390 : 1000, height: 844 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  t.after(() => assert.deepEqual(errors, [], "reader must not hide renderer or React errors"));
  return { page, url: `http://127.0.0.1:${server.httpServer.address().port}/browser/reader.html` };
}

test("comment drafts keep identity across readers and never follow an unverified line", async (t) => {
  const { page, url } = await fixture(t, false);
  await page.goto(`${url}?drafts`);
  const editor = page.getByRole("textbox", { name: "Comment", exact: true });
  await page.locator('[data-column-number="2"]').first().click();
  await editor.fill("Keep on target");
  await page.getByRole("button", { name: "Switch reader" }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "Keep on target");
  await page.getByRole("button", { name: "Insert line" }).click();
  await page.getByText("a.ts:3", { exact: true }).waitFor();
  assert.equal(await editor.inputValue(), "Keep on target");
  await page.getByRole("button", { name: "Switch reader" }).click();
  await editor.waitFor();
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.savedAnchor !== undefined);
  const anchor = await page.evaluate(() => JSON.parse(document.body.dataset.savedAnchor));
  assert.equal(anchor.line, 3);
  assert.equal(anchor.quote, "target");
  await editor.waitFor({ state: "hidden" });
  await page.locator('[data-column-number="3"]').first().click();
  await editor.fill("Ambiguous but retained");
  await page.getByRole("button", { name: "Duplicate context" }).click();
  await page.getByText("Location not verified. Copy this draft to a new line or cancel it.").waitFor();
  assert.equal(await editor.inputValue(), "Ambiguous but retained");
  assert.equal(await page.getByRole("button", { name: "Comment", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Switch reader" }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "Ambiguous but retained");
  await page.getByRole("button", { name: "Replace target" }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "Ambiguous but retained");
  assert.equal(await page.getByRole("button", { name: "Comment", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
});

test("a re-created diff restores reading position without replaying an old reveal", async (t) => {
  const { page, url } = await fixture(t, false);
  await page.goto(`${url}?diff&scroll`);
  const scroll = page.locator('[data-testid="diff-area"] .h-full.overflow-auto');
  await scroll.waitFor();
  await page.getByRole("button", { name: "Reveal diff line", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="diff-area"] .h-full.overflow-auto')?.scrollTop > 3000,
  );
  await scroll.evaluate((element) => {
    element.scrollTop = 2000;
  });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="diff-area"] .h-full.overflow-auto')?.scrollTop === 2000,
  );
  await page.getByRole("button", { name: "Toggle diff", exact: true }).click();
  await scroll.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Toggle diff", exact: true }).click();
  await scroll.waitFor();
  await page.waitForFunction(
    () => Math.abs(document.querySelector('[data-testid="diff-area"] .h-full.overflow-auto')?.scrollTop - 2000) < 2,
  );
});

test("reader focus targets survive changes to toggle labels", async (t) => {
  const { page, url } = await fixture(t);
  await page.goto(`${url}?renamed`);
  await page.getByRole("button", { name: "Expand reader", exact: true }).click();
  const restore = page.getByRole("button", { name: "Restore reader", exact: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Restore reader");
  await restore.click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Expand reader");
});

test("long files render a bounded window, reveal distant lines, and retain comment drafts", async (t) => {
  const { page, url } = await fixture(t, false);
  await page.goto(`${url}?file&long`);
  await page.locator('[data-virtual-file] [data-line="1"]').waitFor();
  assert.ok((await page.locator("[data-line]").count()) < 1500);
  await page.getByRole("button", { name: "Reveal line 15000" }).click();
  const distant = page.locator('[data-line="15000"]').filter({ hasText: "row 15000: one" });
  await distant.waitFor();
  assert.ok((await page.locator("[data-line]").count()) < 1500);
  await page.getByRole("searchbox", { name: "Search file" }).fill("row 19999: one");
  await page.getByRole("searchbox", { name: "Search file" }).press("Enter");
  await page.locator('[data-line="19999"]').filter({ hasText: "row 19999: one" }).waitFor();
  await page.getByRole("button", { name: "Reveal line 15000" }).click();
  await distant.waitFor();
  await page.getByRole("button", { name: "Update file" }).click();
  await page.locator('[data-line="15000"]').filter({ hasText: "row 15000: two" }).waitFor();
  const input = page.getByRole("spinbutton", { name: "Line", exact: true });
  await input.fill("15000");
  await page.getByRole("button", { name: "Go to line", exact: true }).click();
  const line = page.locator('[data-column-number="15000"]').first();
  await line.waitFor();
  await line.click();
  await page.getByRole("textbox", { name: "Comment", exact: true }).fill("Keep while scrolling");
  await input.fill("1");
  await page.getByRole("button", { name: "Go to line" }).click();
  await page.locator('[data-line="1"]').waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Comment", exact: true }).inputValue(), "Keep while scrolling");
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await page.getByRole("button", { name: "Wrap lines", exact: true }).click();
  await input.fill("15000");
  await page.getByRole("button", { name: "Go to line" }).click();
  const wrapped = page.locator('[data-line="15000"]').filter({ hasText: "row 15000: two" });
  await wrapped.waitFor();
  assert.ok((await wrapped.boundingBox()).height > 40);
  assert.ok((await page.locator("[data-line]").count()) < 1500);
  assert.equal(await page.getByRole("textbox", { name: "Comment", exact: true }).inputValue(), "Keep while scrolling");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.savedLine === "15000");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy entire file" }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied.split("\n").length, 20000);
  assert.ok(copied.endsWith("row 20000: two"));
});

test("fullscreen escapes a mobile drawer and preserves the reader, focus, and nested Escape order", async (t) => {
  const { page, url } = await fixture(t);
  await page.goto(url);
  const scroll = page.getByTestId("reader-scroll");
  await scroll.waitFor();
  const original = await scroll.elementHandle();
  await scroll.evaluate((element) => {
    element.scrollTop = 400;
  });
  assert.equal(await scroll.evaluate((element) => element.scrollTop), 400);
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "File example.ts" });
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && Math.abs(bounds.x) < 1 && Math.abs(bounds.y) < 1);
  assert.ok(Math.abs(bounds.width - 390) < 1 && Math.abs(bounds.height - 844) < 1);
  assert.equal(await scroll.evaluate((element, previous) => element === previous, original), true);
  assert.equal(await scroll.evaluate((element) => element.scrollTop), 400);
  await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Write comment" }).click();
  await page.getByRole("textbox", { name: "Comment" }).fill("Keep this comment");
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await page.getByRole("button", { name: "Full screen", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Comment" }).inputValue(), "Keep this comment");
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await page.getByRole("textbox", { name: "Comment" }).focus();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("textbox", { name: "Comment" }).count(), 0);
  assert.equal(await dialog.isVisible(), true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const toggle = page.getByRole("button", { name: "Full screen", exact: true });
  assert.equal(await toggle.isVisible(), true);
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Full screen");
});

test("real split diff hover resolves the correct column and equal-length updates render", async (t) => {
  const { page, url } = await fixture(t, false);
  await page.goto(`${url}?diff`);
  const right = page.locator('[data-additions] [data-line="1"]');
  await right.hover();
  const add = page.locator('[data-additions] [data-column-number="1"]');
  await add.waitFor();
  assert.equal(await add.evaluate((element) => getComputedStyle(element, "::after").content), '"+"');
  assert.ok((await add.boundingBox()).x > 450);
  assert.equal(await right.evaluate((element) => getComputedStyle(element).cursor), "text");
  await add.click();
  await page.getByRole("textbox", { name: "Comment" }).fill("Right side");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.savedSide === "additions");
  await page.locator('[data-deletions] [data-line="1"]').hover();
  const remove = page.locator('[data-deletions] [data-column-number="1"]');
  await remove.waitFor();
  assert.equal(await remove.evaluate((element) => getComputedStyle(element, "::after").content), '"+"');
  assert.ok((await remove.boundingBox()).x < 100);
  await remove.click();
  await page.getByRole("textbox", { name: "Comment" }).fill("Left side");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.savedSide === "deletions");
  await page.getByRole("button", { name: "Update patch" }).click();
  await page.locator('[data-additions] [data-line="2"]').filter({ hasText: "two" }).waitFor();
});

test("Files wraps long lines using the same reader control", async (t) => {
  const { page, url } = await fixture(t);
  await page.goto(`${url}?file`);
  const row = page.locator('[data-line="1"]');
  await row.waitFor();
  const before = await row.boundingBox();
  await page.getByRole("button", { name: "Wrap lines", exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('[data-line="1"]')?.getBoundingClientRect().height > 40);
  const after = await row.boundingBox();
  assert.ok(after.height > before.height);
  assert.ok(after.width <= 390);
  await page.getByRole("button", { name: "Full screen", exact: true }).tap();
  assert.equal(await page.getByRole("button", { name: "Do not wrap lines" }).getAttribute("aria-pressed"), "true");
});

test("touch can comment on code or use the explicit line control without hover", async (t) => {
  const { page, url } = await fixture(t);
  await page.goto(`${url}?diff`);
  const row = page.locator('[data-additions] [data-line="1"]');
  await row.tap();
  await page.getByRole("textbox", { name: "Comment" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  const number = page.locator('[data-additions] [data-column-number="1"]');
  assert.equal(await number.evaluate((element) => getComputedStyle(element).touchAction), "pan-y pinch-zoom");
  await number.tap();
  await page.getByRole("textbox", { name: "Comment" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  const number2 = page.locator('[data-additions] [data-column-number="2"]');
  await number2.tap();
  await page.getByRole("textbox", { name: "Comment" }).waitFor();
});
