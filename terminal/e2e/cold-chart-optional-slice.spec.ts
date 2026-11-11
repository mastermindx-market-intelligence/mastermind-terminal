import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

// T08 — a cold chart paints from its REQUIRED OHLC without waiting on the OPTIONAL slice.
//
// The daily chart used to `await Promise.all([ohlc, slice])` (lib/dataCache.ts getSliceAndOhlc),
// so a slice held up anywhere — origin, edge, a slow link — held back bars that had already
// arrived. Measured on the real route by #842: slice delayed 8 s → OHLC 133.9 ms, ready 8,225.8 ms.
//
// Every arm drives the real /terminal route and controls the two files with route interception.
// "Ready" is the existing `mm:terminal-visual-ready` edge; the slice's own state is the chart
// wrapper's `data-slice-state` (pending / data / absent / unavailable).

type ReadyDetail = { symbol: string; timeframe: string; generation: number; state: "data" | "empty" };

declare global {
  interface Window {
    __t08Ready: (ReadyDetail & { at: number })[];
  }
}

test.setTimeout(120_000);

/** Hold a route until the test lets it go. Released in `finally` so no route outlives its test. */
function hold() {
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  return {
    release,
    handler: async (route: Route) => {
      await gate;
      await route.continue().catch(() => {});
    },
  };
}

function recordReady(page: Page) {
  return page.addInitScript(() => {
    window.__t08Ready = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => {
      window.__t08Ready.push({ ...(event as CustomEvent<ReadyDetail>).detail, at: performance.now() });
    });
  });
}

const readyFor = (page: Page, symbol: string) =>
  page.evaluate((s) => window.__t08Ready.filter((d) => d.symbol === s), symbol);

const sliceState = (page: Page) => page.evaluate(() => {
  const wrap = document.querySelector<HTMLElement>(".chart-wrap[data-slice-state]");
  return wrap ? { state: wrap.dataset.sliceState ?? null, symbol: wrap.dataset.sliceSymbol ?? null } : null;
});

const paneState = (page: Page) => page.evaluate(() => {
  const tag = document.querySelector<HTMLElement>(".mm-ptag");
  const empty = document.querySelector<HTMLElement>(".chart-empty");
  return {
    tag: tag && tag.style.display !== "none" ? tag.textContent ?? "" : null,
    emptyShown: !!empty && empty.style.display !== "none",
    emptyMsg: document.querySelector(".chart-empty .ce-msg")?.textContent ?? "",
  };
});

function countRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return (file: string) => urls.filter((url) => url.includes(`/data/${file}`)).length;
}

async function pickSymbol(page: Page, testInfo: TestInfo, symbol: string) {
  if (testInfo.project.name === "desktop") await page.locator(".pair").first().click({ timeout: 20_000 });
  else await page.locator(".m-symbar").click({ timeout: 20_000 });
  const input = page.locator(".sh input");
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.click({ timeout: 20_000 });
  await page.keyboard.type(symbol);
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  // Match the ticker cell exactly: the row's text also carries the avatar letter ("A" + "AAPL").
  await page.locator(`.sres .r-opt:has(.tk:text-is("${symbol}"))`).first().click({ timeout: 20_000 });
  await expect(page.locator(".mm-ptag-sym")).toHaveText(symbol, { timeout: 30_000 });
}

test("slow slice, fast OHLC: bars paint and announce ready while the slice is still pending", async ({ page }) => {
  const sliceGate = hold();
  const requests = countRequests(page);
  await recordReady(page);
  await page.route("**/data/NVDA.slice.json", sliceGate.handler);
  try {
    await page.goto("/terminal?sym=NVDA");

    // THE DEFECT: with the slice held, the chart never became ready. Now it must, on the OHLC alone.
    await expect.poll(async () => (await readyFor(page, "NVDA")).filter((d) => d.state === "data").length, {
      message: "the chart should announce data-ready while its optional slice is still held",
      timeout: 60_000,
    }).toBeGreaterThan(0);
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 20_000 });
    expect((await paneState(page)).tag).toContain("NVDA");
    // The slice's absence is stated as PENDING — not as "no signals" and not as a client fallback.
    await expect.poll(() => sliceState(page), { timeout: 20_000 }).toEqual({ state: "pending", symbol: "NVDA" });
  } finally {
    sliceGate.release();
  }
  // Released, the same generation picks the slice up without a second ready edge or a refetch.
  await expect.poll(() => sliceState(page), { timeout: 20_000 }).toEqual({ state: "data", symbol: "NVDA" });
  await page.waitForTimeout(1_000);
  expect((await readyFor(page, "NVDA")).filter((d) => d.state === "data")).toHaveLength(1);
  // Preload reuse + single flight: one transfer per file, slice held or not.
  expect(requests("NVDA.json")).toBe(1);
  expect(requests("NVDA.slice.json")).toBe(1);
});

