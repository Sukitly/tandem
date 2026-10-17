import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

async function fixture(t, mobile, denyStorage = false) {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    cacheDir: "node_modules/.vite-composer-browser",
    resolve: {
      alias: [
        { find: "@/app/workbench.tsx", replacement: fileURLToPath(new URL("./reader-services.ts", import.meta.url)) },
      ],
    },
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: mobile ? 390 : 1000, height: mobile ? 420 : 844 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  if (denyStorage) {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Storage denied", "SecurityError");
        },
      });
    });
  }
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/browser/composer.html`);
  return page;
}

test("denied storage does not prevent theme selection or composer preferences", async (t) => {
  const page = await fixture(t, false, true);
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.getByRole("button", { name: "Composer options" }).click();
  await page.getByRole("menuitemradio", { name: "Queue follow-up" }).click();
  await page.getByRole("combobox", { name: "Message" }).fill("Storage is optional");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.mode === "followUp");
});

test("mobile composer bounds long input, keeps Stop reachable, and offers follow-up without a keyboard", async (t) => {
  const page = await fixture(t, true);
  const input = page.getByRole("combobox", { name: "Message" });
  await input.fill("A long message.\n".repeat(100));
  const bounds = await input.boundingBox();
  assert.ok(bounds.height <= 85);
  assert.ok((await page.getByTestId("transcript").boundingBox()).height >= 40);
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  assert.ok((await stop.boundingBox()).height >= 44);
  await stop.tap();
  assert.equal(await page.locator("body").getAttribute("data-stopped"), "yes");
  await page.getByRole("button", { name: "Composer options" }).tap();
  await page.getByRole("menuitemradio", { name: "Queue follow-up" }).tap();
  await input.fill("After this turn");
  await page.getByRole("button", { name: "Send", exact: true }).tap();
  await page.waitForFunction(() => document.body.dataset.mode === "followUp");
  await input.fill("/");
  await page.getByRole("option", { name: /review/ }).tap();
  assert.equal(await input.inputValue(), "/review ");
  await page.getByRole("button", { name: "50% context" }).tap();
  await page.getByText("Used tokens", { exact: true }).waitFor();
});

test("platform typing retains native undo and redo and tabs retain keyboard focus visibility", async (t) => {
  const page = await fixture(t, false);
  const input = page.getByRole("combobox", { name: "Message" });
  await page.evaluate(() => {
    const reference = document.createElement("textarea");
    reference.setAttribute("aria-label", "Native reference");
    document.body.append(reference);
  });
  const native = page.getByRole("textbox", { name: "Native reference" });
  await native.focus();
  await native.pressSequentially("hello");
  await native.press("ControlOrMeta+z");
  const nativeUndo = await native.inputValue();
  await input.focus();
  await input.pressSequentially("hello");
  await input.press("ControlOrMeta+z");
  assert.equal(await input.inputValue(), nativeUndo);
  await input.press("ControlOrMeta+Shift+z");
  assert.equal(await input.inputValue(), "hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Message"]').value === "");
  await input.press("ControlOrMeta+z");
  assert.equal(await input.inputValue(), "");
  await page.keyboard.press("Tab");
  const tab = page.getByRole("tab", { name: "Chat", exact: true });
  await tab.focus();
  assert.equal(await tab.evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
  assert.ok(await tab.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth) >= 2));
});

test("a long dialog fits a short viewport and its final input and action remain reachable", async (t) => {
  const page = await fixture(t, true);
  await page.getByRole("button", { name: "Show dialog" }).tap();
  const dialog = page.getByRole("dialog", { name: "Responsive dialog" });
  await dialog.waitFor();
  await page.setViewportSize({ width: 390, height: 300 });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getBoundingClientRect().height <= 268);
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 300);
  await page.getByRole("textbox", { name: "Name" }).fill("Still reachable");
  await page.getByRole("button", { name: "Save", exact: true }).tap();
  await dialog.waitFor({ state: "hidden" });
});
