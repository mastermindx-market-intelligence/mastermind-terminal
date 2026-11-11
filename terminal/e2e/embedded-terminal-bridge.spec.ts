import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";

const port = Number(process.env.TERMINAL_E2E_PORT || 3108);
const childOrigin = `http://127.0.0.1:${port}`;
const BRAIN_SCRIPT_SRC = "https://www.mastermind-x.com/mm_brain.js";

let parentServer: Server;
let parentOrigin = "";

test.beforeAll(async () => {
  parentServer = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      connection: "close",
    });
    response.end("<!doctype html><html><body><main>Dashboard parent</main></body></html>");
  });
  await new Promise<void>((resolve, reject) => {
    parentServer.once("error", reject);
    parentServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = parentServer.address();
  if (!address || typeof address === "string") throw new Error("parent harness failed to bind");
  parentOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (!parentServer) return;
  parentServer.closeAllConnections?.();
  await new Promise<void>((resolve) => parentServer.close(() => resolve()));
});

test("embedded Terminal keeps the exact parent origin and refreshes a stale warm deployment", async ({ page }) => {
  const originWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("target origin") && message.text().includes("does not match")) {
      originWarnings.push(message.text());
    }
  });
  await page.route(BRAIN_SCRIPT_SRC, (route) =>
    route.fulfill({ contentType: "application/javascript", body: "window.MMBrain = window.MMBrain || {};" }),
  );

  // A second loopback port models the dashboard's distinct origin without the
  // browser's localhost↔127 Private Network Access heuristics getting involved.
  await page.goto(`${parentOrigin}/us_stocks.html`);
  await page.evaluate(() => {
    (window as any).__bridgeMessages = [];
    window.addEventListener("message", (event) => {
      if (event.data?.source !== "mastermind-terminal") return;
      (window as any).__bridgeMessages.push({ origin: event.origin, ...event.data });
    });
  });

  const parentUrl = page.url();
  const childSrc =
    `${childOrigin}/analysis?symbol=INTC&page=intelligence&embed=dashboard&from=macro&ret=` +
    encodeURIComponent(parentUrl);

  await page.evaluate((src) => {
    const frame = document.createElement("iframe");
    frame.id = "bridge-frame";
    frame.src = src;
    frame.style.width = "1200px";
    frame.style.height = "800px";
    document.body.appendChild(frame);
  }, childSrc);

  await expect.poll(() => page.frames().some((frame) => frame.url().includes("/analysis?"))).toBe(true);
  let child = page.frames().find((frame) => frame.url().includes("/analysis?"));
  expect(child).toBeDefined();

  // Reproduce the real portal geometry: /analysis lives in a full-size dashboard
  // iframe. The shell must still occupy the entire iframe with its desktop header
  // and left nav intact; a flex/cascade regression here creates the exact large
  // black lower void and missing chrome seen in the reported screenshot.
  await child!.locator(".app2.analysis-route").waitFor({ state: "visible" });
  const layout = await child!.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".app2.analysis-route")!;
    const topbar = shell.querySelector<HTMLElement>(".topbar")!;
    const nav = shell.querySelector<HTMLElement>(".appnav")!;
    const shellRect = shell.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      shell: { width: shellRect.width, height: shellRect.height, bottom: shellRect.bottom },
      topbar: { width: topbarRect.width, height: topbarRect.height, top: topbarRect.top },
      nav: { height: navRect.height, top: navRect.top, bottom: navRect.bottom },
      display: getComputedStyle(shell).display,
    };
  });
  expect(layout.display).toBe("grid");
  expect(Math.abs(layout.shell.width - layout.viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.shell.height - layout.viewport.height)).toBeLessThanOrEqual(1);
  expect(layout.topbar.height).toBeGreaterThanOrEqual(50);
  expect(layout.topbar.top).toBeGreaterThanOrEqual(0);
  expect(layout.nav.top).toBeGreaterThanOrEqual(layout.topbar.height - 1);
  expect(layout.nav.bottom).toBeGreaterThanOrEqual(layout.viewport.height - 30);

  await expect.poll(() => page.evaluate(() =>
    (window as any).__bridgeMessages.some((message: any) =>
      message.type === "terminal:ready" && message.path === "/analysis"),
  )).toBe(true);

  // Parent → child on a non-chart route causes an in-frame navigation. The new
  // document's referrer is now app/127.0.0.1, not the parent localhost origin.
  // The bridge must retain the browser-verified parent origin from the first hop.
  await page.evaluate((targetOrigin) => {
    const frame = document.querySelector<HTMLIFrameElement>("#bridge-frame")!;
    frame.contentWindow!.postMessage(
      { source: "mastermind-dashboard", type: "terminal:set-symbol", symbol: "INTC" },
      targetOrigin,
    );
  }, childOrigin);

  await expect.poll(() => page.frames().some((frame) => frame.url().startsWith(`${childOrigin}/terminal?`))).toBe(true);
  child = page.frames().find((frame) => frame.url().startsWith(`${childOrigin}/terminal?`));
  expect(child).toBeDefined();

  await expect.poll(() => page.evaluate(() =>
    (window as any).__bridgeMessages.some((message: any) =>
      message.type === "terminal:ready" && message.path === "/terminal"),
  )).toBe(true);

  // Simulate the long-lived dashboard case from production: the iframe is still
  // mounted with an old data-dpl-id after a deploy. Its next set-symbol handoff
  // gets a no-body HEAD whose preload Link announces the new generation.
  await page.route(`${childOrigin}/terminal**`, async (route) => {
    if (route.request().method() === "HEAD") {
      await route.fulfill({
        status: 200,
        headers: {
          link: '</_next/static/media/font.woff2?dpl=new-generation>; rel=preload; as="font"',
          "cache-control": "no-store",
        },
      });
      return;
    }
    await route.continue();
  });

  await child!.evaluate(() => {
    document.documentElement.setAttribute("data-dpl-id", "old-generation");
  });

  const reloaded = page.waitForEvent("framenavigated", (frame) =>
    frame === child && frame.url().startsWith(`${childOrigin}/terminal?`),
  );
  await page.evaluate((targetOrigin) => {
    const frame = document.querySelector<HTMLIFrameElement>("#bridge-frame")!;
    frame.contentWindow!.postMessage(
      { source: "mastermind-dashboard", type: "terminal:set-symbol", symbol: "INTC" },
      targetOrigin,
    );
  }, childOrigin);
  await reloaded;

  expect(originWarnings).toEqual([]);
});

