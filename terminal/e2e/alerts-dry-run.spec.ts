import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * E17: evaluator-backed, read-only alert dry run on the /alerts create form.
 *
 * Responsive (desktop / tablet / mobile projects), deterministic: the cockpit reads are fixtures,
 * and every UI verdict case fulfils /api/alerts/dry-run with a contract-shaped body. One case runs
 * the REAL handler (non-production fixture identity, real public/data/NVDA.json) so the browser
 * proves the server's own clock gate, and the negatives post straight to the real handler.
 *
 * Read-only is asserted at the browser boundary too: no request other than the dry run's own POST
 * may leave the page with a write method toward /api/alerts*.
 */

test.setTimeout(120_000);

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", last: 182.5 },
    AAPL: { name: "Apple", last: 201.1 },
  },
};

const SCHEMA = "alert-dry-run/1";
const CLOCKS = {
  evaluatedAt: "2026-10-09T21:30:00.000Z",
  lastBarDate: "2026-10-09",
  barCount: 1320,
  sourceAsOf: "2026-10-09T21:05:00.000Z",
  freshFrom: "2026-10-07",
  freshTo: "2026-10-09",
  creationFloorDate: "2026-10-09",
};
const WOULD = {
  schema: SCHEMA,
  readOnly: true,
  verdict: "would_trigger",
  symbol: "NVDA",
  timeframe: "1D",
  basis: "daily_bars_module_defaults",
  condition: {
    type: "suite_event",
    suite: "structure",
    key: "structure:bos",
    steps: [{ event: "bos", label: "Break of structure (BOS)" }],
    tier: "essential",
  },
  clocks: CLOCKS,
  decision: { fired: true, note: "Break of structure (BOS) ↑ confirmed 2026-10-09", value: 182.5, confirmedDate: "2026-10-09" },
  trace: [
    { id: "data", status: "pass" },
    { id: "fresh_window", status: "pass" },
    { id: "event_in_window", status: "pass", at: "2026-10-09" },
    { id: "filters", status: "not_applicable" },
    { id: "creation_floor", status: "pass", at: "2026-10-09" },
  ],
  recent: [
    { event: "bos", dir: "bull", anchorDate: "2026-10-02", confirmedDate: "2026-10-09" },
    { event: "bos", dir: "bear", anchorDate: "2026-09-18", confirmedDate: "2026-09-24" },
  ],
};
const SEQ_ARMED = {
  schema: SCHEMA,
  readOnly: true,
  verdict: "not_met",
  symbol: "NVDA",
  timeframe: "1D",
  basis: "daily_bars_module_defaults",
  condition: {
    type: "suite_sequence",
    suite: "structure",
    key: "structure:bos>choch",
    steps: [{ event: "bos", label: "Break of structure (BOS)" }, { event: "choch", label: "Change of character (CHoCH)" }],
    maxBarsBetween: 10,
    tier: "essential",
  },
  clocks: CLOCKS,
  decision: { fired: false },
  trace: [
    { id: "data", status: "pass" },
    { id: "fresh_window", status: "pass" },
    { id: "initial_state", status: "pass" },
    { id: "sequence_replay", status: "fail" },
    { id: "prior_history", status: "unsupported" },
  ],
  recent: [],
  // Step A on the creation day itself: the evaluator drops confirmations at or below the floor,
  // so a fresh alert can only arm on a bar from its creation day onward.
  sequenceState: { input: "initial", output: "simulated_armed", armedDate: "2026-10-09" },
};

type Lang = "en" | "zh";

/**
 * Sign in as the shell's non-production fixture account (a real owner id, so the gate asks
 * /api/me, which answers the webServer's TERMINAL_E2E_ENTITLEMENT), fixture the cockpit's reads,
 * and record every request that could write alert state.
 */
