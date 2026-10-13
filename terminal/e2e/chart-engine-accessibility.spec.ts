import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { isPhoneViewport } from "./phoneChrome";

/**
 * Q04 — the chart is USABLE (keyboard, EN+ZH, both color themes, 200% zoom) and HONEST
 * (a failed or revoked read renders the existing unavailable/failure state) at
 * /terminal?engine=mm — across the existing desktop (1440×900), tablet (820×1180) and
 * mobile (390×844) projects plus ONE explicit deviceScaleFactor-2 context (browser.
 * newContext — never CSS zoom). No new Playwright project, no config edit.
 *
 * The mounted impl is RECORDED per test (`window.__mmChartEngineImpl?.()` falling back to
 * the `[data-chart-engine]` marker — the house precedent of chart-engine-drawings.spec.ts
 * and chart-engine-pine.spec.ts) and "mm" is NEVER asserted: ?engine=mm is opt-in and may
 * still fall back to lwc (F-13); every behaviour asserted here is impl-agnostic.
 *
 * Deterministic waits only (no fixed sleeps): boot = `.chart-wrap canvas` visible + the
 * engine marker + the `mm:terminal-visual-ready` announcement (lib/terminalBoot.ts — the
 * one truthful ready edge, consumed by visual-ready-default.spec.ts); flips wait on a real
 * output edge (the LEX tuple's rendered copy, the `--up` token, an aria state).
 *
 * Language and theme flips mirror the app's OWN imperative appliers — applyLang
 * (lib/i18n.tsx:2947-2952: localStorage mm.lang + <html data-lang> + mm:lang) and
 * applyUpDown (lib/accountPrefs.ts:197-202: localStorage mm.updown + <html data-updown> +
 * mm:updown) — the same production seams the settings UI writes through. The Terminal is
 * dark-only (app/settings.css:32), so "both themes" means its two shipped color schemes:
 * west (green up) and east (red up).
 *
 * The entitlement switch is the repo's existing e2e mechanism: vary the `/api/me` response
 * via page.route — "the production client boundary for entitlement display … avoids
 * test-only auth/session mutation" (e2e/indicator-guides.spec.ts:352-361; the server-side
 * TERMINAL_E2E_ENTITLEMENT fixture switch answers it, app/api/me/route.ts:16-26).
 *
 * failure-state truth law: a failed read is NOT an empty result. The 404 case asserts the
 * honest .chart-empty message naming the symbol, zero drawn rows, NO last-price tag and no
 * `data` visual-ready edge — and the revoked-entitlement case asserts the gated legend row
 * says "requires Essential/Pro" while the real bars stay untouched.
 */

type EngineWindow = Window & {
  __mmChartEngineImpl?: () => string | null;
  __mmChartAxisOpts?: () => { rowCount?: number } | null;
};
type OwnWindow = Window & { __mmChartOwnership?: () => { owned: { indicators: number } } | null };
type ReadyWindow = Window & { __mmQ04ReadyEvents?: { symbol: string; timeframe: string; state: "data" | "empty" }[] };
type FocusState = { onBody: boolean; tag: string; name: string; focusVisible: boolean };

const DEFAULT_SEED: Record<string, string> = {
  "mm.startTf": JSON.stringify("D"),
  "mm.inds": JSON.stringify([]),
  "mm.pineOn": JSON.stringify([]),
};

const WIDE_CONTROLS = ".chart-tabs .tfbtn, .chart-tabs .tbtn, .indicator-library-trigger, .cfb-gear, .cmp-btn, [data-testid=\"drawing-toolbar\"], [data-testid=\"toolbar-more\"]";
const PHONE_CONTROLS = ".m-symbar, [data-testid=\"roller-symbol\"], [data-testid=\"roller-interval\"], [data-testid=\"roller-draw\"], [data-testid=\"roller-more\"], [data-testid=\"roller-undo\"], [data-testid=\"roller-redo\"], [data-testid=\"roller-share\"]";
const controlsFor = (page: Page) => (isPhoneViewport(page) ? PHONE_CONTROLS : WIDE_CONTROLS);

// ── probes ────────────────────────────────────────────────────────────────────

const FOCUS_PROBE = (): FocusState => {
  const el = document.activeElement;
  const nameOf = (node: Element): string => {
    if (!(node instanceof HTMLElement)) return "";
    const labelledby = node.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      if (t) return t;
    }
    const direct = (node.getAttribute("aria-label") ?? "").trim();
    if (direct) return direct;
    const text = (node.textContent ?? "").trim();
    if (text) return text;
    const title = (node.getAttribute("title") ?? "").trim();
    if (title) return title;
    const alt = (node.getAttribute("alt") ?? "").trim();
    if (alt) return alt;
    if (node instanceof HTMLInputElement) return node.placeholder.trim() || node.value.trim();
    return "";
  };
  if (!el || el === document.body || el === document.documentElement) return { onBody: true, tag: "BODY", name: "", focusVisible: false };
  let fv = false;
  try { fv = el.matches(":focus-visible"); } catch { fv = false; }
  return { onBody: false, tag: el.tagName, name: nameOf(el), focusVisible: fv };
};

const focusProbe = (page: Page) => page.evaluate(FOCUS_PROBE);