test("fast slice, slow OHLC: no ready edge until the bars actually arrive", async ({ page }) => {
  const ohlcGate = hold();
  await recordReady(page);
  await page.route("**/data/NVDA.json", ohlcGate.handler);
  try {
    const sliceServed = page.waitForResponse((response) => response.url().includes("/data/NVDA.slice.json"), { timeout: 60_000 });
    await page.goto("/terminal?sym=NVDA");
    await sliceServed;
    // A slice on its own is not a chart. Sample a window after it lands: nothing may claim ready
    // (data OR empty), and the pane must not say the symbol has no history.
    await page.waitForTimeout(3_000);
    expect(await readyFor(page, "NVDA")).toEqual([]);
    expect((await paneState(page)).emptyMsg).not.toContain("No daily history");
  } finally {
    ohlcGate.release();
  }
  await expect.poll(async () => (await readyFor(page, "NVDA")).map((d) => d.state), { timeout: 60_000 }).toEqual(["data"]);
  await expect.poll(() => sliceState(page), { timeout: 20_000 }).toEqual({ state: "data", symbol: "NVDA" });
});

test("unavailable OHLC is not announced as ready and is not reported as missing history", async ({ page }) => {
  await recordReady(page);
  await page.route("**/data/NVDA.json", (route) => route.fulfill({ status: 503, body: "" }));
  const failed = page.waitForResponse((response) => response.url().includes("/data/NVDA.json"), { timeout: 60_000 });
  await page.goto("/terminal?sym=NVDA");
  await failed;
  await expect.poll(async () => (await paneState(page)).emptyShown, { timeout: 30_000 }).toBe(true);
  const pane = await paneState(page);
  expect(pane.emptyMsg).not.toContain("No daily history");
  expect(pane.emptyMsg).toContain("NVDA");
  await page.waitForTimeout(2_000);
  expect(await readyFor(page, "NVDA")).toEqual([]);
});

test("unavailable slice over painted bars: stated as unavailable, and no signals are invented", async ({ page }, testInfo) => {
  // zh rides the tablet project (the suite-wide one-language-per-project convention).
  const zh = testInfo.project.name === "tablet";
  await page.addInitScript((lang) => {
    localStorage.setItem("mm.inds", JSON.stringify(["_oracle"]));
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    if (lang) localStorage.setItem("mm.lang", "zh");
  }, zh);
  await recordReady(page);
  await page.route("**/data/NVDA.slice.json", (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/terminal?sym=NVDA");
  if (zh) await expect(page.locator("html")).toHaveAttribute("data-lang", "zh", { timeout: 20_000 });

  // The bars still paint and announce, exactly once.
  await expect.poll(async () => (await readyFor(page, "NVDA")).filter((d) => d.state === "data").length, {
    message: "the chart should announce data-ready on its OHLC even though the slice failed",
    timeout: 60_000,
  }).toBeGreaterThan(0);
  // A failed slice is UNAVAILABLE — not absent, not "no signals for this symbol".
  await expect.poll(() => sliceState(page), { timeout: 20_000 }).toEqual({ state: "unavailable", symbol: "NVDA" });
  const chip = page.locator(".statusline > .mm").first().locator(":scope > span");
  await expect(chip).toContainText(zh ? "信号暂不可用" : "Signals unavailable", { timeout: 20_000 });
  // Nothing stands in for the engine's stream: with the Oracle study on, the unscored client
  // fallback would draw markers off these bars. A failed read must not.
  await expect(page.locator("[data-sig-layer] g")).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  await expect(page.locator("[data-sig-layer] g")).toHaveCount(0, { timeout: 20_000 });
  expect((await readyFor(page, "NVDA")).filter((d) => d.state === "data")).toHaveLength(1);
});

test("a late slice for the previous symbol cannot paint into the current chart", async ({ page }, testInfo) => {
  const nvdaSlice = hold();
  await recordReady(page);
  await page.route("**/data/NVDA.slice.json", nvdaSlice.handler);
  try {
    await page.goto("/terminal?sym=NVDA");
    await expect.poll(async () => (await readyFor(page, "NVDA")).length, { timeout: 60_000 }).toBeGreaterThan(0);
    await pickSymbol(page, testInfo, "AAPL");
    await expect.poll(async () => (await readyFor(page, "AAPL")).filter((d) => d.state === "data").length, { timeout: 60_000 }).toBeGreaterThan(0);
    await expect.poll(() => sliceState(page), { timeout: 20_000 }).toEqual({ state: "data", symbol: "AAPL" });
  } finally {
    nvdaSlice.release();
  }
  // NVDA's slice now lands. It belongs to a superseded generation and must change nothing.
  await page.waitForResponse((response) => response.url().includes("/data/NVDA.slice.json"), { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(1_500);
  expect(await sliceState(page)).toEqual({ state: "data", symbol: "AAPL" });
  await expect(page.locator(".mm-ptag-sym")).toHaveText("AAPL", { timeout: 20_000 });
});
