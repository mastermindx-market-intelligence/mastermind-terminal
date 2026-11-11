import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isPhoneViewport } from "./phoneChrome";

/**
 * A Pine run waiting on a worker that never boots must say so — the four-state law applied to one
 * script: a run in flight is not "no plot", and an engine that failed to start is not the script's
 * result.
 *
 * host.ts retries a hung boot once, so a request can wait 2 × WORKER_BOOT_TIMEOUT_MS (~60s) before
 * it settles with "Pine engine failed to start". Before this fix the chart cleared the script's series
 * and rendered an active-looking legend row with no plot for that whole wait, then cached the start
 * failure as the script's result until the bars, timeframe or symbol changed; the editor kept the
 * previous buffer's clean console.
 *
 * The hang is real at the boundary the host sees: a Worker subclass installed before any page script
 * swallows every message and error from a worker constructed while `__pineHang` is set (its listeners
 * are registered in the constructor, ahead of the host's `onmessage`, and stop propagation), so the
 * host's own boot timer, its single boot retry and its start-failure settlement all run unmodified.
 * Only the boot timer's duration is compressed: the next 30s timer armed by a hung construction —
 * spawn() arms it synchronously after `new Worker` — is cut to BOOT_MS, so the two boot windows take
 * seconds instead of a minute. host.ts itself is untouched.
 */

const BOOT_MS = 3_000;              // stands in for WORKER_BOOT_TIMEOUT_MS (30s) — two windows ≈ 6s
const HOST_BOOT_TIMEOUT_MS = 30_000; // lib/pine-engine/host.ts WORKER_BOOT_TIMEOUT_MS

type HangWindow = Window & {
  __pineHang?: boolean;
  __pineSpawns?: number;
  __pineStates?: string[];
  __peStates?: string[];
  __mmChartOwnership?: () => { owned: { pine: number } };
};

const RUN_NONCE = `${process.env.TEST_WORKER_INDEX ?? "0"}${Math.random().toString(36).slice(2, 8)}`;