async function setup(page: Page, lang: Lang, baseURL: string | undefined) {
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL ?? "http://127.0.0.1:3108" }]);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  const writes: string[] = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith("/api/alerts")) return;
    if (req.method() === "GET") return;
    if (req.method() === "POST" && u.pathname === "/api/alerts/dry-run") return;
    writes.push(`${req.method()} ${u.pathname}`);
  });
  await page.route("**/api/alerts", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 418, json: { error: "e17 spec: no writes" } });
    return route.fulfill({ json: { alerts: [] } });
  });
  await page.route("**/api/alerts/receipts", (route) =>
    route.fulfill({
      json: { run: null, runs_state: "READ_OK_ZERO", last_success_at: null, outbox: [], outbox_state: "READ_OK_ZERO" },
    }),
  );
  return writes;
}

/** Open /alerts and switch the create form to the Suites category (retried: hydration race). */
async function openSuiteForm(page: Page) {
  await page.goto("/alerts");
  const panel = page.getByTestId("alert-dry-run");
  await expect(async () => {
    await page.locator(".alert-form > select").first().selectOption("suite");
    await expect(panel).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 45_000 });
  return panel;
}

async function expectContained(page: Page) {
  const m = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="alert-dry-run"]') as HTMLElement | null;
    return {
      doc: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      pScroll: p?.scrollWidth ?? -1,
      pClient: p?.clientWidth ?? -1,
    };
  });
  expect(m.doc, "no horizontal page scroll").toBeLessThanOrEqual(m.vw + 1);
  expect(m.pClient).toBeGreaterThan(0);
  expect(m.pScroll, "panel content fits its box").toBeLessThanOrEqual(m.pClient + 1);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.getByTestId("alert-dry-run").scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  const dir = process.env.E17_SHOT_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, path.join(dir, `${testInfo.project.name}-${name}.png`));
  }
}

