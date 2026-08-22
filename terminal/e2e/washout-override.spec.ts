import { test, expect, type Page } from "./fixtures";
// The marker hover is bilingual since the marker-tooltip repair, and its wording is owned by the
// copy module — imported rather than transcribed so this suite cannot drift from what the product
// says, in either language (same reason washout-retro.spec.ts imports `retroLegendCopy`).
import { washoutOverrideCopy } from "../lib/signalVerdict";

// Hydration gate, same shape as responsive.spec.ts (the helpers are per-spec there).
async function armTerminalVisualReady(page: Page) {
  await page.addInitScript(() => {
    const readyWindow = window as Window & { __mmResponsiveVisualReady?: boolean };
    readyWindow.__mmResponsiveVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmResponsiveVisualReady = true;
    }, { once: true });
  });
}

async function waitForTerminalVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() =>
      Boolean((window as Window & { __mmResponsiveVisualReady?: boolean }).__mmResponsiveVisualReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

// Washout override candidate — the display class on a REFUSED entry.
//
// Ratified 2026-08-10 at the 25% notch (Macro Dashboard
// research/BLOCKED_ENTRY_RATIFICATION_PACKET_2026-08-10.md §2/§4; prereg §5/§7). A
// `regime_blocked` ⊘ whose thematic-basket peers sat ≥25% below their 252d highs the day it
// fired is promoted VISUALLY — amber marker, one disclosure line on the amber card — and in
// no other way. The entry mask, the keeper verdict, the tier, the score and the backtest are
// untouched, and this suite exists to keep it that way: every assertion below is either
// "the refusal still reads as a refusal" or "the disclosure says the honest thing".
//
// Live in-cohort exemplar the fixture is shaped on: UEC 2026-08-03, `uranium_miners`
// peer-dd −38.8%, admitted at every threshold on both the study and production feeds.
//
// NOTE ON THEMES: the Terminal ships ONE theme (dark) — `terminal/app/settings.css` documents
// it, and neither globals.css nor fin.css carries a `[data-theme]` branch. Both LANGUAGES are
// covered here (zh rides the tablet project, matching responsive.spec.ts).

/** A synthetic daily OHLC series ending on the most recent weekday.
 *
 *  Required, not decorative: ChartPanel drops any slice signal dated after the last bar, and
 *  the rail card only grants a refusal full authority inside the 21-day staleness window — so
 *  a fixture fire recent enough for the CARD is newer than the committed COST bars and would
 *  never reach the CHART. Synthesising the price series is what lets one fixture prove both,
 *  and taking the signal dates FROM the series is what stops the suite from going red every
 *  time the calendar hands it a weekend (a hardcoded "2 days ago" is a scheduled failure).
 */
function ohlcFixture(days = 420) {
  const bars: [string, number, number, number, number, number][] = [];
  const start = Date.now() - days * 86_400_000;
  let px = 18;
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;   // weekdays only
    // a long slide into a washout, so the tape under the refusal reads like the real case
    px = Math.max(6, px * (1 - 0.0016) + Math.sin(i / 9) * 0.09);
    bars.push([d.toISOString().slice(0, 10), +(px * 1.004).toFixed(2), +(px * 1.012).toFixed(2),
               +(px * 0.988).toFixed(2), +px.toFixed(2), 1_500_000]);
  }
  return { t: "COST", o: 1, src: "e2e-fixture", bar_quality: "real_ohlc", bars };
}

const OHLC = ohlcFixture();
const BAR_DATES = OHLC.bars.map((b) => b[0]);
/** the refused entry: the newest bar on the chart, and comfortably inside the 21-day window */
const BLOCKED_TS = BAR_DATES[BAR_DATES.length - 1];
/** the older structure stop it sits behind (~4 weeks back) */
const SELL_TS = BAR_DATES[BAR_DATES.length - 21];