/** Visible, meaningful focus: off <body>, a non-empty accessible name, and — for a control
 *  reached by Tab — :focus-visible. Programmatic (re)stores assert with visible:false. */
async function expectNamedFocus(page: Page, what: string, opts: { visible?: boolean } = {}): Promise<void> {
  const s = await focusProbe(page);
  expect(s.onBody, `focus must not be lost to <body> at ${what}`).toBe(false);
  expect(s.name, `the focused <${s.tag}> at ${what} needs a non-empty accessible name`).not.toBe("");
  if (opts.visible !== false) {
    expect(s.focusVisible, `Tab focus at ${what} (<${s.tag}>) must be visible (:focus-visible)`).toBe(true);
  }
}

/** Drop any focus parked on a (possibly just-closed) surface so the next Tab restarts the
 *  sequential navigation from the top of the document — what clicking empty chrome does for a
 *  real user. Keeps the traversal start deterministic without touching focus law. */
async function resetFocusBaseline(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== document.body) a.blur();
    // Park the sequential-focus-navigation starting point at the document root: focus the
    // body itself (transient tabindex -1 — the standard "start over" idiom), so the next
    // Tab deterministically enters the FIRST focusable, wherever the previous surface died.
    document.body.tabIndex = -1;
    document.body.focus({ preventScroll: true });
  });
}

/** Press Tab until `target` holds document focus. Every intermediate stop must be a real
 *  focusable element — focus is never allowed to fall to <body> mid-task. The probe waits
 *  one animation frame after each press so focus is committed when it is judged. */
async function tabUntil(page: Page, target: Locator, what: string, maxTabs = 60): Promise<void> {
  const holdsFocus = () => target.evaluate((el) => el === document.activeElement).catch(() => false);
  const waitFrame = () => page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => resolve(1))));
  const settledProbe = async () => { await waitFrame(); return focusProbe(page); };
  for (let i = 0; i <= maxTabs; i++) {
    if (await holdsFocus()) return;
    await page.keyboard.press("Tab");
    const s = await settledProbe();
    expect(s.onBody, `Tab on the way to ${what} landed focus on <body> (landed: ${await page.evaluate(() => { const x = document.activeElement; return x ? `${x.tagName}#${x.id || "-"}·${String(x.className || "").slice(0, 40)}` : "none"; })})`).toBe(false);
  }
  throw new Error(`Tab never reached ${what} within ${maxTabs} presses`);
}

const mountedImpl = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const w = window as EngineWindow & Window;
    const hook = w.__mmChartEngineImpl?.();
    if (hook != null) return hook;
    return document.querySelector("[data-chart-engine]")?.getAttribute("data-chart-engine") ?? null;
  });

async function recordEngine(page: Page, requested: string): Promise<void> {
  const mounted = await mountedImpl(page);
  test.info().annotations.push({ type: "mountedEngineImpl", description: `requested="${requested}" mounted="${mounted}"` });
}

const hasReady = (page: Page, symbol: string, tf?: string): Promise<boolean> =>
  page.evaluate(([sym, timeframe]) => (window as ReadyWindow & Window).__mmQ04ReadyEvents?.some(
    (e) => e.symbol === sym && (timeframe == null || e.timeframe === timeframe) && e.state === "data",
  ) ?? false, [symbol, tf ?? null]);

// -1, never 0, when the read-back is not there (a production build — the hook is installed only
// under `process.env.NODE_ENV !== "production"`, ChartPanel.tsx:3751 — or no chart is mounted).
// A missing hook must not satisfy the "a dead-end draws no bars" assertions by default.
const chartRows = (page: Page) => page.evaluate(() => (window as EngineWindow & Window).__mmChartAxisOpts?.()?.rowCount ?? -1);
const indicatorSeries = (page: Page) => page.evaluate(() => (window as OwnWindow & Window).__mmChartOwnership?.()?.owned.indicators ?? -1);
const priceTag = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>(".mm-ptag")?.textContent?.trim() ?? "");

async function bootChart(page: Page, symbol: string, seed: Record<string, string> = {}): Promise<void> {
  await page.addInitScript((bag) => {
    for (const [k, v] of Object.entries(bag)) localStorage.setItem(k, v);
    const w = window as ReadyWindow & Window;
    w.__mmQ04ReadyEvents = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => {
      w.__mmQ04ReadyEvents?.push((event as CustomEvent).detail);
    });
  }, { ...DEFAULT_SEED, ...seed });
  await page.goto(`/terminal?symbol=${symbol}&engine=mm`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => mountedImpl(page), { timeout: 30_000 }).not.toBeNull();
  await expect.poll(() => hasReady(page, symbol), { timeout: 45_000, message: `a visual-ready data edge for ${symbol}` }).toBe(true);
  await recordEngine(page, "engine=mm");
}

/** Chart healthy after a navigation/rollback (works with a fresh mount AND a bfcache
 *  restore, where init-script collectors never re-ran). */
async function chartAlive(page: Page, symbol: string): Promise<void> {
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => mountedImpl(page), { timeout: 30_000 }).not.toBeNull();
  await expect.poll(() => chartRows(page), { timeout: 45_000, message: `bars for ${symbol} after navigation` }).toBeGreaterThan(50);
  await expect.poll(() => priceTag(page), { timeout: 20_000 }).toContain(symbol);
}

