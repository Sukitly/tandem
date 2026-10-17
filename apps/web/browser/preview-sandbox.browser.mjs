import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { chromium } from "playwright";
import { handlePreviewHttpRequest } from "../../server/src/preview-proxy.ts";

const resources = [];
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close();
});
async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  resources.push(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test("direct navigation and new tabs retain preview origin isolation, even with a permissive upstream CSP", async () => {
  const attempts = [];
  const upstream = await listen((request, response) => {
    if (request.url === "/permissive")
      response.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-same-origin");
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><body>Preview<script>
      (async () => {
        try { localStorage.setItem('compromised', 'yes'); document.body.dataset.storage = 'allowed'; }
        catch { document.body.dataset.storage = 'blocked'; }
        try { await fetch('/private', { method: 'POST', credentials: 'include' }); }
        catch {}
        document.body.dataset.done = 'yes';
      })();
    </script>`);
  });
  let port;
  port = await listen((request, response) => {
    if (request.url.startsWith("/preview/")) {
      handlePreviewHttpRequest({
        request,
        response,
        targetPort: upstream,
        targetPath: request.url.endsWith("permissive") ? "/permissive" : "/",
        isSubpath: true,
      });
    } else if (request.url === "/private") {
      attempts.push(request.headers.origin);
      response.writeHead(request.headers.origin === `http://127.0.0.1:${port}` ? 200 : 403);
      response.end();
    } else {
      response.setHeader("Content-Type", "text/html");
      response.setHeader("Set-Cookie", "session=test; HttpOnly; SameSite=Strict; Path=/");
      response.end("<!doctype html><body>Tandem</body>");
    }
  });
  const browser = await chromium.launch();
  resources.push(() => browser.close());
  const context = await browser.newContext();
  const origin = `http://127.0.0.1:${port}`;
  const main = await context.newPage();
  await main.goto(origin);
  for (const mode of ["direct", "new-tab"]) {
    for (const path of ["/", "/permissive"]) {
      const url = `${origin}/preview/${upstream}${path}`;
      let page;
      if (mode === "direct") {
        page = await context.newPage();
        await page.goto(url);
      } else {
        const opened = context.waitForEvent("page");
        await main.evaluate((url) => window.open(url, "_blank", "noopener,noreferrer"), url);
        page = await opened;
      }
      await page.waitForSelector('body[data-done="yes"]');
      assert.equal(await page.locator("body").getAttribute("data-storage"), "blocked");
      await page.close();
    }
  }
  assert.deepEqual(attempts, ["null", "null", "null", "null"]);
  assert.equal(await main.evaluate(() => localStorage.getItem("compromised")), null);
});