const OVERRIDE_CTX = {
  group_id: "uranium_miners",
  peer_dd: -0.388,
  basis: "basket",
  thresholds_hit: [20, 25, 30],
  as_of: BLOCKED_TS,
  name: "Uranium miners",
  name_zh: "铀矿商",
};

/** The TAKEN entry, as the emitter ships it since the gc_v2_wo1 fence: its own quality
 *  string, a recipe tier, override_ctx for the disclosure — and NO `blocked` flag, because
 *  it is not a refusal. `signal_era` rides the slice so a reader can tell the two apart. */
const TAKEN_SIGNAL = {
  ts: BLOCKED_TS, known_ts: BLOCKED_TS, bar_index: 424, type: "BUY", price: 10.5,
  quality: "override_take", tier: "quality", score: 71,
  quality_reason: "washout override: uranium_miners −38.8% ≤ −25% (era gc_v2_wo1)",
  override_ctx: OVERRIDE_CTX,
};

function sliceFixture(opts: { override: boolean; taken?: boolean }) {
  const sellTs = SELL_TS;
  const blockedTs = BLOCKED_TS;
  const taken = !!opts.taken;
  return {
    slice: {
      indicator: {
        signal_era: taken ? "gc_v2_wo1" : "gc_v2",
        state: {
          // a taken override IS an entry, so the scored lane walks to it
          position_hint: taken ? "long" : "flat",
          last_signal: "BUY",
          last_scored_signal: taken ? "BUY" : "SELL",
          last_scored_ts: taken ? blockedTs : sellTs,
          last_scored_basis: taken ? null : "structure_stop",
          strong_bull: false,
          overbought: false,
          weeklyBull: false,
          above200: false,
        },
        signals: [
          {
            ts: sellTs, known_ts: sellTs, bar_index: 400, type: "SELL", price: 14.2,
            basis: "structure_stop", stop_level: 15.05,
            reasons: ["distribution_confirmed", "structure_break"],
          },
          taken ? TAKEN_SIGNAL : {
            // still typed BUY on purpose — `blocked`/`quality` are the render keys
            ts: blockedTs, known_ts: blockedTs, bar_index: 424, type: "BUY", price: 10.5,
            quality: "regime_blocked", blocked: true, tier: null, score: null,
            quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull",
            ...(opts.override ? { override_candidate: true, override_ctx: OVERRIDE_CTX } : {}),
          },
        ],
        early_dots: [],
        warnings: [],
      },
      backtest: { metrics: { n_trades: 22, win_rate: 0.34, profit_factor: 1.6, cagr: 0.11 } },
    },
    blockedTs,
  };
}

/** Flip the Terminal to Chinese through the real settings flow (no fixture shortcut —
 *  a language the user cannot actually reach is not a language the product ships).
 *
 *  Viewport-bound: the entry point is the mobilebar avatar, which only exists on the
 *  tablet/mobile chrome. Desktop reaches zh the other real way — `zhPreseed` below, which is
 *  the RETURNING user's path (app/layout.tsx boots the language out of `mm.lang`). */
async function applyZh(page: Page) {
  await page.locator(".mobilebar button.avatar").click();
  const settings = page.locator(".acs-card");
  await settings.getByRole("tab", { name: "Preferences" }).click();
  const zhButton = settings.getByRole("button", { name: "中文" });
  await zhButton.click();
  await expect(zhButton).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
}

async function openTerminal(page: Page, opts: {
  override: boolean; zh: boolean; taken?: boolean; zhPreseed?: boolean;
}) {
  const { slice, blockedTs } = sliceFixture({ override: opts.override, taken: opts.taken });
  if (opts.zhPreseed) {
    await page.addInitScript(() => { localStorage.setItem("mm.lang", "zh"); });
  }
  await page.route(/\/data\/COST\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(OHLC) });
  });
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(slice) });
  });
  // Golden Oracle markers are an OPT-IN study (TerminalShell item-28) — seed the saved
  // indicator set so the ⊘ geometry actually renders on the price series.
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["_oracle"]));
  });
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=COST");
  await expect(page.locator(".workspace")).toBeVisible();
  await waitForTerminalVisualReady(page);
  if (opts.zh && !opts.zhPreseed) await applyZh(page);
  if (opts.zhPreseed) await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
  return { blockedTs };
}

