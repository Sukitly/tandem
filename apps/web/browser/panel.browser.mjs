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
  await page.route(/\/preview\/\d+\//, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><label>Draft <input aria-label="Draft"></label></body></html>',
    }),
  );
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/browser/panel.html${layout ? "?layout" : ""}`);
  return page;
}

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
  assert.equal(await dialog.isVisible(), true);
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