test("trusted Macro fullscreen Escape does not close the iframe before returning inline", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One real two-origin bridge qualification");
  const bars = Array.from({ length: 260 }, (_, i) => {
    const close = 100 + i / 5;
    return [new Date(Date.UTC(2024, 2, 4) - (259 - i) * 86400000).toISOString().slice(0, 10), close - 1, close + 2, close - 2, close, 1000000];
  });
  await page.route("**/data/NVDA.json", route => route.fulfill({ json: { bars } }));
  await page.goto(parentOrigin + "/us_stocks.html");
  const parentUrl = page.url();
  const childUrl = new URL("/embed/chart", childOrigin);
  childUrl.search = new URLSearchParams({ symbol: "NVDA", lang: "en", theme: "dark", fs: "1", embed: "dashboard", from: "macro", ret: parentUrl }).toString();
  await page.evaluate(({ src, origin }) => {
    const frame = document.createElement("iframe");
    frame.id = "bridge-frame";
    frame.allow = "fullscreen " + origin;
    frame.style.cssText = "width:900px;height:500px;border:0";
    frame.src = src;
    const messages: { source?: string; type?: string; token?: string }[] = [];
    Object.assign(window, { __bridgeMessages: messages });
    window.addEventListener("message", event => {
      if (event.source === frame.contentWindow && event.origin === origin) messages.push(event.data);
    });
    document.body.appendChild(frame);
  }, { src: childUrl.toString(), origin: childOrigin });
  await expect.poll(() => page.frames().some(frame => frame.url().includes("/embed/chart?"))).toBe(true);
  const child = page.frames().find(frame => frame.url().includes("/embed/chart?"))!;
  await expect(child.locator(".embed-chart-host canvas").first()).toBeVisible();
  await expect(child.locator("html")).toHaveAttribute("data-mm-embedded", "dashboard");
  expect(await child.evaluate(() => ({
    framed: window.parent !== window,
    referrer: new URL(document.referrer).origin,
    admitted: sessionStorage.getItem("mm.embeddedDashboard"),
    parent: sessionStorage.getItem("mm.embeddedDashboardOrigin"),
  }))).toEqual({ framed: true, referrer: parentOrigin, admitted: "1", parent: parentOrigin });
  const readMessages = () => page.evaluate(() => (window as unknown as Window & { __bridgeMessages: { source?: string; type?: string; token?: string; path?: string }[] }).__bridgeMessages);
  await expect.poll(async () => (await readMessages()).some(m => m.source === "mastermind-terminal" && m.type === "terminal:ready" && m.path === "/embed/chart")).toBe(true);
  await child.locator(".embed-fs").click();
  await expect.poll(() => child.evaluate(() => document.fullscreenElement === document.querySelector(".embed-root"))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.querySelector("#bridge-frame"))).toBe(true);
  await page.keyboard.press("Escape");
  // The default headless shell may deliver Escape to the page without performing
  // Chrome's browser-UI exit. This verifies the real bridge guard, then uses the
  // explicit exit control when needed; it does not claim physical Escape proof.
  await child.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await child.evaluate(parent => window.parent.postMessage({ source: "d06-test-fence", token: "after-first-escape" }, parent), parentOrigin);
  await expect.poll(async () => (await readMessages()).some(m => m.source === "d06-test-fence" && m.token === "after-first-escape")).toBe(true);
  expect((await readMessages()).filter(m => m.source === "mastermind-terminal" && m.type === "terminal:close")).toHaveLength(0);
  const protocolEscapeExited = await child.evaluate(() => document.fullscreenElement === null);
  if (!protocolEscapeExited) await child.locator(".embed-fs").click();
  await expect.poll(() => child.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await child.locator(".embed-fs").focus();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await readMessages()).filter(m => m.source === "mastermind-terminal" && m.type === "terminal:close").length).toBe(1);
  await info.attach("fullscreen-bridge-proof", {
    body: Buffer.from(JSON.stringify({ protocolEscapeExited, parentOrigin, childOrigin, messages: await readMessages(), scope: "real fullscreen and trusted parent; protocol keyboard, not physical Chrome UI" })),
    contentType: "application/json",
  });
});
