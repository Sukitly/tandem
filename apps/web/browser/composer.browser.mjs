import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

async function fixture(t, mobile, denyStorage = false, focus = false) {
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
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/browser/composer.html${focus ? "?focus" : ""}`);
  return page;
}

test("denied storage does not prevent theme selection or composer preferences", async (t) => {
  const page = await fixture(t, true, true);
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.getByRole("button", { name: "Composer options" }).click();
  await page.getByRole("menuitemradio", { name: "Queue follow-up" }).click();
  await page.getByRole("combobox", { name: "Message" }).fill("Storage is optional");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.mode === "followUp");
});

test("mobile send preferences never change desktop keyboard or button sending", async (t) => {
  const page = await fixture(t, false);
  await page.evaluate(() => localStorage.setItem("tandem.sendMode", "followUp"));
  await page.reload();
  const options = page.getByRole("button", { name: "Composer options" });
  const followUp = page.getByRole("menuitemradio", { name: "Queue follow-up" });
  const input = page.getByRole("combobox", { name: "Message" });
  await options.click();
  await page.getByRole("menuitemradio", { name: "Emacs editing" }).waitFor();
  assert.equal(await followUp.count(), 0);
  assert.equal(await page.getByRole("menuitemradio", { name: "Steer current turn" }).count(), 0);
  await page.keyboard.press("Escape");
  for (const [message, key, mode] of [
    ["Desktop Enter", "Enter", "steer"],
    ["Desktop Alt Enter", "Alt+Enter", "followUp"],
    ["Desktop button", null, "steer"],
  ]) {
    await input.fill(message);
    if (key) await input.press(key);
    else await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction((text) => document.body.dataset.sent === text, message);
    assert.equal(await page.locator("body").getAttribute("data-mode"), mode);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await options.click();
  await followUp.waitFor();
  assert.equal(await followUp.getAttribute("aria-checked"), "true");
  await page.keyboard.press("Escape");
  await input.fill("Mobile button");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.sent === "Mobile button");
  assert.equal(await page.locator("body").getAttribute("data-mode"), "followUp");
  await page.setViewportSize({ width: 1000, height: 844 });
  await input.fill("Desktop again");
  await input.press("Enter");
  await page.waitForFunction(() => document.body.dataset.sent === "Desktop again");
  assert.equal(await page.locator("body").getAttribute("data-mode"), "steer");
  assert.equal(await page.evaluate(() => localStorage.getItem("tandem.sendMode")), "followUp");
});

test("controls keep their normal borders and shadows without gray focus rings in either theme", async (t) => {
  const page = await fixture(t, false, false, true);
  const controls = [
    page.getByRole("textbox", { name: "Input", exact: true }),
    page.getByRole("textbox", { name: "Textarea", exact: true }),
    page.getByRole("textbox", { name: "Grouped input" }),
    page.getByRole("button", { name: "Default button" }),
    page.getByRole("button", { name: "Outline button" }),
    page.getByRole("tab", { name: "One", exact: true }),
    page.getByRole("combobox", { name: "Choice" }),
  ];
  for (const dark of [false, true]) {
    if (dark) await page.getByRole("button", { name: "Switch theme" }).click();
    for (const control of controls) {
      const surface =
        (await control.getAttribute("aria-label")) === "Grouped input" ? page.getByTestId("input-group") : control;
      await surface.evaluate((element) =>
        Promise.allSettled(element.getAnimations().map((animation) => animation.finished)),
      );
      const border = await surface.evaluate((element) => getComputedStyle(element).borderColor);
      await page.keyboard.press("Tab");
      await control.focus();
      assert.ok(await control.evaluate((element) => element.matches(":focus-visible")));
      await surface.evaluate((element) =>
        Promise.allSettled(element.getAnimations().map((animation) => animation.finished)),
      );
      const actual = await surface.evaluate((element) => {
        const style = getComputedStyle(element);
        const probe = document.createElement("div");
        probe.style.boxShadow = style.getPropertyValue("--tw-shadow") || "0 0 #0000";
        document.body.append(probe);
        const normalShadow = getComputedStyle(probe).boxShadow;
        probe.remove();
        return { border: style.borderColor, outline: style.outlineStyle, shadow: style.boxShadow, normalShadow };
      });
      assert.equal(actual.border, border, await control.evaluate((element) => element.outerHTML));
      assert.equal(actual.outline, "none");
      assert.equal(actual.shadow, actual.normalShadow);
    }
    const invalid = page.getByRole("textbox", { name: "Invalid input" });
    await invalid.focus();
    assert.ok(await invalid.evaluate((element) => getComputedStyle(element).boxShadow.includes("3px")));
  }
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

test("platform typing retains native undo and redo without gray tab focus outlines", async (t) => {
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
  assert.equal(
    await input.evaluate((element) =>
      /0px 0px 0px [1-9]\d*px/.test(getComputedStyle(element.closest('[data-slot="input-group"]')).boxShadow),
    ),
    false,
    "The message composer must not gain an outer focus ring",
  );
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
  assert.equal(await tab.evaluate((element) => getComputedStyle(element).outlineStyle), "none");
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