/** The amber `--signal` token, as the browser resolves it (#e8b339). */
const AMBER_RGB = "rgb(232, 179, 57)";

/** The ⊘ glyph is ~11px across on a full chart, so a full-viewport shot proves nothing to a
 *  human reviewer. Crop tight around the marker's own bounding box instead. */
async function cropMarker(page: Page, path: string) {
  const box = await page.locator("[data-sig-layer]").first().evaluate((svg) => {
    const g = [...svg.querySelectorAll("g")]
      .find((el) => el.querySelector('circle[fill="none"]') && el.querySelector("line"));
    if (!g) return null;
    const r = (g as SVGGElement).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!box) return;
  await page.screenshot({
    path,
    clip: { x: Math.max(0, box.x - 38), y: Math.max(0, box.y - 32), width: 76, height: 64 },
  });
}

test("a qualifying ⊘ wears the amber override class on card, hover and chart", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  await openTerminal(page, { override: true, zh });

  // ── the rail button: unchanged verdict, and the Tier-2 numbers reachable on hover ──
  const signalButton = page.locator(".sig-btn");
  await signalButton.scrollIntoViewIfNeeded();
  await expect(signalButton.locator(".sig-btn-go .sig-btn-vd"))
    .toHaveText(zh ? "买点触发 — 趋势闸拦截" : "Entry trigger — regime-blocked");
  await expect(signalButton).toHaveAttribute(
    "title",
    zh ? /仍是被拦截的入场 — 洗盘标记是背景，不是放行/
       : /still a refused entry — the washout flag is context, not a green light/,
  );
  await expect(signalButton).toHaveAttribute(
    "title",
    // the notch-20 re-grade (era gc_v2_wo2) republished this row at +22%/+3%; the +27% these
    // regexes carried before was the 25% row and is NOT interchangeable with it
    zh ? /每笔平均 \+22%，其他情形 \+3%/ : /averaged \+22% per trade vs \+3% otherwise/,
  );
  await signalButton.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-washout-override-rail.png`),
  });

  // ── the chart marker: same ring-slash, amber at full opacity, with the dot above it ──
  const sigLayer = page.locator("[data-sig-layer]").first();
  await expect(sigLayer.locator('circle[fill="none"]').first()).toBeAttached();
  const marker = await sigLayer.evaluate((svg) => {
    const groups = [...svg.querySelectorAll("g")];
    const g = groups.find((el) => el.querySelector('circle[fill="none"]') && el.querySelector("line"));
    if (!g) return null;
    const outline = g.querySelector<SVGCircleElement>('circle[fill="none"]')!;
    const slash = g.querySelector<SVGLineElement>("line")!;
    const dot = g.querySelector<SVGCircleElement>('circle:not([fill="none"])');
    return {
      opacity: g.getAttribute("opacity"),
      ringStroke: getComputedStyle(outline).stroke,
      slashStroke: getComputedStyle(slash).stroke,
      dotFill: dot ? getComputedStyle(dot).fill : null,
      dotR: dot ? dot.getAttribute("r") : null,
      dotAboveRing: dot ? Number(dot.getAttribute("cy")) < Number(outline.getAttribute("cy")) : false,
      title: g.querySelector("title")?.textContent ?? "",
    };
  });
  expect(marker).not.toBeNull();
  expect(marker!.opacity).toBe("1");                     // full opacity, not the 0.62 background
  expect(marker!.ringStroke).toBe(AMBER_RGB);
  expect(marker!.slashStroke).toBe(AMBER_RGB);           // still a ring-SLASH — never buy geometry
  expect(marker!.dotFill).toBe(AMBER_RGB);
  expect(marker!.dotAboveRing).toBe(true);
  // the refusal comes FIRST and the washout second — a candidate is still a refused entry
  expect(marker!.title).toContain(zh ? "被趋势闸拦截 — 非入场信号" : "blocked by the regime gate — not an entry");
  expect(marker!.title).toContain(washoutOverrideCopy(OVERRIDE_CTX, zh, "candidate")!.line);
  expect(marker!.title.indexOf(zh ? "非入场信号" : "not an entry"))
    .toBeLessThan(marker!.title.indexOf(washoutOverrideCopy(OVERRIDE_CTX, zh, "candidate")!.line));
  await page.locator(".chart-wrap, .workspace").first().screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-washout-override-chart.png`),
  });
  await cropMarker(page, testInfo.outputPath(`${testInfo.project.name}-washout-override-marker.png`));

  // ── the card: ONE extra amber line under the same amber verdict ──
  await signalButton.click();
  const dialog = page.locator(".sd-scrim");
  await expect(dialog).toBeVisible();
  const line2 = dialog.locator(".sd-go .od-vline2");
  await expect(line2).toHaveText(
    zh ? "深度洗盘例外候选 — 铀矿商板块距高点 −38%"
       : "Washout override candidate — Uranium miners −38% from highs",
  );
  await expect(line2).toHaveCSS("color", AMBER_RGB);
  await expect(dialog.locator(".sd-go .od-verdict")).toHaveText(
    zh ? "买点触发 — 趋势闸拦截" : "Entry trigger — regime-blocked",
  );
  // the disclosure carries its own Tier-2 hover so the numbers are reachable from the card too
  await expect(line2).toHaveAttribute(
    "title", zh ? /多数仍会止损离场 — 止损才是保护/ : /most still stop out — the stop is the protection/,
  );
  // the refusal is still a refusal: no tier/score row, and the history row still says BLOCKED
  await expect(dialog.locator(".sd-go .sig-dims")).toHaveCount(0);
  await expect(dialog.locator(".sd-go .sd-sigrow").first().locator(".sd-sig-badge"))
    .toHaveText(zh ? "已拦截" : "BLOCKED");
  await dialog.locator(".sd-go").screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-washout-override-card.png`),
  });
});

test("a non-qualifying ⊘ renders exactly as it does today", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  await openTerminal(page, { override: false, zh });

  const signalButton = page.locator(".sig-btn");
  await signalButton.scrollIntoViewIfNeeded();
  await expect(signalButton.locator(".sig-btn-go .sig-btn-vd"))
    .toHaveText(zh ? "买点触发 — 趋势闸拦截" : "Entry trigger — regime-blocked");
  const title = await signalButton.getAttribute("title");
  expect(title).not.toContain("washout");
  expect(title).not.toContain("洗盘");
  expect(title).not.toContain("+22%");

  const readMarker = () => page.locator("[data-sig-layer]").first().evaluate((svg) => {
    const g = [...svg.querySelectorAll("g")]
      .find((el) => el.querySelector('circle[fill="none"]') && el.querySelector("line"));
    if (!g) return null;
    return {
      opacity: g.getAttribute("opacity"),
      ringStroke: getComputedStyle(g.querySelector<SVGCircleElement>('circle[fill="none"]')!).stroke,
      dots: g.querySelectorAll('circle:not([fill="none"])').length,
    };
  });
  await expect.poll(readMarker).not.toBeNull();
  const marker = await readMarker();
  expect(marker).not.toBeNull();
  expect(marker!.opacity).toBe("0.62");             // the dim slate background treatment
  expect(marker!.ringStroke).toBe("rgb(124, 138, 160)");   // #7c8aa0
  expect(marker!.dots).toBe(0);                     // no amber dot
  await cropMarker(page, testInfo.outputPath(`${testInfo.project.name}-washout-plain-marker.png`));

  await signalButton.click();
  const dialog = page.locator(".sd-scrim");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".sd-go .od-vline2")).toHaveCount(0);
  await expect(dialog.locator(".sd-go .od-verdict")).toHaveText(
    zh ? "买点触发 — 趋势闸拦截" : "Entry trigger — regime-blocked",
  );
  await dialog.locator(".sd-go").screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-washout-plain-card.png`),
  });
});

