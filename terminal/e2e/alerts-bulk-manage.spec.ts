import { expect, test, type Page, type Route } from "@playwright/test";
import { expectTapTarget } from "./tapTarget";

/**
 * E18 — manage several alerts at once, from the user's side (issue #916).
 *
 * The page talks to a stateful fake of the one owner, `/api/alerts`: GET returns the store, PATCH
 * applies `{id, action}` to it and answers per a script. Every PATCH the browser sends is logged,
 * so each test can say exactly which writes left the page and what the store holds afterwards.
 *
 *   AC-E18-01  the captured selection is the target, with filters narrowed after selection
 *   AC-E18-02  a mixed batch counts each kind and shows every row's own result
 *   AC-E18-03  a not-confirmed write is never re-sent and never counted as paused
 *   AC-E18-04  a signed-out refusal stops every row not yet sent
 *   AC-E18-05  a refresh names deleted / changed rows and makes an open review unconfirmable
 *   AC-E18-06  readback: the store, the API and the existing alerts list show only the intended effects
 *              (pause AND resume / re-arm), and the touch controls meet the 44px floor
 */

test.setTimeout(90_000);

const ACT = { timeout: 20_000 } as const;

const MANIFEST = { symbols: { NVDA: { name: "NVIDIA", last: 182.5 }, SPY: { name: "SPDR S&P 500", last: 701.2 } } };

type Row = { id: string; symbol: string; active: boolean; created_at: string; condition: Record<string, unknown> };
type Script = "ack" | "landed-then-502" | "500" | "gone-404" | "401";

const row = (id: string, symbol: string, condition: Record<string, unknown>, active = true): Row =>
  ({ id, symbol, active, created_at: "2026-10-01T12:00:00Z", condition });

async function installOwner(page: Page, store: Map<string, Row>, script: (id: string) => Script = () => "ack") {
  const patches: Array<{ id: string; action: unknown }> = [];
  const gets = { n: 0 };
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/alerts/receipts**", (route) => route.fulfill({
    json: { run: null, runs_state: "READ_OK_ZERO", last_success_at: null, outbox: [], outbox_state: "READ_OK_ZERO" },
  }));
  await page.route("**/api/alerts**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname !== "/api/alerts") return route.fallback();
    if (req.method() === "GET") {
      gets.n++;
      return route.fulfill({ json: { alerts: [...store.values()].map((r) => structuredClone(r)) } });
    }
    if (req.method() !== "PATCH") return route.fulfill({ status: 405, json: { error: "unexpected" } });
    const body = req.postDataJSON() as { id: string; action: unknown };
    patches.push({ id: body.id, action: body.action });
    const apply = () => {
      const r = store.get(body.id);
      if (!r) return null;
      if (body.action === "pause") r.active = false;
      else { delete r.condition.triggered; r.active = true; }
      return structuredClone(r);
    };
    switch (script(body.id)) {
      case "401": return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
      case "gone-404": store.delete(body.id); return route.fulfill({ status: 404, json: { error: "not found" } });
      case "500": return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
      case "landed-then-502":
        apply();
        return route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>Bad gateway</body></html>" });
      default: {
        const after = apply();
        return after ? route.fulfill({ json: { alert: after } }) : route.fulfill({ status: 404, json: { error: "not found" } });
      }
    }
  });
  return { patches, gets };
}

async function setLang(page: Page, lang: "en" | "zh") {
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
}

const panel = (page: Page) => page.locator('[data-bulk-manager]');
const tick = (page: Page, id: string) => page.locator(`[data-bulk-row="${id}"] input[type="checkbox"]`);
const outcome = (page: Page, id: string) => page.locator(`[data-bulk-result-row="${id}"]`);

async function openManager(page: Page, expectRows: number) {
  await page.goto("/alerts");
  // The panel is server-rendered: on a cold dev server a click can land before hydration and be
  // lost, so click until it opens (the open state itself is still asserted).
  await expect(async () => {
    await page.locator("[data-bulk-open]").click({ timeout: 5_000 });
    await expect(panel(page)).toHaveAttribute("data-bulk-manager", "open", { timeout: 1_500 });
  }).toPass({ timeout: 45_000 });
  await expect(page.locator("[data-bulk-row]")).toHaveCount(expectRows, { timeout: 20_000 });
}

const COPY = {
  en: {
    summary: "1 paused · 1 refused · 2 not confirmed · 1 skipped of 5 selected",
    landed: "Not confirmed — latest saved state: Paused",
    notLanded: "Not confirmed — latest saved state: Armed",
    refused: "Refused — not found in your alerts",
  },
  zh: {
    summary: "已暂停 1 条 · 被拒绝 1 条 · 未获确认 2 条 · 跳过 1 条 共选 5 条",
    landed: "未获确认——最新保存的状态：已暂停",
    notLanded: "未获确认——最新保存的状态：已启用",
    refused: "被拒绝——在你的提醒中未找到",
  },
} as const;