/** Own fixture store per test: the three viewport projects share one dev server. */
async function isolateScripts(page: Page, testInfo: TestInfo, baseURL?: string) {
  const key = `boot-${testInfo.project.name}-${testInfo.title}-${testInfo.retry}-${RUN_NONCE}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 90);
  await page.context().addCookies([{ name: "mm_e2e_scripts", value: key, url: baseURL ?? "http://127.0.0.1:3108" }]);
  return key;
}

async function installHang(page: Page) {
  await page.addInitScript(({ bootMs, hostBootMs }: { bootMs: number; hostBootMs: number }) => {
    const w = window as unknown as HangWindow;
    if (w.__pineSpawns !== undefined) return;
    w.__pineHang = true;
    w.__pineSpawns = 0;
    w.__pineStates = [];
    w.__peStates = [];
    let armBoot = false;

    const Native = window.Worker;
    class HungWorker extends Native {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        w.__pineSpawns = (w.__pineSpawns ?? 0) + 1;
        if (!w.__pineHang) return;
        armBoot = true;
        // Registered before the host assigns onmessage/onerror, so these run first and the host
        // never hears "ready", a run reply or a crash from this worker.
        const swallow = (e: Event) => e.stopImmediatePropagation();
        this.addEventListener("message", swallow);
        this.addEventListener("error", swallow);
      }
    }
    window.Worker = HungWorker as unknown as typeof Worker;

    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if (armBoot && ms === hostBootMs) { armBoot = false; ms = bootMs; }
      return nativeSetTimeout(fn, ms, ...rest);
    }) as typeof window.setTimeout;

    // Every distinct state the legend row / editor console passes through, in order.
    const record = () => {
      const row = document.querySelector("[data-pine-state]")?.getAttribute("data-pine-state") ?? "none";
      const rs = w.__pineStates!;
      if (rs[rs.length - 1] !== row) rs.push(row);
      const pe = document.querySelector("[data-pe-state]")?.getAttribute("data-pe-state") ?? "none";
      const ps = w.__peStates!;
      if (ps[ps.length - 1] !== pe) ps.push(pe);
    };
    const observe = () => new MutationObserver(record).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["data-pine-state", "data-pe-state"],
    });
    if (document.documentElement) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });

    try {
      localStorage.setItem("mm.lang", "en");
      localStorage.setItem("mm.startTf", JSON.stringify("D"));
    } catch { /* private mode */ }
  }, { bootMs: BOOT_MS, hostBootMs: HOST_BOOT_TIMEOUT_MS });
}

const probe = <K extends keyof HangWindow>(page: Page, k: K) =>
  page.evaluate((key) => (window as unknown as Record<string, unknown>)[key as string], k) as Promise<HangWindow[K]>;
const pineOwned = (page: Page) => page.evaluate(() => (window as unknown as HangWindow).__mmChartOwnership?.().owned.pine ?? null);

/** Subsequence check: `want` appears in `seen` in order (other states may sit between). */
function inOrder(seen: string[], want: string[]) {
  let i = 0;
  for (const s of seen) if (s === want[i]) i++;
  return i === want.length;
}

/** Make the legend rows visible (the phone collapses the legend list behind its chevron). */
async function showLegend(page: Page, row: ReturnType<Page["locator"]>) {
  await expect.poll(async () => {
    if (await row.isVisible()) return true;
    try { await page.locator(".lg-collapse").first().click({ timeout: 2_000 }); } catch { /* re-rendered mid-tap */ }
    return row.isVisible();
  }, { timeout: 20_000, intervals: [300, 600, 1000], message: "the legend never showed the script's row" }).toBe(true);
}

/** Remove a built-in SUB-PANE study from its legend row. That re-seats Pine panes and calls
 *  buildAllPine on the SAME bars — the background rebuild that used to restart a failed boot. */
async function removeBuiltinSubPane(page: Page) {
  const row = page.locator(".lg-row", { has: page.locator(".lg-name", { hasText: /stoch/i }) }).first();
  await showLegend(page, row);
  const remove = row.getByRole("button", { name: "Remove", exact: true });
  await expect.poll(async () => {
    if (!(await row.isVisible())) return true;
    try {
      if (!(await remove.isVisible())) await row.hover({ timeout: 2_000 });
      if (!(await remove.isVisible())) await row.locator(".lg-name").click({ timeout: 2_000 });
      if (await remove.isVisible()) await remove.click({ timeout: 2_000 });
    } catch { /* the legend re-rendered mid-gesture; the next attempt retries */ }
    return !(await row.isVisible());
  }, { timeout: 20_000, intervals: [300, 600, 1000], message: "could not remove the Stochastic study" }).toBe(true);
}

test.describe("Pine engine boot — honest pending, failed and retry states", () => {
  test("legend row: running → waiting → failed, pinned, then Retry plots without a symbol change", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const key = await isolateScripts(page, testInfo, baseURL);
    const id = `${key}-mine`;
    await installHang(page);

    await page.goto(`/terminal?symbol=NVDA&addScript=${encodeURIComponent(id)}`);
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });

    const state = page.locator("[data-pine-state]").first();
    // ── Pending, then the truthful start failure — never a bare row with no plot ──────────────
    await expect(state).toHaveAttribute("data-pine-state", "engineFail", { timeout: 45_000 });
    const seen = (await probe(page, "__pineStates")) ?? [];
    expect(inOrder(seen, ["running", "engineWait", "engineFail"]), `legend states seen: ${seen.join(" → ")}`).toBe(true);
    expect(await probe(page, "__pineSpawns"), "the host's own boot retry ran: two hung workers").toBeGreaterThanOrEqual(2);
    expect(await pineOwned(page), "a failed start paints nothing").toBe(0);
    const row = page.locator(".lg-row", { has: state });
    await expect(row.locator(".lg-name")).toContainText("My Momentum");
    await expect(state).toHaveText("Engine failed to start");
    const retry = row.locator("[data-pine-retry]");
    await expect(retry).toHaveCount(1);
    await expect(retry).toHaveText("Retry");
    await showLegend(page, row);
    await page.screenshot({ path: testInfo.outputPath("legend-failed.png") });
    // The failed row (name + state + Retry, the widest a legend row gets) stays clear of the price
    // scale — on a 390px phone the 46ch row cap alone ran its Retry under the last-price label.
    // Measured as rendered AND with a name long enough to hit the name's own width cap (swapped in
    // and restored inside one synchronous layout read), so a short fixture name cannot hide it.
    const geom = await row.evaluate((el) => {
      const axis = document.querySelector(".chart-wrap table tr")?.lastElementChild;
      const name = el.querySelector(".lg-name");
      if (!axis || !name) return null;
      const rendered = el.getBoundingClientRect().right;
      const was = name.textContent;
      name.textContent = "Institutional Momentum Oscillator With A Long Name";
      const worst = el.getBoundingClientRect().right;
      name.textContent = was;
      return {
        rendered, worst,
        axisLeft: axis.getBoundingClientRect().left,
        docWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      };
    });
    expect(geom, "the chart's price scale cell and the row's name").not.toBeNull();
    expect(geom!.rendered, "failed row runs under the price scale").toBeLessThanOrEqual(geom!.axisLeft - 4);
    expect(geom!.worst, "failed row with a long name runs under the price scale").toBeLessThanOrEqual(geom!.axisLeft - 4);
    expect(geom!.docWidth, "no horizontal document overflow").toBeLessThanOrEqual(geom!.viewport);

    // ── Pinned: a same-bars background rebuild must not restart the failed boot ─────────────
    const spawnsAtFail = await probe(page, "__pineSpawns");
    await removeBuiltinSubPane(page);
    await page.waitForTimeout(1_500);   // > PINE_PENDING_GRACE_MS: an unpinned re-run would already show "running"
    expect(await probe(page, "__pineSpawns"), "a background rebuild re-ran the failed request").toBe(spawnsAtFail);
    await expect(state).toHaveAttribute("data-pine-state", "engineFail");

    // ── Retry on the same symbol, timeframe and bars, with the engine healthy again ────────────
    await page.evaluate(() => { (window as unknown as HangWindow).__pineHang = false; });
    await showLegend(page, row);
    await retry.click({ timeout: 10_000 });
    await expect(page.locator("[data-pine-state]")).toHaveCount(0, { timeout: 45_000 });
    await expect.poll(() => pineOwned(page), { timeout: 20_000, message: "Retry should paint the script" }).toBeGreaterThan(0);
    expect(await probe(page, "__pineSpawns"), "Retry starts a fresh worker").toBe((spawnsAtFail ?? 0) + 1);
    expect(page.url(), "no symbol change was needed").toContain("symbol=NVDA");

    await page.screenshot({ path: testInfo.outputPath("legend-retried.png") });
  });

  test("editor console: checking → engine unavailable (unchecked), then Retry check", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const key = await isolateScripts(page, testInfo, baseURL);
    const id = `${key}-mine`;
    await installHang(page);

    await page.goto(`/scripts?id=${encodeURIComponent(id)}`);
    const editor = page.locator(".editor textarea");
    await expect(editor).toHaveValue(/plot\(close\)/, { timeout: 60_000 });

    const pe = page.locator(".console [data-pe-state]");
    await expect(pe).toHaveAttribute("data-pe-state", "engine-unavailable", { timeout: 45_000 });
    const seen = (await probe(page, "__peStates")) ?? [];
    expect(inOrder(seen, ["checking", "engine-unavailable"]), `editor states seen: ${seen.join(" → ")}`).toBe(true);
    await expect(pe).toContainText("Script engine unavailable — this script has not been checked");
    // The engine being down does not block the user's workflow.
    await expect(page.getByRole("button", { name: "Add to chart", exact: true })).toBeEnabled();

    await page.evaluate(() => { (window as unknown as HangWindow).__pineHang = false; });
    await pe.getByRole("button", { name: "Retry check", exact: true }).click({ timeout: 10_000 });
    await expect(page.locator(".console [data-pe-state]")).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator(".console")).not.toContainText("Script engine unavailable");
    if (!isPhoneViewport(page)) await page.screenshot({ path: testInfo.outputPath("editor-rechecked.png") });
  });
});