// ── the TAKEN class: washout override ENTRY (signal era gc_v2_wo1) ─────────────────────────
//
// The other side of the same mechanism. Since the era fence a qualifying bear_block-vetoed
// fire is TAKEN by the live enter mask (Macro Dashboard research/BLOCKED_ENTRY_CONDITIONAL_
// PREREG.md §5 RATIFIED @ 25% + GATE B PASSED; packet §2/§4). It is a real entry, so it must
// render as one — ordinary star, ordinary green verdict, tier badge — with the washout
// context beside it and NOTHING borrowed from the refusal's geometry. The two states of one
// mechanism share only their amber.
//
// This test carries the PR's visual receipt for the new state: desktop, EN and ZH.

/** Crop tight around the ENTRY marker (an amber-outlined pill, not a ring-slash). */
async function cropEntryMarker(page: Page, path: string, needle: string) {
  const box = await page.locator("[data-sig-layer]").first().evaluate((svg, needle) => {
    // find it by what it SAYS, not by shape: every marker rect carries a `stroke`
    // attribute (often "none"), so a shape selector would happily return the SELL pill.
    const g = [...svg.querySelectorAll("g")]
      .find((el) => (el.querySelector("title")?.textContent ?? "").includes(needle));
    if (!g) return null;
    const r = (g as SVGGElement).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, needle);
  if (!box) return;
  await page.screenshot({
    path,
    clip: { x: Math.max(0, box.x - 44), y: Math.max(0, box.y - 34), width: 88, height: 68 },
  });
}

/** Everything the taken class must be true of, in one language. */
async function assertTakenEntry(page: Page, zh: boolean, label: string, testInfo: import("@playwright/test").TestInfo) {
  const tag = `${testInfo.project.name}-${label}`;

  // ── the rail: the ORDINARY entry verdict, not the amber refusal card ──
  const signalButton = page.locator(".sig-btn");
  await signalButton.scrollIntoViewIfNeeded();
  await expect(signalButton.locator(".sig-btn-go .sig-btn-vd")).toHaveText(zh ? "买入" : "Buy");
  await expect(signalButton.locator(".sig-btn-go .sig-btn-vd"))
    .not.toHaveText(zh ? "买点触发 — 趋势闸拦截" : "Entry trigger — regime-blocked");
  await expect(signalButton).toHaveAttribute(
    "title",
    zh ? /趋势闸本会拦截 — 同类深度洗盘是放行的唯一理由/
       : /the regime gate would refuse this — the deep group washout is the one reason it stands/,
  );
  await expect(signalButton).toHaveAttribute(
    "title", zh ? /多数仍会止损离场 — 止损才是保护/ : /most still stop out — the stop is the protection/,
  );
  // the refusal's own lead must NOT be here — this entry was taken
  const railTitle = (await signalButton.getAttribute("title")) ?? "";
  expect(railTitle).not.toContain(zh ? "仍是被拦截的入场" : "still a refused entry");
  await signalButton.screenshot({ path: testInfo.outputPath(`${tag}-rail.png`) });

  // ── the chart marker: entry geometry, outlined amber ──
  const sigLayer = page.locator("[data-sig-layer]").first();
  // keyed on the copy module's own line, so the selector follows the product into 中文 instead of
  // pinning the suite to the English the tooltip used to be able to assume
  const entryLine = washoutOverrideCopy(OVERRIDE_CTX, zh, "entry")!.line;
  await expect(sigLayer.locator("title", { hasText: entryLine }).first()).toBeAttached();
  const marker = await sigLayer.evaluate((svg, needle) => {
    const g = [...svg.querySelectorAll("g")]
      .find((el) => (el.querySelector("title")?.textContent ?? "").includes(needle));
    if (!g) return null;
    const rect = g.querySelector<SVGRectElement>("rect")!;
    return {
      opacity: g.getAttribute("opacity"),
      outline: getComputedStyle(rect).stroke,
      fill: getComputedStyle(rect).fill,
      strokeWidth: rect.getAttribute("stroke-width"),
      ringSlashes: g.querySelectorAll('circle[fill="none"]').length,
      star: [...g.querySelectorAll("text")].map((t) => t.textContent).join(""),
      title: g.querySelector("title")?.textContent ?? "",
    };
  }, entryLine);
  expect(marker).not.toBeNull();
  expect(marker!.outline).toBe(AMBER_RGB);              // the washout signature
  expect(marker!.fill).not.toBe("none");                // solid — the engine stands behind it
  expect(marker!.ringSlashes).toBe(0);                  // no ⊘ anywhere: this is not a refusal
  expect(marker!.star).toContain("★");                  // ordinary entry star (+ its tier badge)
  expect(marker!.title).toContain(entryLine);
  expect(marker!.title).toContain(zh ? "铀矿商" : "Uranium miners");
  expect(marker!.title).toContain("−38%");
  expect(marker!.title).not.toContain(zh ? "非入场信号" : "not an entry");
  // the stop-out clause is the one that matters most on a real entry, so it must survive here too
  expect(marker!.title).toContain(washoutOverrideCopy(OVERRIDE_CTX, zh, "entry")!.notes.at(-1)!);
  await page.locator(".chart-wrap, .workspace").first().screenshot({
    path: testInfo.outputPath(`${tag}-chart.png`),
  });
  await cropEntryMarker(page, testInfo.outputPath(`${tag}-marker.png`), entryLine);

  // ── the card: the entry verdict PLUS the one disclosure line ──
  await signalButton.click();
  const dialog = page.locator(".sd-scrim");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".sd-go .od-verdict")).toHaveText(zh ? "买入" : "Buy");
  const line2 = dialog.locator(".sd-go .od-vline2");
  await expect(line2).toHaveText(
    zh ? "深度洗盘例外入场 — 铀矿商板块距高点 −38%"
       : "Washout override entry — Uranium miners −38% from highs",
  );
  await expect(line2).toHaveCSS("color", AMBER_RGB);
  // the quality chip names the class and wears the same amber, so the exception is findable
  // from the card body too — and the TIER beside it proves the recipe graded this entry
  // (a null tier there would mean the fire took the refused path after all).
  const quality = dialog.locator(".sd-go .sig-dim-v").first();
  await expect(quality).toHaveText(zh ? "深度洗盘例外" : "Washout override");
  await expect(quality).toHaveCSS("color", AMBER_RGB);
  await expect(dialog.locator(".sd-go .sig-dims")).toBeVisible();
  await dialog.locator(".sd-go").screenshot({ path: testInfo.outputPath(`${tag}-card.png`) });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("a TAKEN washout override renders as an ordinary entry, outlined amber", async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === "desktop";
  // Desktop carries the PR's visual receipt in BOTH languages — a second load with the
  // language already saved, which is what a returning zh user actually gets. The other
  // viewports keep the suite's one-language-per-project convention (zh rides tablet).
  const zhFirst = !desktop && testInfo.project.name === "tablet";
  await openTerminal(page, { override: true, taken: true, zh: zhFirst });
  await assertTakenEntry(page, zhFirst, zhFirst ? "washout-take-zh" : "washout-take-en", testInfo);
  if (desktop) {
    await openTerminal(page, { override: true, taken: true, zh: true, zhPreseed: true });
    await assertTakenEntry(page, true, "washout-take-zh", testInfo);
  }
});