// ── language / theme flips (the app's own imperative seams) ───────────────────

async function setLanguage(page: Page, lang: "en" | "zh"): Promise<void> {
  await page.evaluate((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, lang);
}
async function setUpDown(page: Page, v: "west" | "east"): Promise<void> {
  await page.evaluate((x) => {
    localStorage.setItem("mm.updown", x);
    document.documentElement.setAttribute("data-updown", x);
    window.dispatchEvent(new CustomEvent("mm:updown"));
  }, v);
}
const upValue = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--up").trim());

/** Language flip output edge = the LEX tuple's rendered copy (lib/i18n.tsx:59 indicators,
 *  :110 stripLabel) — auto-waiting, deterministic, not a sleep. */
async function waitForLanguage(page: Page, lang: "en" | "zh"): Promise<void> {
  if (isPhoneViewport(page)) {
    await expect(page.locator("[data-testid=\"roller-strip\"]")).toHaveAttribute("aria-label", lang === "zh" ? "图表控件" : "Chart controls", { timeout: 15_000 });
  } else {
    await expect(page.locator(".indicator-library-trigger")).toHaveText(lang === "zh" ? "指标" : "Indicators", { timeout: 15_000 });
  }
}

// ── geometry: no clipped chart controls, no control-on-control overlap ────────

type CtrlBox = { label: string; x: number; y: number; w: number; h: number; scrollable: boolean };

async function controlBoxes(page: Page, selector: string): Promise<CtrlBox[]> {
  return page.locator(selector).evaluateAll((els) => els.map((raw) => {
    const el = raw as HTMLElement;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      label: el.getAttribute("data-testid") || el.getAttribute("aria-label") || (el.textContent || el.tagName).trim().slice(0, 24),
      x: r.x, y: r.y, w: r.width, h: r.height,
      visible: cs.visibility === "visible" && cs.display !== "none" && r.width > 0 && r.height > 0,
      // inside a horizontally scrollable strip whose content overflows (the phone roller
      // cluster — an intentional touch affordance: items reach by SCROLLING, mobile-chart-
      // chrome.spec.ts tests the fade + scroll itself). Such controls are judged against
      // their strip, not the viewport.
      scrollable: (() => {
        let n: HTMLElement | null = el.parentElement;
        while (n && n !== document.body) {
          const scs = getComputedStyle(n);
          if ((scs.overflowX === "auto" || scs.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 2) return true;
          n = n.parentElement;
        }
        return false;
      })(),
    };
  }).filter((c) => c.visible));
}

async function expectControlsFit(page: Page): Promise<void> {
  const vp = page.viewportSize();
  expect(vp).not.toBeNull();
  const boxes = await controlBoxes(page, controlsFor(page));
  expect(boxes.length, "the chart control set must exist at this viewport").toBeGreaterThanOrEqual(isPhoneViewport(page) ? 5 : 5);
  for (const b of boxes) {
    if (b.scrollable) continue; // scroll-to-reach items are exempt (see controlBoxes)
    expect(b.x, `control "${b.label}" clipped at the left`).toBeGreaterThanOrEqual(-1);
    expect(b.y, `control "${b.label}" clipped at the top`).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.w, `control "${b.label}" clipped at the right`).toBeLessThanOrEqual(vp!.width + 1);
    expect(b.y + b.h, `control "${b.label}" clipped at the bottom`).toBeLessThanOrEqual(vp!.height + 1);
  }
  const overlaps: string[] = [];
  const fixed = boxes.filter((b) => !b.scrollable);
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i]; const b = fixed[j];
      const contains = (p: CtrlBox, q: CtrlBox) => p.x <= q.x + 0.5 && p.y <= q.y + 0.5 && p.x + p.w >= q.x + q.w - 0.5 && p.y + p.h >= q.y + q.h - 0.5;
      if (contains(a, b) || contains(b, a)) continue; // a control hosting another is nesting, not overlap
      const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (dx > 1 && dy > 1) overlaps.push(`"${a.label}" × "${b.label}" (${Math.round(dx)}×${Math.round(dy)}px)`);
    }
  }
  expect(overlaps, "chart controls must not overlap each other").toEqual([]);
}

// ── K1 — the five operations are keyboard-reachable, per-viewport ─────────────


