import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

async function fixture(t, mobile = false, layout = false) {
  const services = fileURLToPath(new URL("./panel-services.ts", import.meta.url));
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    cacheDir: "node_modules/.vite-panel-browser",
    resolve: {
      alias: ["@/rpc/connection.tsx", "@/rpc/use-project-changes.ts", "@/app/workbench.tsx"].map((find) => ({
        find,
        replacement: services,
      })),
    },
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: mobile ? 390 : 1200, height: 844 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  page.on("pageerror", (error) => t.diagnostic(error.stack ?? error.message));
  await page.addInitScript(() => {
    window.browserErrors = [];
    window.addEventListener("error", (event) => window.browserErrors.push(event.message));
  });
  await page.route(/\/preview\/\d+\//, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><label>Draft <input aria-label="Draft"></label></body></html>',
    }),
  );
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/browser/panel.html${layout ? "?layout" : ""}`);
  return page;
}

test("desktop Escape is not dismissal and nested overlay dialogs close first", async (t) => {
  const page = await fixture(t, false, true);
  const region = page.getByRole("region", { name: "Project panel" });
  await region.waitFor();
  assert.equal(await page.getByRole("dialog", { name: "Project panel" }).count(), 0);
  await page.getByRole("textbox", { name: "Chat draft" }).press("Escape");
  assert.equal(await region.isVisible(), true);
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  const terminal = page.locator(".xterm-helper-textarea").first();
  await terminal.focus();
  await terminal.press("Escape");
  assert.equal(await region.isVisible(), true);
  await page.getByRole("button", { name: "Close Shell one", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await confirmation.waitFor();
  await page.keyboard.press("Escape");
  await confirmation.waitFor({ state: "hidden" });
  assert.equal(await region.isVisible(), true);
  await page.setViewportSize({ width: 500, height: 844 });
  const overlay = page.getByRole("dialog", { name: "Project panel", exact: true });
  await overlay.waitFor();
  await page.getByRole("button", { name: "Close Shell one", exact: true }).click();
  await confirmation.waitFor();
  await page.keyboard.press("Escape");
  await confirmation.waitFor({ state: "hidden" });
  assert.equal(await overlay.isVisible(), true);
  assert.equal(await overlay.getAttribute("aria-modal"), "true");
  await overlay.focus();
  await page.keyboard.press("Escape");
  await overlay.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.browserErrors), []);
});

test("changes holds follow project visibility without disposing retained panels", async (t) => {
  const page = await fixture(t, false, true);
  await page.getByRole("tab", { name: "Files", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.changesHold1 === "1");
  await page.getByRole("button", { name: "Project two", exact: true }).click();
  await page.waitForFunction(
    () => document.body.dataset.changesHold1 === "0" && document.body.dataset.changesHold2 === "1",
  );
  await page.getByRole("button", { name: "Project one", exact: true }).click();
  await page.waitForFunction(
    () => document.body.dataset.changesHold1 === "1" && document.body.dataset.changesHold2 === "0",
  );
  await page.getByRole("button", { name: "Toggle panel" }).click();
  await page.waitForFunction(() => document.body.dataset.changesHold1 === "0");
  await page.getByRole("button", { name: "Toggle panel" }).click();
  await page.waitForFunction(() => document.body.dataset.changesHold1 === "1");
  assert.deepEqual(await page.evaluate(() => window.browserErrors), []);
});

test("overlay swipe and backdrop dismissal leave the persistent host reusable", async (t) => {
  const page = await fixture(t, true, true);
  const dialog = page.getByRole("dialog", { name: "Project panel", exact: true });
  await dialog.waitFor();
  const handle = await page.locator('[data-slot="drawer-swipe-handle"]').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let distance = 50; distance <= 500; distance += 50) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + distance }] });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Toggle panel", exact: true }).click();
  await dialog.waitFor();
  await page.mouse.click(10, 60);
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent === "Toggle panel");
  assert.deepEqual(await page.evaluate(() => window.browserErrors), []);
});

test("user-resized panel width survives collapse, overlay transitions, and reload", async (t) => {
  const page = await fixture(t, false, true);
  await page.getByRole("tab", { name: "Files", exact: true }).waitFor();
  const panel = page.locator("#files");
  const initial = (await panel.boundingBox()).width;
  const separator = await page.locator('[data-slot="resizable-handle"]').first().boundingBox();
  await page.mouse.move(separator.x - 1, separator.y + separator.height / 2);
  await page.mouse.down();
  await page.mouse.move(separator.x - 160, separator.y + separator.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForFunction(
    (before) => document.getElementById("files").getBoundingClientRect().width > before + 100,
    initial,
  );
  const resized = (await panel.boundingBox()).width;
  const storageKey = "react-resizable-panels:tandem.layout:conversation:files";
  await page.waitForFunction((key) => Number(JSON.parse(localStorage.getItem(key) ?? "{}").files) > 40, storageKey);
  const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole("button", { name: "Toggle panel" }).click();
    await page.waitForFunction(() => document.getElementById("files").getBoundingClientRect().width < 1);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), saved);
    await page.getByRole("button", { name: "Toggle panel" }).click();
    await page.waitForFunction(
      (width) => Math.abs(document.getElementById("files").getBoundingClientRect().width - width) < 2,
      resized,
    );
  }
  await page.getByTestId("workspace-host").evaluate((element) => {
    element.style.width = "520px";
  });
  await page.waitForFunction(
    () => document.querySelector('[data-slot="drawer-viewport"]')?.getAttribute("data-modal") === "true",
  );
  await page.waitForFunction(() => document.getElementById("files").getBoundingClientRect().width < 1);
  await page
    .getByRole("dialog", { name: "Project panel" })
    .evaluate((element) =>
      Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
  assert.deepEqual(await page.evaluate(() => window.browserErrors), [], "entering overlay");
  await page.getByTestId("workspace-host").evaluate((element) => {
    element.style.width = "100%";
  });
  await page.waitForFunction(
    (width) => Math.abs(document.getElementById("files").getBoundingClientRect().width - width) < 2,
    resized,
  );
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), saved);
  assert.deepEqual(await page.evaluate(() => window.browserErrors), []);
  await page.getByRole("button", { name: "Toggle panel" }).click();
  await page.waitForFunction(() => document.getElementById("files").getBoundingClientRect().width < 1);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), saved);
  await page.reload();
  await page.getByRole("tab", { name: "Files", exact: true }).waitFor();
  assert.ok(Math.abs((await panel.boundingBox()).width - resized) < 2);
  assert.deepEqual(await page.evaluate(() => window.browserErrors), []);
});

test("project and responsive switches retain real frames and terminal instances until deletion or disposal", async (t) => {
  const page = await fixture(t, false, true);
  await page.getByRole("tab", { name: "Files", exact: true }).waitFor();
  assert.equal(await page.locator("body").getAttribute("data-terminal-opens"), null);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const first = page.frameLocator('[data-workspace-panel="1"] iframe[title="Preview port 5173"]');
  await first.getByRole("textbox", { name: "Draft" }).fill("Project one state");
  const original = await page.locator('[data-workspace-panel="1"] iframe').elementHandle();
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.terminalOpens === "1");
  const terminal = await page.locator('[data-workspace-panel="1"] .xterm').elementHandle();
  await page.getByRole("button", { name: "Project two", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.terminalOpens === "2");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const second = page.frameLocator('[data-workspace-panel="2"] iframe[title="Preview port 5173"]');
  await second.getByRole("textbox", { name: "Draft" }).fill("Project two state");
  await page.getByRole("button", { name: "Project one", exact: true }).click();
  assert.equal(await first.getByRole("textbox", { name: "Draft" }).inputValue(), "Project one state");
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  assert.equal(
    await page
      .locator('[data-workspace-panel="1"] .xterm')
      .evaluate((element, previous) => element === previous, terminal),
    true,
  );
  await page.getByRole("textbox", { name: "Chat draft" }).fill("Keep the chat editor too");
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole("dialog", { name: "Project panel", exact: true });
  await page.waitForFunction(
    () => document.querySelector('[data-slot="drawer-viewport"]')?.getAttribute("data-modal") === "true",
  );
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
  await page.getByRole("tab", { name: "Files", exact: true }).focus();
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
  }
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  assert.equal(await first.getByRole("textbox", { name: "Draft" }).inputValue(), "Project one state");
  assert.equal(
    await page
      .locator('[data-workspace-panel="1"] iframe')
      .evaluate((element, previous) => element === previous, original),
    true,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Toggle panel" }).click();
  await first.getByRole("textbox", { name: "Draft" }).waitFor();
  await page.setViewportSize({ width: 1200, height: 844 });
  assert.equal(await page.getByRole("textbox", { name: "Chat draft" }).inputValue(), "Keep the chat editor too");
  await page.getByRole("textbox", { name: "Chat draft" }).fill("Chat remains interactive");
  assert.equal(await first.getByRole("textbox", { name: "Draft" }).inputValue(), "Project one state");
  assert.equal(await page.locator("body").getAttribute("data-terminal-opens"), "2");
  assert.equal(await page.locator("body").getAttribute("data-terminal-closes"), null);
  await page.getByRole("button", { name: "Hide workbench" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Show workbench" }).click();
  await first.getByRole("textbox", { name: "Draft" }).waitFor();
  await page.getByRole("button", { name: "No conversation" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.locator("iframe").count(), 2);
  await page.getByRole("button", { name: "Project one", exact: true }).click();
  assert.equal(await first.getByRole("textbox", { name: "Draft" }).inputValue(), "Project one state");
  await page.getByRole("button", { name: "Remove project one" }).click();
  await page.locator('[data-workspace-panel="1"]').waitFor({ state: "detached" });
  assert.equal(await second.getByRole("textbox", { name: "Draft" }).inputValue(), "Project two state");
  assert.equal(await page.locator("body").getAttribute("data-terminal-closes"), "1");
  await page.getByRole("button", { name: "Dispose workbench" }).click();
  assert.equal(await page.locator("iframe").count(), 0);
  assert.equal(await page.locator("body").getAttribute("data-terminal-closes"), "2");
});

test("available workspace width controls overlay mode and desktop positioning without reloading previews", async (t) => {
  const page = await fixture(t, false, true);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const frame = page.frameLocator('[data-workspace-panel="1"] iframe');
  await frame.getByRole("textbox", { name: "Draft" }).fill("Container resize state");
  await page.getByTestId("workspace-host").evaluate((element) => {
    element.style.width = "520px";
  });
  await page.waitForFunction(
    () => document.querySelector('[data-slot="drawer-viewport"]')?.getAttribute("data-modal") === "true",
  );
  assert.equal(page.viewportSize().width, 1200);
  const dialog = page.getByRole("dialog", { name: "Project panel", exact: true });
  assert.equal(await frame.getByRole("textbox", { name: "Draft" }).inputValue(), "Container resize state");
  await page.getByTestId("workspace-host").evaluate((element) => {
    element.style.width = "100%";
  });
  await page.waitForFunction(
    () => document.querySelector('[data-slot="drawer-viewport"]')?.getAttribute("data-modal") === "false",
  );
  await page.waitForFunction(() => {
    const slot = document.getElementById("files")?.getBoundingClientRect();
    const popup = document.querySelector('[data-slot="drawer-popup"]')?.getBoundingClientRect();
    return (
      slot &&
      popup &&
      Math.abs(slot.left - popup.left) < 2 &&
      Math.abs(slot.width - popup.width) < 2 &&
      Math.abs(slot.top - popup.top) < 2 &&
      Math.abs(slot.height - popup.height) < 2
    );
  });
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.getByRole("region", { name: "Project panel" }).isVisible(), true);
  assert.equal(await frame.getByRole("textbox", { name: "Draft" }).inputValue(), "Container resize state");
});

test("closing and reopening the desktop panel preserves its preview document", async (t) => {
  const page = await fixture(t, false, true);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Preview port 5173"]');
  await frame.getByRole("textbox", { name: "Draft" }).fill("Keep across panel close");
  await page.getByRole("button", { name: "Toggle panel" }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.locator("iframe").count(), 1);
  const chat = page.locator("#conversation");
  assert.ok((await chat.boundingBox()).width > 1100);
  await page.getByRole("button", { name: "Toggle panel" }).click();
  await frame.getByRole("textbox", { name: "Draft" }).waitFor();
  assert.equal(await frame.getByRole("textbox", { name: "Draft" }).inputValue(), "Keep across panel close");
});

test("a narrow project toolbar uses its container width on desktop and touch layouts", async (t) => {
  for (const mobile of [false, true]) {
    const page = await fixture(t, mobile);
    const header = page.locator("header[data-panel-toolbar]");
    await header.waitFor();
    assert.ok(await header.evaluate((element) => element.scrollWidth <= element.clientWidth));
    for (const name of ["Files", "Changes", "Terminal", "Preview"]) {
      const tab = page.getByRole("tab", { name, exact: true });
      assert.equal(await tab.isVisible(), true);
      if (mobile) {
        const bounds = await tab.boundingBox();
        assert.ok(bounds.width >= 44 && bounds.height >= 44);
      }
    }
    const label = page.getByRole("tab", { name: "Changes", exact: true }).locator("span");
    assert.equal(await label.evaluate((element) => getComputedStyle(element).position), "absolute");
  }
});

test("preview port switching preserves form state and reload replaces only the selected frame", async (t) => {
  const page = await fixture(t);
  assert.equal(await page.locator("iframe").count(), 0);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const first = page.frameLocator('iframe[title="Preview port 5173"]');
  await first.getByRole("textbox", { name: "Draft" }).fill("Keep the first port");
  await page.getByRole("tab", { name: "8080", exact: true }).click();
  const second = page.frameLocator('iframe[title="Preview port 8080"]');
  await second.getByRole("textbox", { name: "Draft" }).fill("Reload this port");
  await page.getByRole("button", { name: "Reload preview" }).click();
  await page.waitForFunction(() => document.querySelectorAll("iframe").length === 2);
  await second.getByRole("textbox", { name: "Draft" }).waitFor();
  assert.equal(await second.getByRole("textbox", { name: "Draft" }).inputValue(), "");
  await page.getByRole("tab", { name: "5173", exact: true }).click();
  assert.equal(await first.getByRole("textbox", { name: "Draft" }).inputValue(), "Keep the first port");
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  assert.equal(await first.getByRole("textbox", { name: "Draft" }).inputValue(), "Keep the first port");
});