for (const lang of ["en", "zh"] as const) {
  test(`would_trigger shows identity, instrument, timeframe and both clocks (${lang})`, async ({ page, baseURL }, testInfo) => {
    const writes = await setup(page, lang, baseURL);
    const posted: unknown[] = [];
    await page.route("**/api/alerts/dry-run", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ json: WOULD });
    });
    const panel = await openSuiteForm(page);
    await expect(panel).toHaveAttribute("data-dry-run-state", "idle");
    await panel.getByTestId("alert-dry-run-go").click();
    await expect(panel).toHaveAttribute("data-dry-run-verdict", "would_trigger", { timeout: 15_000 });

    // The exact unsaved condition the form holds, and nothing else.
    expect(posted).toEqual([{ symbol: "NVDA", condition: { type: "suite_event", suite: "structure", event: "bos" } }]);

    const clocks = panel.getByTestId("alert-dry-run-clocks");
    await expect(clocks.locator('[data-dry-run-key="structure:bos"]')).toBeVisible();
    await expect(clocks.locator('[data-dry-run-last-bar="2026-10-09"]')).toContainText("1320");
    await expect(clocks).toContainText("NVDA");
    await expect(clocks).toContainText("2026-10-09 21:05 UTC"); // source as-of (availability clock)
    await expect(clocks).toContainText("2026-10-09 21:30 UTC"); // evaluated at
    await expect(clocks).toContainText("2026-10-07 → 2026-10-09"); // fresh window
    await expect(panel.getByTestId("alert-dry-run-trace").locator("li")).toHaveCount(5);
    await expect(panel.locator('li[data-step="event_in_window"][data-status="pass"]')).toContainText("2026-10-09");
    await expect(panel.getByTestId("alert-dry-run-recent").locator("li")).toHaveCount(2);
    // The creation floor is a UTC calendar day, named as such (never an ambiguous "today").
    await expect(panel.locator('li[data-step="creation_floor"]')).toContainText("2026-10-09");
    await expect(panel.locator('li[data-step="creation_floor"]')).toContainText("UTC");
    await expect(panel).not.toContainText(lang === "en" ? "today" : "今天");
    if (lang === "en") {
      await expect(panel.locator('[data-verdict="would_trigger"]')).toContainText("Would trigger now");
      await expect(panel).toContainText("Read-only: nothing is created, armed, acknowledged or sent.");
      await expect(panel.getByTestId("alert-dry-run-go")).toHaveText("Run again");
    } else {
      await expect(panel.locator('[data-verdict="would_trigger"]')).toContainText("现在会触发");
      await expect(panel).toContainText("只读");
    }

    await expectContained(page);
    await shot(page, testInfo, `e17-would-trigger-${lang}`);
    expect(writes).toEqual([]);
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`sequence mode reports a SIMULATED arming from the exact initial state (${lang})`, async ({ page, baseURL }, testInfo) => {
    const writes = await setup(page, lang, baseURL);
    const posted: Array<{ condition?: { type?: string; steps?: Array<{ event: string }> } }> = [];
    await page.route("**/api/alerts/dry-run", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ json: SEQ_ARMED });
    });
    const panel = await openSuiteForm(page);
    await page.locator('select:has(option[value="seq"])').selectOption("seq", { timeout: 20_000 });
    await panel.getByTestId("alert-dry-run-go").click();
    await expect(panel).toHaveAttribute("data-dry-run-verdict", "not_met", { timeout: 15_000 });

    expect(posted).toHaveLength(1);
    expect(posted[0].condition?.type).toBe("suite_sequence");
    expect(posted[0].condition?.steps?.map((s) => s.event)).toEqual(["bos", "choch"]);
    // The browser never supplies recorded state: no _se / _sq / triggered in the body.
    expect(JSON.stringify(posted[0])).not.toMatch(/"_se"|"_sq"|"triggered"/);

    await expect(panel.locator('[data-dry-run-seq="simulated_armed"]')).toContainText(lang === "en" ? "SIMULATED" : "模拟");
    await expect(panel.locator('[data-dry-run-seq="simulated_armed"]')).toContainText("2026-10-09");
    await expect(panel.locator('li[data-step="prior_history"][data-status="unsupported"]')).toBeVisible();
    await expect(panel.locator('[data-verdict="not_met"]')).toContainText(lang === "en" ? "Would not trigger now" : "现在不会触发");
    // Trace copy derives the fresh-window size from the evaluator constant and names the UTC
    // creation day instead of an ambiguous "today".
    await expect(panel.locator('li[data-step="fresh_window"]')).toContainText(lang === "en" ? "last 3 bars" : "最近3根K线");
    await expect(panel.locator('li[data-step="prior_history"]')).toContainText("2026-10-09");
    await expect(panel.locator('li[data-step="prior_history"]')).toContainText("UTC");
    await expectContained(page);
    await shot(page, testInfo, `e17-sequence-simulated-${lang}`);
    expect(writes).toEqual([]);
  });
}