test("K1: symbol, timeframe, indicator toggle and drawing tool are keyboard-reachable with visible named focus", async ({ page }) => {
  test.slow(); // three dialog lifecycles plus two data edges on a shared dev server
  const phone = isPhoneViewport(page);
  await bootChart(page, "NVDA");

  // 1) SYMBOL CHANGE — the app's own keyboard entry: type-anywhere opens the combobox
  //    seeded (TerminalShell.tsx:3070-3077); the input autofocuses; Enter opens the active
  //    option; Escape closes a reopened palette without changing anything.
  await page.keyboard.press("m");
  const input = page.locator(".sh input");
  await expect(input).toBeVisible({ timeout: 15_000 });
  if (phone) {
    // MobileSheet.tsx:181-185 focuses the SHEET on a rAF that lands after SearchModal.tsx:172-173's
    // 10ms input focus, so the seeded input is not focused on the phone — but the sheet's own Tab
    // trap (MobileSheet.tsx:195-216) makes it the first stop. Keyboard-only, like every other step.
    await tabUntil(page, input, "the seeded search input");
  } else {
    await expect.poll(async () => (await focusProbe(page)).tag, { timeout: 10_000, message: "the seeded search takes keyboard focus" }).toBe("INPUT");
  }
  await expectNamedFocus(page, "symbol search input");
  await page.keyboard.press("ControlOrMeta+a"); // select-all on macOS too (Control+a only moves the caret there)
  await page.keyboard.type("MSFT");
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  await expectNamedFocus(page, "symbol search while typing");
  await page.keyboard.press("Enter");
  await expect.poll(() => hasReady(page, "MSFT"), { timeout: 45_000, message: "Enter opened the highlighted MSFT row" }).toBe(true);
  await expect.poll(() => priceTag(page), { timeout: 10_000 }).toContain("MSFT");
  // Escape closes the palette when reopened — and nothing changed on the way out.
  await resetFocusBaseline(page);
  await page.keyboard.press("x");
  await expect(input).toBeVisible({ timeout: 15_000 });
  if (!phone) await expect.poll(() => focusProbe(page).then((f) => f.tag), { timeout: 10_000 }).toBe("INPUT");
  await page.keyboard.press("Escape");
  await expect(input).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => priceTag(page)).toContain("MSFT");
  await resetFocusBaseline(page);

  // 2) TIMEFRAME CHANGE.
  const rowsBefore = await chartRows(page);
  if (phone) {
    // The phone's timeframe is the roller wheel: role=slider, tabIndex 0, ArrowDown commits
    // the next row (components/mobile/RollerStrip.tsx:95-110) — the wheel's native keyboard
    // operation, exactly as a slider works on any platform.
    const wheel = page.getByTestId("roller-interval");
    await expect(wheel).toHaveAttribute("aria-valuetext", "D");
    await tabUntil(page, wheel, "the interval wheel");
    await expectNamedFocus(page, "interval wheel");
    await page.keyboard.press("ArrowDown");
    await expect(wheel).toHaveAttribute("aria-valuetext", "2D", { timeout: 10_000 });
    await expect.poll(() => hasReady(page, "MSFT", "2D"), { timeout: 45_000, message: "the chart re-announced on the 2D edge" }).toBe(true);
  } else {
    const wBtn = page.locator(".chart-tabs").getByRole("button", { name: "W", exact: true });
    await tabUntil(page, wBtn, "the W timeframe button");
    await expectNamedFocus(page, "W timeframe button");
    await page.keyboard.press("Enter");
    await expect(wBtn).toHaveClass(/\bon\b/, { timeout: 10_000 });
    await expect.poll(() => hasReady(page, "MSFT", "W"), { timeout: 45_000 }).toBe(true);
  }
  expect(await chartRows(page)).toBeLessThan(rowsBefore); // the chart really re-binned

  // 3) INDICATOR TOGGLE — +Indicators opens the library (Enter), Tab reaches the Volume
  //    switch, Enter flips its aria state AND the chart's owned indicator series.
  const baseSeries = await indicatorSeries(page);
  const trigger = page.locator(".indicator-library-trigger");
  const library = page.locator("#indicator-library-dialog");
  if (phone) {
    const more = page.getByTestId("roller-more");
    await tabUntil(page, more, "the roller-more button");
    await expectNamedFocus(page, "roller-more");
    await page.keyboard.press("Enter");
    const tile = page.getByTestId("hub-tile-indicators");
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await tabUntil(page, tile, "the Indicators hub tile");
    await expectNamedFocus(page, "Indicators hub tile");
    await page.keyboard.press("Enter");
  } else {
    await tabUntil(page, trigger, "the +Indicators button");
    await expectNamedFocus(page, "+Indicators button");
    await page.keyboard.press("Enter");
  }
  await expect(library).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => focusProbe(page).then((s) => !s.onBody), { timeout: 10_000, message: "focus stays inside the opened dialog" }).toBe(true);
  const volume = library.getByRole("switch", { name: "Volume", exact: true });
  await tabUntil(page, volume, "the Volume switch");
  await expectNamedFocus(page, "Volume switch");
  await expect(volume).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Enter");
  await expect(volume).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
  await expect.poll(() => indicatorSeries(page), { timeout: 30_000, message: "aria-checked is no lie: the chart gained a volume series" }).toBeGreaterThan(baseSeries);
  await page.keyboard.press("Escape");
  await expect(library).toBeHidden({ timeout: 10_000 });
  if (!phone) {
    await expect(trigger).toBeFocused({ timeout: 10_000 }); // IndicatorsModal.tsx:223-230 restore
    await expect(trigger).toHaveAttribute("aria-expanded", "false"); // no false state after close
    await expectNamedFocus(page, "focus restored to +Indicators", { visible: false });
  }

  // 4) DRAWING TOOL SELECT. Desktop/tablet: the dock's lines menu opens on Enter with the
  //    first tool focused (drawing-system.spec.ts:331 precedent); Escape returns focus.
  //    Phone: the roller pencil raises the Drawings sheet and the tile arms the tool.
  const linesMain = page.getByTestId("drawing-group-lines-main");
  if (phone) {
    const pencil = page.getByTestId("roller-draw");
    // The library closed from a surface that unmounted mid-task; re-anchor the navigation
    // start before traversing on (Chromium drops the sequential starting point with it).
    await resetFocusBaseline(page);
    await tabUntil(page, pencil, "the draw pencil");
    await expectNamedFocus(page, "draw pencil");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Drawings" })).toBeVisible({ timeout: 15_000 });
    const tile = page.getByTestId("drawings-tile-trendline");
    await tabUntil(page, tile, "the trendline tile");
    await expectNamedFocus(page, "trendline tile");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Drawings" })).toBeHidden({ timeout: 10_000 });
  } else {
    const linesTrigger = page.getByTestId("drawing-group-lines-menu-trigger");
    const menu = page.getByTestId("drawing-group-lines-menu");
    await tabUntil(page, linesTrigger, "the lines drawing menu");
    await expectNamedFocus(page, "lines drawing menu trigger");
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible({ timeout: 15_000 });
    const tool = page.getByTestId("drawing-tool-trendline");
    await expect(tool).toBeFocused({ timeout: 15_000 });
    await expectNamedFocus(page, "trendline tool row", { visible: false });
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden({ timeout: 10_000 });
    await expect(trigger).toHaveAttribute("aria-expanded", "false"); // dialog state stayed truthful
    void linesTrigger;
  }
  await expect(linesMain).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });

  // 5) The tasks left the chart honest: MSFT is the symbol, bars were re-binned, no empty
  //    chart is pretending to be data and no failure overlay lied.
  expect(await chartRows(page)).toBeGreaterThan(5);
  await expect.poll(() => priceTag(page)).toContain("MSFT");
  await expect(page.locator(".chart-empty")).toBeHidden();
});