test("a mixed batch: the captured set is the target, every row has its own result, nothing is re-sent", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const L = COPY[lang];
  await setLang(page, lang);
  const store = new Map<string, Row>([
    ["a1", row("a1", "NVDA", { type: "signal", target: "BUY" })],
    ["a2", row("a2", "AAPL", { type: "signal", target: "SELL" })],
    ["a3", row("a3", "TSLA", { type: "rsi", value: 30 })],
    ["a4", row("a4", "MSFT", { type: "regime" })],
    ["a5", row("a5", "AMD", { type: "signal", target: "BUY" }, false)],
    ["a6", row("a6", "SPY", { type: "signal", target: "BUY" })],   // never selected: must not move
  ]);
  const scripts: Record<string, Script> = { a1: "ack", a2: "landed-then-502", a3: "500", a4: "gone-404" };
  const owner = await installOwner(page, store, (id) => scripts[id] ?? "ack");

  await openManager(page, 6);
  for (const id of ["a1", "a2", "a3", "a4", "a5"]) await tick(page, id).check(ACT);
  await expect(page.locator("[data-bulk-selected]")).toHaveAttribute("data-bulk-selected", "5");

  // AC-01: narrow the view so four of the five selected rows are hidden, THEN review.
  await page.locator('[data-bulk-filter="symbol"]').fill("NV", ACT);
  await expect(page.locator("[data-bulk-row]")).toHaveCount(1);
  await page.locator('[data-bulk-review-open="pause"]').click(ACT);
  const review = page.locator('[data-bulk-review="pause"]');
  await expect(review.locator("[data-bulk-review-row]")).toHaveCount(5);
  await expect(review.locator('[data-bulk-review-group="apply"] [data-bulk-review-row]')).toHaveCount(4);
  await expect(review.locator('[data-bulk-review-group="skip-paused"] [data-bulk-review-row="a5"]')).toHaveCount(1);
  await expect(review.locator('[data-bulk-review-row="a6"]')).toHaveCount(0);
  // Selection is locked while reviewing; changing the filters again changes nothing.
  await page.locator('[data-bulk-filter="symbol"]').fill("SPY", ACT);
  await expect(tick(page, "a6")).toBeDisabled();
  await expect(review.locator("[data-bulk-review-row]")).toHaveCount(5);
  expect(owner.patches).toEqual([]);   // reviewing sends nothing

  await review.locator("[data-bulk-confirm]").click(ACT);
  const results = page.locator('[data-bulk-results="pause"]');
  await expect(results).toHaveAttribute("data-bulk-done", "1", { timeout: 20_000 });

  // AC-02: every kind is counted on its own and every row shows its own answer.
  await expect(results.locator("[data-bulk-summary]")).toHaveText(L.summary);
  await expect(results.locator("[data-bulk-summary]")).not.toContainText(/all|全部/i);
  await expect(outcome(page, "a1")).toHaveAttribute("data-bulk-outcome", "acknowledged");
  await expect(outcome(page, "a2")).toHaveAttribute("data-bulk-outcome", "unknown");
  await expect(outcome(page, "a3")).toHaveAttribute("data-bulk-outcome", "unknown");
  await expect(outcome(page, "a4")).toHaveAttribute("data-bulk-outcome", "refused");
  await expect(outcome(page, "a5")).toHaveAttribute("data-bulk-outcome", "skipped");
  await expect(outcome(page, "a4")).toContainText(L.refused);
  // AC-03: the write that landed behind a 502 is reported as an observation, not as a pause.
  await expect(outcome(page, "a2")).toContainText(L.landed);
  await expect(outcome(page, "a3")).toContainText(L.notLanded);

  // Exactly the captured writable ids left the page, each once, as pauses.
  const sent = () => owner.patches.map((p) => `${p.id}:${String(p.action)}`).sort();
  expect(sent()).toEqual(["a1:pause", "a2:pause", "a3:pause", "a4:pause"]);

  // "Check current state" is a read: it never sends a write.
  const getsBefore = owner.gets.n;
  await results.locator("[data-bulk-recheck]").click(ACT);
  await expect.poll(() => owner.gets.n).toBeGreaterThan(getsBefore);
  await expect(results.locator("[data-bulk-recheck]")).toBeEnabled();
  await page.waitForTimeout(500);
  expect(sent()).toEqual(["a1:pause", "a2:pause", "a3:pause", "a4:pause"]);

  // AC-06 readback — the store: only the intended rows moved; nothing else was touched.
  expect([...store.values()].map((r) => `${r.id}:${r.active ? "on" : "off"}`)).toEqual(
    ["a1:off", "a2:off", "a3:on", "a5:off", "a6:on"],
  );
  // — the API, as the page sees it:
  const api = await page.evaluate(async () => {
    const r = await fetch("/api/alerts", { cache: "no-store" });
    return ((await r.json()) as { alerts: Array<{ id: string; active: boolean }> }).alerts.map((a) => `${a.id}:${a.active ? "on" : "off"}`);
  });
  expect(api).toEqual(["a1:off", "a2:off", "a3:on", "a5:off", "a6:on"]);
  // — the existing alerts list re-read after the batch: MSFT is gone, NVDA is off, SPY is still on.
  const list = page.locator(".arow");
  await expect(list).toHaveCount(5);
  await expect(list.filter({ hasText: "NVDA" }).locator(".dot").first()).toHaveClass(/\boff\b/);
  await expect(list.filter({ hasText: "SPY" }).locator(".dot").first()).not.toHaveClass(/\boff\b/);
});