test("refusals and outages are explicit: never 'would not trigger'", async ({ page, baseURL }) => {
  const writes = await setup(page, "en", baseURL);
  const replies = [
    { status: 403, json: { schema: SCHEMA, readOnly: true, verdict: "cannot_evaluate", reason: "plan_not_confirmed", requiredTier: "pro" } },
    { status: 500, json: { error: "dry_run_unavailable" } },
    { status: 200, body: "<html><body>Bad gateway</body></html>", contentType: "text/html" },
    // A contract-looking body that omits the clocks/condition a verdict needs is NOT a verdict.
    { status: 200, json: { schema: SCHEMA, readOnly: true, verdict: "not_met" } },
  ];
  let i = 0;
  await page.route("**/api/alerts/dry-run", async (route) => {
    const r = replies[i++];
    if ("json" in r) await route.fulfill({ status: r.status, json: r.json });
    else await route.fulfill({ status: r.status, body: r.body, contentType: r.contentType });
  });
  const panel = await openSuiteForm(page);
  const go = panel.getByTestId("alert-dry-run-go");

  await go.click();
  await expect(panel).toHaveAttribute("data-dry-run-verdict", "cannot_evaluate", { timeout: 15_000 });
  await expect(panel).toHaveAttribute("data-dry-run-reason", "plan_not_confirmed");
  await expect(panel.locator('[data-verdict="cannot_evaluate"]')).toContainText("Pro");
  await expect(panel.getByTestId("alert-dry-run-clocks")).toHaveCount(0);

  for (let k = 0; k < 3; k++) {
    await go.click();
    await expect(panel).toHaveAttribute("data-dry-run-state", "unavailable", { timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-dry-run-verdict", "");
    await expect(panel.locator('[data-verdict="unavailable"]')).toContainText("no verdict");
    await expect(panel).not.toContainText("Would not trigger");
  }
  expect(i).toBe(4);
  expect(writes).toEqual([]);
});

test("changing the condition cancels an in-flight run; Cancel leaves no verdict", async ({ page, baseURL }) => {
  const writes = await setup(page, "en", baseURL);
  const holds: Array<() => void> = [];
  await page.route("**/api/alerts/dry-run", async (route) => {
    await new Promise<void>((resolve) => holds.push(resolve));
    await route.fulfill({ json: WOULD }).catch(() => {}); // the browser may have aborted it
  });
  const panel = await openSuiteForm(page);
  const go = panel.getByTestId("alert-dry-run-go");

  await go.click();
  await expect(panel).toHaveAttribute("data-dry-run-state", "running");
  await expect.poll(() => holds.length, { timeout: 10_000 }).toBe(1);
  await page.locator('select[aria-label="Event"]').selectOption("choch");
  await expect(panel).toHaveAttribute("data-dry-run-state", "idle");
  holds[0]();
  // The late answer belongs to the OLD condition: it must never surface under the new one.
  for (let k = 0; k < 4; k++) {
    await page.waitForTimeout(250);
    await expect(panel).toHaveAttribute("data-dry-run-state", "idle");
    await expect(panel).toHaveAttribute("data-dry-run-verdict", "");
  }

  await go.click();
  await expect.poll(() => holds.length, { timeout: 10_000 }).toBe(2);
  await panel.getByTestId("alert-dry-run-cancel").click();
  await expect(panel).toHaveAttribute("data-dry-run-state", "cancelled");
  await expect(panel.locator('[data-verdict="cancelled"]')).toContainText("Dry run cancelled: no verdict.");
  holds[1]();
  await page.waitForTimeout(500);
  await expect(panel).toHaveAttribute("data-dry-run-state", "cancelled");
  await expect(panel).toHaveAttribute("data-dry-run-verdict", "");
  expect(writes).toEqual([]);
});

for (const lang of ["en", "zh"] as const) {
  test(`Cancel settles at once and a rerun gets its own verdict (${lang})`, async ({ page, baseURL }, testInfo) => {
    const writes = await setup(page, lang, baseURL);
    const holds: Array<() => void> = [];
    let posts = 0;
    await page.route("**/api/alerts/dry-run", async (route) => {
      posts += 1;
      // The first answer is held past Cancel and the rerun; only the rerun's own answer may show.
      if (posts === 1) await new Promise<void>((resolve) => holds.push(resolve));
      await route.fulfill({ json: WOULD }).catch(() => {}); // the browser may have aborted it
    });
    const panel = await openSuiteForm(page);
    const go = panel.getByTestId("alert-dry-run-go");

    await go.click();
    await expect.poll(() => holds.length, { timeout: 10_000 }).toBe(1);
    await panel.getByTestId("alert-dry-run-cancel").click();
    await expect(panel).toHaveAttribute("data-dry-run-state", "cancelled");
    await expect(panel.locator('[data-verdict="cancelled"]')).toContainText(
      lang === "en" ? "Dry run cancelled: no verdict." : "试运行已取消：没有结论。",
    );
    await expect(go).toBeEnabled();
    await expectContained(page);
    await shot(page, testInfo, `e17-cancelled-${lang}`);

    await go.click();
    await expect(panel).toHaveAttribute("data-dry-run-state", "result");
    await expect(panel).toHaveAttribute("data-dry-run-verdict", "would_trigger");
    holds[0]();
    await page.waitForTimeout(500);
    await expect(panel).toHaveAttribute("data-dry-run-state", "result");
    expect(posts).toBe(2);
    expect(writes).toEqual([]);
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`real handler: stale bars are cannot-evaluate with the availability clock (${lang})`, async ({ page, baseURL }, testInfo) => {
    const writes = await setup(page, lang, baseURL);
    const doc = JSON.parse(readFileSync("public/data/NVDA.json", "utf8")) as { bars: Array<[string, ...number[]]> };
    const last = doc.bars.at(-1)![0];
    const ageDays = Math.floor((Date.now() - Date.parse(`${last}T00:00:00Z`)) / 86_400_000);
    const panel = await openSuiteForm(page);
    const resp = page.waitForResponse((r) => r.url().endsWith("/api/alerts/dry-run") && r.request().method() === "POST");
    await panel.getByTestId("alert-dry-run-go").click();
    const r = await resp;
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("no-store");
    const body = await r.json();
    expect(body.readOnly).toBe(true);
    if (ageDays > 5) {
      expect(body).toMatchObject({ verdict: "cannot_evaluate", reason: "stale_data" });
      await expect(panel).toHaveAttribute("data-dry-run-reason", "stale_data", { timeout: 15_000 });
      await expect(panel.locator(`[data-dry-run-last-bar="${last}"]`)).toBeVisible();
      await expect(panel.locator('[data-verdict="cannot_evaluate"]')).toContainText(last);
      await expect(panel).not.toContainText(lang === "en" ? "Would not trigger" : "现在不会触发");
    } else {
      expect(["would_trigger", "not_met"]).toContain(body.verdict);
      await expect(panel).toHaveAttribute("data-dry-run-verdict", body.verdict, { timeout: 15_000 });
    }
    await expectContained(page);
    await shot(page, testInfo, `e17-real-handler-${lang}`);
    expect(writes).toEqual([]);
  });
}

test("real handler negatives: supplied state, other alert types and unsafe symbols", async ({ request }, testInfo) => {
  // A distinct client address per request keeps this spec clear of the handler's own
  // per-address limit (30/min), which the unit suite already proves.
  let n = 0;
  const ip = () => `10.17.${testInfo.project.name.length}.${++n + testInfo.retry * 20}`;
  const post = (data: unknown) => request.post("/api/alerts/dry-run", { data, headers: { "x-forwarded-for": ip() } });
  const base = { type: "suite_event", suite: "structure", event: "bos" };

  const se = await post({ symbol: "NVDA", condition: { ...base, _se: { t: 1 } } });
  expect(se.status()).toBe(200);
  expect(await se.json()).toMatchObject({ verdict: "unsupported", reason: "supplied_state", readOnly: true });

  const trig = await post({ symbol: "NVDA", condition: { ...base, triggered: { at: "2026-10-01" } } });
  expect(await trig.json()).toMatchObject({ verdict: "unsupported", reason: "supplied_state" });

  const price = await post({ symbol: "NVDA", condition: { type: "price", op: ">", value: 1 } });
  expect(await price.json()).toMatchObject({ verdict: "unsupported", reason: "unsupported_type" });

  for (const symbol of ["../NVDA", "NV/DA", "..", "nvda.json/.."]) {
    const bad = await post({ symbol, condition: base });
    expect(bad.status(), symbol).toBe(400);
    expect(await bad.json()).toMatchObject({ verdict: "cannot_evaluate", reason: "invalid_symbol" });
  }

  const missing = await post({ symbol: "E17NOFILE", condition: base });
  expect(await missing.json()).toMatchObject({ verdict: "cannot_evaluate", reason: "no_data" });

  const junk = await request.post("/api/alerts/dry-run", { data: "not json", headers: { "content-type": "text/plain", "x-forwarded-for": ip() } });
  expect(junk.status()).toBe(400);
});