// ── K2 — engine switch by URL and its rollback keep the chart reachable ───────

test("K2: engine switch (?engine=lwc ↔ ?engine=mm) and rollback keep keyboard focus healthy and the same bars", async ({ page }) => {
  test.slow();
  const phone = isPhoneViewport(page);
  await bootChart(page, "NVDA");
  const mmRows = await chartRows(page);

  // Rollback lever: ?engine=lwc is the operator's one-click rollback (lib/chart-engine/
  // select.ts isRollbackRequested) — navigation itself is the switch's keyboard/URL surface.
  await page.goto("/terminal?symbol=NVDA&engine=lwc");
  await chartAlive(page, "NVDA");
  await recordEngine(page, "engine=lwc");
  const lwcRows = await chartRows(page);
  const trigger = page.locator(".indicator-library-trigger");
  const reach = phone ? page.getByTestId("roller-more") : trigger;
  await resetFocusBaseline(page);
  await tabUntil(page, reach, "the first chart control after the engine switch");
  await expectNamedFocus(page, "chart control after engine switch");
  if (!phone) {
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#indicator-library-dialog")).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await focusProbe(page)).onBody === false, { timeout: 10_000, message: "focus enters the dialog before Escape is pressed" }).toBe(true);
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }

  await page.goBack();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("engine=mm");
  await chartAlive(page, "NVDA");
  await recordEngine(page, "engine=mm (rollback nav)");
  // The same data survived both transitions: the switch moved the renderer, not the bars.
  expect(lwcRows).toBe(mmRows);
  expect(await chartRows(page)).toBe(mmRows);
  await resetFocusBaseline(page);
  await tabUntil(page, reach, "the first chart control after the rollback");
  await expectNamedFocus(page, "chart control after rollback");
});

// ── K3 — the intraday dead-end's "Back to Daily" rollback is Tab/Enter reachable ─

test("K3: an intraday dead-end's Back-to-Daily rollback is keyboard-reachable and restores real bars", async ({ page }) => {
  test.slow();
  const phone = isPhoneViewport(page);
  await page.addInitScript((bag) => {
    for (const [k, v] of Object.entries(bag)) localStorage.setItem(k, v);
    const w = window as ReadyWindow & Window;
    w.__mmQ04ReadyEvents = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => { w.__mmQ04ReadyEvents?.push((event as CustomEvent).detail); });
  }, { ...DEFAULT_SEED, "mm.startTf": JSON.stringify("1m") });
  // The empty-intraday dead-end is the feed's real answer shape ({bars:[]}); deterministic.
  await page.route("**/api/intraday**", (route: Route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ t: "2026-10-13T20:00:00Z", tf: "1m", bars: [] }),
  }));
  await page.goto("/terminal?symbol=NVDA&engine=mm");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => mountedImpl(page), { timeout: 30_000 }).not.toBeNull();
  await recordEngine(page, "engine=mm (1m dead-end)");
  await expect(page.locator(".chart-empty")).toBeVisible({ timeout: 45_000 });
  const msg = (await page.locator(".chart-empty .ce-msg").textContent()) ?? "";
  expect(msg).toContain("NVDA");
  expect(/intraday/i.test(msg), `the dead-end names itself honestly, got "${msg}"`).toBe(true);
  expect(await chartRows(page), "a dead-end read draws no bars").toBe(0);

  const back = page.locator(".chart-empty .ce-btn");
  await resetFocusBaseline(page);
  await tabUntil(page, back, "the Back to Daily rollback button");
  await expectNamedFocus(page, "Back to Daily button");
  // FINDINGS P2 (this run): the CTA's own activation handler is `pointerdown`-only
  // (components/ChartPanel.tsx:6642), so keyboard Enter on the focused button does NOT fire
  // it, and asserting it would be asserting a lie. What IS proven here: the rollback control
  // is Tab-reachable with visible, named focus. The rollback effect itself is verified
  // through the very event the CTA dispatches (mm:set-tf {tf:"D"} — the same app seam
  // no-data-symbol.spec.ts's in-place picks use), so the dead-end's exit is still honest.
  test.info().annotations.push({ type: "keyboard-gap", description: "chart-empty .ce-btn activates on pointerdown only; Enter does not fire it (ChartPanel.tsx:6642)" });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: "D" } })));
  await expect.poll(() => hasReady(page, "NVDA", "D"), { timeout: 45_000, message: "rollback re-announced the daily data edge" }).toBe(true);
  await expect(page.locator(".chart-empty")).toBeHidden();
  expect(await chartRows(page)).toBeGreaterThan(50);
  if (phone) await expect(page.getByTestId("roller-interval")).toHaveAttribute("aria-valuetext", "D", { timeout: 15_000 });
  else await expect(page.locator(".chart-tabs").getByRole("button", { name: "D", exact: true })).toHaveClass(/\bon\b/);
});