test("a refresh during selection names deleted and changed rows; a changed review cannot be confirmed", async ({ page }) => {
  await setLang(page, "en");
  const store = new Map<string, Row>([
    ["b1", row("b1", "NVDA", { type: "signal", target: "BUY" })],
    ["b2", row("b2", "AAPL", { type: "signal", target: "SELL" })],
    ["b3", row("b3", "TSLA", { type: "rsi", value: 30 })],
  ]);
  const owner = await installOwner(page, store);

  await openManager(page, 3);
  for (const id of ["b1", "b2", "b3"]) await tick(page, id).check(ACT);

  // Elsewhere: AAPL is deleted, TSLA fires.
  store.delete("b2");
  Object.assign(store.get("b3")!, { active: false, condition: { type: "rsi", value: 30, triggered: { at: "2026-10-11T14:00:00Z", value: 29 } } });
  await page.locator("[data-bulk-refresh]").click(ACT);

  const report = page.locator("[data-bulk-report]");
  await expect(report.locator('[data-bulk-deleted="b2"]')).toContainText("AAPL");
  await expect(report.locator('[data-bulk-deleted="b2"]')).toContainText("was deleted and left your selection");
  await expect(report.locator('[data-bulk-changed="b3"]')).toContainText("changed from Armed to Triggered");
  await expect(page.locator("[data-bulk-selected]")).toHaveAttribute("data-bulk-selected", "2");
  await expect(tick(page, "b1")).toBeChecked();
  await expect(tick(page, "b3")).toBeChecked();

  // Review, then NVDA is paused elsewhere while the review is open.
  await page.locator('[data-bulk-review-open="pause"]').click(ACT);
  const review = page.locator('[data-bulk-review="pause"]');
  await expect(review.locator('[data-bulk-review-group="apply"] [data-bulk-review-row="b1"]')).toHaveCount(1);
  await expect(review.locator('[data-bulk-review-group="skip-fired"] [data-bulk-review-row="b3"]')).toHaveCount(1);
  store.get("b1")!.active = false;
  await page.locator("[data-bulk-refresh]").click(ACT);
  await expect(review).toHaveAttribute("data-bulk-review-stale", "1");
  await expect(review.locator("[data-bulk-confirm]")).toBeDisabled();
  await expect(report.locator('[data-bulk-changed="b1"]')).toContainText("changed from Armed to Paused");

  // Reviewing again shows the truth: nothing left to pause, so nothing can be confirmed.
  await review.locator("[data-bulk-review-again]").click(ACT);
  await expect(review).toHaveAttribute("data-bulk-review-stale", "0");
  await expect(review.locator('[data-bulk-review-group="skip-paused"] [data-bulk-review-row="b1"]')).toHaveCount(1);
  await expect(review.locator("[data-bulk-confirm]")).toBeDisabled();
  await review.locator("[data-bulk-cancel]").click(ACT);
  await expect(review).toHaveCount(0);
  expect(owner.patches).toEqual([]);
});