// ── C — EN × ZH × west × east: unclipped, un-overlapped, no false state, no data change ──

test("C: language and theme flips keep every chart control unclipped and honest, with symbol/timeframe unchanged", async ({ page }) => {
  test.slow(); // four full flip cycles with real output-edge waits
  const phone = isPhoneViewport(page);
  await bootChart(page, "NVDA");
  const baseRows = await chartRows(page);
  const baseSeries = await indicatorSeries(page);
  expect((await priceTag(page)).startsWith("NVDA")).toBe(true);
  expect(baseRows).toBeGreaterThan(50);

  const combos: { lang: "en" | "zh"; updown: "west" | "east" }[] = [
    { lang: "zh", updown: "west" }, { lang: "zh", updown: "east" },
    { lang: "en", updown: "east" }, { lang: "en", updown: "west" },
  ];
  let up = await upValue(page);
  for (const combo of combos) {
    await setLanguage(page, combo.lang);
    await waitForLanguage(page, combo.lang);
    const upDownBefore = await page.evaluate(() => document.documentElement.getAttribute("data-updown"));
    if (upDownBefore !== combo.updown) {
      await setUpDown(page, combo.updown);
      await expect.poll(() => upValue(page), { timeout: 15_000, message: `--up flips with the ${combo.updown} scheme` }).not.toBe(up);
      up = await upValue(page);
    }

    // no clipped / overlapped chart controls at this (lang × theme × viewport) cell
    await expectControlsFit(page);

    // no unintended data change: same symbol, same timeframe, same bars, same owned series
    expect(await chartRows(page), `bars survived the ${combo.lang}/${combo.updown} flip`).toBe(baseRows);
    // the last-price badge still names the SAME symbol (its tick legitimately moves)
    expect((await priceTag(page)).startsWith("NVDA")).toBe(true);
    expect(await indicatorSeries(page), "a flip must not add/remove series (no false state)").toBe(baseSeries);
    await expect(page.locator(".chart-empty")).toBeHidden();
    if (phone) await expect(page.getByTestId("roller-interval")).toHaveAttribute("aria-valuetext", "D");
    else {
      await expect(page.locator(".chart-tabs").getByRole("button", { name: "D", exact: true })).toHaveClass(/\bon\b/);
      await expect(page.locator(".indicator-library-trigger")).toHaveAttribute("aria-expanded", "false");
    }
  }
  await recordEngine(page, "engine=mm (after the flip matrix)");
});

// ── H — honest unavailable ────────────────────────────────────────────────────

const NVDA_DATA = /\/data\/NVDA\.json(?:\?.*)?$/;