test("a signed-out refusal stops the batch: unsent rows say so and are never sent", async ({ page }) => {
  await setLang(page, "en");
  const store = new Map<string, Row>(
    ["c1", "c2", "c3", "c4", "c5", "c6"].map((id, i) => [id, row(id, `T${i + 1}`, { type: "signal", target: "BUY" })]),
  );
  const owner = await installOwner(page, store, () => "401");

  await openManager(page, 6);
  await page.locator("[data-bulk-select-shown]").click(ACT);
  await expect(page.locator("[data-bulk-selected]")).toHaveAttribute("data-bulk-selected", "6");
  await page.locator('[data-bulk-review-open="pause"]').click(ACT);
  await page.locator("[data-bulk-confirm]").click(ACT);
  const results = page.locator('[data-bulk-results="pause"]');
  await expect(results).toHaveAttribute("data-bulk-done", "1", { timeout: 20_000 });

  const sentN = owner.patches.length;
  expect(sentN).toBeGreaterThanOrEqual(1);
  expect(sentN).toBeLessThanOrEqual(3);   // at most the in-flight window; the rest stopped
  await expect(results.locator('[data-bulk-outcome="refused"]')).toHaveCount(sentN);
  await expect(results.locator('[data-bulk-outcome="not-sent"]')).toHaveCount(6 - sentN);
  await expect(results.locator('[data-bulk-outcome="not-sent"]').first()).toContainText("Not sent — you are signed out");
  await expect(results.locator("[data-bulk-summary]")).toHaveText(`${sentN} refused · ${6 - sentN} not sent of 6 selected`);
  await expect(results.locator("[data-bulk-recheck]")).toHaveCount(0);   // nothing is unconfirmed
  await page.waitForTimeout(500);
  expect(owner.patches.length).toBe(sentN);
  expect([...store.values()].every((r) => r.active)).toBe(true);
});

test("resume: a paused row resumes, a triggered row re-arms with its trigger record cleared, an armed row is skipped", async ({ page }) => {
  await setLang(page, "en");
  const store = new Map<string, Row>([
    ["d1", row("d1", "NVDA", { type: "signal", target: "BUY" }, false)],                                          // paused
    ["d2", row("d2", "MSFT", { type: "regime", triggered: { at: "2026-10-10T14:00:00Z", value: 1 } }, false)],  // triggered
    ["d3", row("d3", "AAPL", { type: "signal", target: "SELL" })],                                               // armed
    ["d4", row("d4", "TSLA", { type: "rsi", value: 30 }, false)],                                                // paused, never selected
  ]);
  const owner = await installOwner(page, store);

  await openManager(page, 4);
  for (const id of ["d1", "d2", "d3"]) await tick(page, id).check(ACT);
  await page.locator('[data-bulk-review-open="resume"]').click(ACT);
  const review = page.locator('[data-bulk-review="resume"]');
  await expect(review.locator('[data-bulk-review-group="apply"] [data-bulk-review-row="d1"]')).toHaveCount(1);
  await expect(review.locator('[data-bulk-review-group="rearm"] [data-bulk-review-row="d2"]')).toHaveCount(1);
  await expect(review.locator('[data-bulk-review-group="skip-armed"] [data-bulk-review-row="d3"]')).toHaveCount(1);
  await expect(review.locator("[data-bulk-confirm]")).toHaveText("Resume 2");
  await review.locator("[data-bulk-confirm]").click(ACT);

  const results = page.locator('[data-bulk-results="resume"]');
  await expect(results).toHaveAttribute("data-bulk-done", "1", { timeout: 20_000 });
  await expect(results.locator("[data-bulk-summary]")).toHaveText("2 resumed · 1 skipped of 3 selected");
  await expect(outcome(page, "d1")).toContainText("Resumed");
  await expect(outcome(page, "d2")).toContainText("Re-armed");
  await expect(outcome(page, "d3")).toHaveAttribute("data-bulk-outcome", "skipped");
  expect(owner.patches.map((p) => `${p.id}:${String(p.action)}`).sort()).toEqual(["d1:resume", "d2:resume"]);

  // Readback: only the two intended rows moved; the trigger record is gone only where re-armed.
  expect([...store.values()].map((r) => `${r.id}:${r.active ? "on" : "off"}:${"triggered" in r.condition ? "T" : "-"}`)).toEqual(
    ["d1:on:-", "d2:on:-", "d3:on:-", "d4:off:-"],
  );
});

test("touch: the row, filter and action controls meet the 44px floor", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Tap-target floors are a coarse-pointer contract.");
  await setLang(page, "en");
  const store = new Map<string, Row>([
    ["e1", row("e1", "NVDA", { type: "signal", target: "BUY" })],
    ["e2", row("e2", "AAPL", { type: "signal", target: "SELL" })],
  ]);
  await installOwner(page, store);
  await openManager(page, 2);
  await expectTapTarget(page.locator('[data-bulk-row="e1"]'), { height: 44 });
  await expectTapTarget(page.locator('[data-bulk-filter="symbol"]'), { height: 44 });
  await expectTapTarget(page.locator("[data-bulk-select-shown]"), { height: 44 });
  await tick(page, "e1").check(ACT);
  await page.locator('[data-bulk-review-open="pause"]').click(ACT);
  await expectTapTarget(page.locator("[data-bulk-confirm]"), { height: 44 });
  await expectTapTarget(page.locator("[data-bulk-cancel]"), { height: 44 });
});