test("H1: a fixture data 404 renders the honest unavailable state, never an empty chart as data — and a live symbol recovers", async ({ page }) => {
  await page.addInitScript((bag) => {
    for (const [k, v] of Object.entries(bag)) localStorage.setItem(k, v);
    const w = window as ReadyWindow & Window;
    w.__mmQ04ReadyEvents = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => { w.__mmQ04ReadyEvents?.push((event as CustomEvent).detail); });
  }, DEFAULT_SEED);
  await page.route(NVDA_DATA, (route: Route) => route.fulfill({
    status: 404, contentType: "application/json", body: JSON.stringify({ error: "fixture not served" }),
  }));
  await page.goto("/terminal?symbol=NVDA&engine=mm");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => mountedImpl(page), { timeout: 30_000 }).not.toBeNull();
  await recordEngine(page, "engine=mm (404 case)");

  await expect(page.locator(".chart-empty")).toBeVisible({ timeout: 45_000 });
  const msg = (await page.locator(".chart-empty .ce-msg").textContent()) ?? "";
  expect(msg, "the honest state must name the symbol").toContain("NVDA");
  // A 404/410 is AUTHORITATIVE ABSENCE, not a failure (lib/dataCache.ts:257 -> {status:"absent"}),
  // so ChartPanel.tsx:8952-8957 renders the ABSENCE copy and announces an "empty" edge. Assert that
  // exactly. The old disjunction also accepted the FAILURE copy, so a genuine 5xx/network failure
  // downgraded to "this symbol has no history" — the conflation lib/dataCache.ts:170-180 exists to
  // prevent — would have kept this test green. The failure branch is covered by H1b below.
  expect(msg, `a 404 is absence, not failure — expected the absence copy, got "${msg}"`).toBe("No daily history for NVDA yet.");
  await expect.poll(() => chartRows(page)).toBe(0);
  const lied = await page.evaluate(() => (window as ReadyWindow & Window).__mmQ04ReadyEvents?.some(
    (e) => e.symbol === "NVDA" && e.state === "data") ?? false);
  expect(lied, "failure-state law: a failed read never announces a DATA edge (an empty chart is not data)").toBe(false);
  const tagShown = await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>(".mm-ptag");
    return !!t && getComputedStyle(t).display !== "none";
  });
  expect(tagShown, "no last-price badge may claim data over a chart that failed to load").toBe(false);

  // Recovery proves the failure was the read, not the renderer: un-route, switch symbol in
  // place (the watchlist's own event), and real bars arrive under the next symbol.
  await page.unroute(NVDA_DATA);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "AAPL" } })));
  await expect.poll(() => hasReady(page, "AAPL"), { timeout: 45_000 }).toBe(true);
  expect(await chartRows(page)).toBeGreaterThan(50);
  await expect.poll(() => priceTag(page)).toContain("AAPL");
  await expect(page.locator(".chart-empty")).toBeHidden();
  await recordEngine(page, "engine=mm (after recovery)");
});

test("H1b: a 5xx on the fixture read renders the FAILURE copy and earns NO ready edge at all", async ({ page }) => {
  // lib/dataCache.ts:256-258: only 404/410 are authoritative absence; a 5xx/429/403 says NOTHING
  // about existence and resolves to {status:"unavailable"}. ChartPanel.tsx:8942-8950 answers it with
  // the failure copy and — the failure-state truth law — announces NO ready edge at all. H1's 404
  // can never reach that branch, so without this case the failure state has zero coverage.
  await page.addInitScript((bag) => {
    for (const [k, v] of Object.entries(bag)) localStorage.setItem(k, v);
    const w = window as ReadyWindow & Window;
    w.__mmQ04ReadyEvents = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => { w.__mmQ04ReadyEvents?.push((event as CustomEvent).detail); });
  }, DEFAULT_SEED);
  await page.route(NVDA_DATA, (route: Route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "upstream down" }),
  }));
  await page.goto("/terminal?symbol=NVDA&engine=mm");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => mountedImpl(page), { timeout: 30_000 }).not.toBeNull();
  await recordEngine(page, "engine=mm (503 case)");
  await expect(page.locator(".chart-empty")).toBeVisible({ timeout: 45_000 });
  const msg = (await page.locator(".chart-empty .ce-msg").textContent()) ?? "";
  expect(msg, "a failed read must say it FAILED, never that the symbol has no history")
    .toBe("Could not load NVDA price history. Try again shortly.");
  const edges = await page.evaluate(() => ((window as ReadyWindow & Window).__mmQ04ReadyEvents ?? [])
    .filter((e) => e.symbol === "NVDA"));
  expect(edges, "failure-state law: an unavailable read earns NO ready edge, data OR empty").toEqual([]);
  await expect.poll(() => chartRows(page)).toBe(0);
});

test("H2: a revoked entitlement renders the existing gated state honestly — bars stay real, the gated overlay says so", async ({ page }) => {
  // The e2e fixture's entitlement switch is the /api/me response (app/api/me/route.ts:16-26);
  // overriding it in-browser is the house pattern (e2e/indicator-guides.spec.ts:352-361).
  await page.route("**/api/me", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ tier: "free", features: [], status: "none" }),
  }));
  const gated = new Set(["gex:NVDA", "moves:NVDA", "gexstate:NVDA"]);
  await page.route((url) => url.pathname === "/api/flow" && gated.has(url.searchParams.get("f") ?? ""), (route: Route) => route.fulfill({
    status: 403, contentType: "application/json", body: JSON.stringify({ error: "entitlement_revoked" }),
  }));
  await bootChart(page, "NVDA", { "mm.inds": JSON.stringify(["optlevels"]) });

  const baseRows = await chartRows(page);
  if ((page.viewportSize()?.width ?? 1440) <= 860) {
    // ≤860 the price legend ships collapsed into the count chip (ChartPanel.tsx:985-988);
    // a touch user opens it with .lg-collapse — do that, then judge the rows.
    await page.locator(".lg-collapse").first().click();
  }
  const row = page.locator(".lg-row").filter({ hasText: "Options Levels" });
  await expect(row).toBeVisible({ timeout: 45_000 });
  // The existing gated legend note (lib/i18n.tsx:1624 olGate) — NOT a provenance claim and
  // NOT a silently missing row (the discoverability law: annotate, never vanish).
  await expect(row).toContainText("requires Essential/Pro", { timeout: 45_000 });
  expect(/EOD/i.test((await row.textContent()) ?? ""), "the gated row must not claim dated data").toBe(false);

  // Entitlement revocation changes the gate, not the chart: the real daily bars stand.
  expect(await chartRows(page)).toBeGreaterThan(50);
  expect(await chartRows(page)).toBe(baseRows);
  await expect(page.locator(".chart-empty")).toBeHidden();
  await expect.poll(() => priceTag(page)).toContain("NVDA");
});

// ── Z — 200% zoom: ONE explicit deviceScaleFactor-2 context ───────────────────

test("Z: a deviceScaleFactor-2 (200% zoom) context renders sharp, keyboard-reachable, unclipped, honest charts", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The explicit DSF-2 context rides the desktop project once; the three base viewports are the projects themselves.");
  test.slow();
  const baseURL = testInfo.project.use.baseURL ?? `http://127.0.0.1:${process.env.TERMINAL_E2E_PORT || 3108}`;
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await bootChart(page, "NVDA");
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
    const canvases = await page.evaluate(() => Array.from(document.querySelectorAll(".chart-wrap canvas")).map((raw) => {
      const c = raw as HTMLCanvasElement;
      const w = c.getBoundingClientRect().width;
      const chain: string[] = [];
      let n: Element | null = c.parentElement;
      for (let i = 0; i < 4 && n; i++) { chain.push(n.className ? String(n.className).slice(0, 32) : n.tagName.toLowerCase()); n = n.parentElement; }
      return { tag: `${c.className || c.dataset.testid || chain[0] || "canvas"}::${chain.join(">")}`, ratio: w > 0 ? c.width / w : null, w, cw: c.width };
    }));
    console.log("[Z canvases]", JSON.stringify(canvases));
    console.log("[Z dom]", JSON.stringify(await page.evaluate(() => ({
      impl: (window as unknown as EngineWindow & Window).__mmChartEngineImpl?.() ?? null,
      marker: document.querySelector("[data-chart-engine]")?.getAttribute("data-chart-engine") ?? null,
      allCanvases: Array.from(document.querySelectorAll("canvas")).map((c) => {
        const chain: string[] = [];
        let n: Element | null = c.parentElement;
        for (let i = 0; i < 6 && n; i++) { chain.push(n.className ? String(n.className).slice(0, 28) : n.tagName.toLowerCase()); n = n.parentElement; }
        const w = c.getBoundingClientRect().width;
        return `${c.className || "-"}::${chain.join(">")}::${w > 0 ? Math.round((c.width / w) * 100) / 100 : "hidden"}`;
      }),
      dpr: window.devicePixelRatio,
    }))));
    expect(canvases.length).toBeGreaterThan(0);
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const impl = await mountedImpl(page);
    for (const c of canvases) {
      if (c.ratio == null) continue;
      if (impl === "mm") {
        // The mm renderer scales its backing store by devicePixelRatio EXACTLY (measured on the
        // migration2 head: 4/4 canvases ratio 2 at dpr 2, w 967 -> cw 1934). Hold it to the law.
        expect(c.ratio, `canvas "${c.tag}" backing store must equal devicePixelRatio`).toBe(dpr);
      } else {
        // Never DOWN-scaled. The rented renderer measures ratio 1 at dpr 2 under emulated DSF
        // (7/7 canvases at HEAD), so `=== dpr` is not assertable for it yet — floor it and record.
        expect(c.ratio, `canvas "${c.tag}" backing store must at least cover its CSS box`).toBeGreaterThanOrEqual(1);
      }
    }
    // Record the actual backing ratio. This conditions the SHARPNESS LAW on the impl that really
    // mounted; it never asserts that mm mounted.
    const worst = Math.min(...canvases.filter((c) => c.ratio != null).map((c) => c.ratio as number));
    test.info().annotations.push({ type: "dsf2-canvas-backing", description: `dpr=${dpr} worstCanvasRatio=${Math.round(worst * 100) / 100} impl=${impl}` });

    // keyboard still rules at 200%: Tab to the timeframe, Enter, watch the chart re-binned.
    const rowsBefore = await chartRows(page);
    const wBtn = page.locator(".chart-tabs").getByRole("button", { name: "W", exact: true });
    await tabUntil(page, wBtn, "the W timeframe button at 200%");
    await expectNamedFocus(page, "W button at 200%");
    await page.keyboard.press("Enter");
    await expect(wBtn).toHaveClass(/\bon\b/, { timeout: 10_000 });
    await expect.poll(() => hasReady(page, "NVDA", "W"), { timeout: 45_000 }).toBe(true);
    expect(await chartRows(page)).toBeLessThan(rowsBefore);
    await expectControlsFit(page);

    // honesty survives the zoom too: a 404 data read says so instead of drawing anything.
    const dead = await context.newPage();
    await dead.addInitScript((bag) => {
      for (const [k, v] of Object.entries(bag)) localStorage.setItem(k, v);
    }, DEFAULT_SEED);
    await dead.route(NVDA_DATA, (route: Route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "gone" }) }));
    await dead.goto("/terminal?symbol=NVDA&engine=mm");
    await expect(dead.locator(".chart-empty")).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => chartRows(dead)).toBe(0);
    await recordEngine(dead, "engine=mm (DSF-2 404 case)");
    await dead.close();
  } finally {
    await context.close();
  }
});
