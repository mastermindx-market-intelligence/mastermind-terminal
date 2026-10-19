import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * E01 — full-universe, timeframe-specific technical screening on the real /discover Screener.
 *
 * The scan is the producer's own document (lib/__tests__/fixtures/screenerScan/technical.producer.json,
 * written by ingest/gen_technical_scan.py's tests) re-dated to "now" and widened with 2,000
 * synthetic covered names, served at the one published path. The manifest adds names the scan
 * never saw. Every arm drives the shipped component through route interception only.
 *
 *   AC-E01-02  evaluated + stale + unsupported + unavailable === the requested universe
 *   AC-E01-03  an incomplete generation is labelled "not full coverage"
 *   AC-E01-04  opening the screen costs ONE scan read and zero per-symbol OHLC/slice reads
 *   AC-E01-05  a result opens /terminal?sym=<SYM>&tf=<TF> and the chart lands on <TF>
 *   AC-E01-06  manifest filters survive the technical screen; a saved preset (#884 shape) carries
 *              no technical keys; desktop/tablet/phone × EN/ZH
 *   falsifier  a timeframe the scan did not produce is "unsupported" for every name, in words
 *
 * Set E01_CROPS=1 to also write the PR screenshots to docs/pr-crops/e01-technical-screen/.
 */

test.setTimeout(150_000);

const DAY = 86_400_000;
const FIXTURE = path.join(__dirname, "../lib/__tests__/fixtures/screenerScan/technical.producer.json");
const CROPS = process.env.E01_CROPS === "1";
const CROP_DIR = path.join(process.cwd(), "docs", "pr-crops", "e01-technical-screen");
const SYNTH = 2000;
const NOT_IN_SCAN = ["MSFT", "TSLA"];

/** A tf observation as the fixture carries it; only the dated fields are touched here. */
type Obs = { cutoff?: Record<string, unknown>; state?: Record<string, unknown>; [k: string]: unknown };
type Row = { sym: string; mkt?: string | null; sec?: string | null; tf: Record<string, Obs> };
type Doc = { generation: number; generated_at: string; complete: boolean; universe: { as_of: string; count: number }; rows: Row[]; [k: string]: unknown };

const shiftDay = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The producer fixture, re-dated so the newest generation is two hours old, plus SYNTH covered
 *  names whose 3D observation is NVDA's (same venue, same cutoff). */
function scanDoc(complete = true): Doc {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8")) as Doc;
  const genMs = Date.now() - 2 * 3_600_000;
  const shift = Math.floor((genMs - doc.generation * 1000) / DAY);
  const reDate = (o: Obs | null | undefined) => {
    if (!o || typeof o !== "object") return;
    const { cutoff, state } = o;
    if (cutoff) for (const k of ["session", "bar_open"]) { const v = cutoff[k]; if (typeof v === "string") cutoff[k] = shiftDay(v, shift); }
    if (state && typeof state.last_scored_ts === "string") state.last_scored_ts = shiftDay(state.last_scored_ts, shift);
  };
  for (const r of doc.rows) for (const o of Object.values(r.tf ?? {})) reDate(o);
  const nvda = doc.rows.find((r) => r.sym === "NVDA")!;
  for (let i = 1; i <= SYNTH; i++) {
    doc.rows.push({ sym: `SYN${String(i).padStart(4, "0")}`, mkt: nvda.mkt, sec: nvda.sec, tf: JSON.parse(JSON.stringify(nvda.tf)) });
  }
  doc.generation = Math.floor(genMs / 1000);
  doc.generated_at = new Date(doc.generation * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  doc.universe = { ...doc.universe, as_of: shiftDay(doc.universe.as_of, shift), count: doc.rows.length };
  doc.complete = complete;
  return doc;
}

/** Manifest: every scan name (fixture names first by $ volume so they head the default sort),
 *  plus names the scan never saw. */
function manifest(doc: Doc) {
  const symbols: Record<string, unknown> = {};
  doc.rows.forEach((r, i) => {
    const synth = r.sym.startsWith("SYN");
    symbols[r.sym] = {
      name: synth ? `Synthetic ${r.sym.slice(3)}` : r.sym,
      last: synth ? 40 + (i % 50) : 120 + i,
      chg: ((i % 7) - 3) / 2,
      vol: synth ? 100_000 + i : 900_000_000 - i * 1_000_000,
      sec: r.sec ?? "Equities",
      ...(r.mkt ? { mkt: r.mkt } : {}),
    };
  });
  NOT_IN_SCAN.forEach((s, i) => { symbols[s] = { name: s, last: 400 + i, chg: 0.3, vol: 800_000_000, sec: "Equities", mkt: "NASDAQ" }; });
  return { as_of: doc.universe.as_of, symbols };
}

type ReadyDetail = { symbol: string; timeframe: string };
declare global { interface Window { __e01Ready: ReadyDetail[] } }

async function setup(page: Page, lang: "en" | "zh", doc: Doc) {
  await page.addInitScript((l) => {
    window.__e01Ready = [];
    window.addEventListener("mm:terminal-visual-ready", (e) => {
      const d = (e as CustomEvent<ReadyDetail>).detail;
      window.__e01Ready.push({ symbol: d.symbol, timeframe: d.timeframe });
    });
    localStorage.setItem("mm.lang", l);
    // The user's startup timeframe; the deep link must never rewrite it.
    if (!localStorage.getItem("mm.startTf")) localStorage.setItem("mm.startTf", JSON.stringify("D"));
    // An init script can run before <html> exists; LangProvider reads mm.lang either way.
    document.documentElement?.setAttribute("data-lang", l);
  }, lang);

  const man = manifest(doc);
  const syms = new Set(Object.keys(man.symbols));
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: man }));
  await page.route("**/data/scan/technical.json**", (route) => route.fulfill({ json: doc }));
  return {
    scanReads: () => urls.filter((u) => new URL(u).pathname === "/data/scan/technical.json").length,
    /** Per-symbol OHLC / slice reads for manifest names (what a client-side scan would need). */
    perSymbolReads: () => urls.filter((u) => {
      const m = /^\/data\/([^/]+?)(?:\.slice)?\.json$/.exec(new URL(u).pathname);
      return !!m && syms.has(decodeURIComponent(m[1]));
    }).length,
    total: syms.size,
  };
}

const count = async (page: Page, k: string) =>
  Number(((await page.locator(`[data-tech-count="${k}"] b`).textContent()) ?? "").replace(/[^\d]/g, ""));

async function counts(page: Page) {
  const [requested, evaluated, stale, unsupported, unavailable] = await Promise.all(
    ["requested", "evaluated", "stale", "unsupported", "unavailable"].map((k) => count(page, k)),
  );
  return { requested, evaluated, stale, unsupported, unavailable };
}

async function crop(page: Page, testInfo: TestInfo, name: string) {
  if (!CROPS) return;
  mkdirSync(CROP_DIR, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(CROP_DIR, `${name}-${testInfo.project.name}.png`), animations: "disabled" });
}

const symRows = (page: Page) => page.locator("tbody tr .sym-cell");
const rowOf = (page: Page, sym: string) => page.locator("tbody tr").filter({ has: page.locator(`.sym-cell .tk:text-is("${sym}")`) });

const COPY = {
  en: { toggle: "Technical screen", col: (tf: string) => `Technical · ${tf}`, notScanned: "not scanned", incomplete: "not full coverage", emptyWhy: "passes the technical screen" },
  zh: { toggle: "技术筛选", col: (tf: string) => `技术 · ${tf}`, notScanned: "未扫描", incomplete: "非全量覆盖", emptyWhy: "没有满足技术筛选的标的" },
} as const;

for (const lang of ["en", "zh"] as const) {
  test(`E01 technical screen journey (${lang})`, async ({ page }, testInfo) => {
    const c = COPY[lang];
    const doc = scanDoc(true);
    const net = await setup(page, lang, doc);

    await page.goto("/discover?tab=screener");
    await expect(symRows(page).first()).toBeVisible({ timeout: 60_000 });

    // Manifest-only compatibility path: nothing technical is read or drawn until asked for.
    expect(net.scanReads()).toBe(0);
    await expect(page.locator("th[data-tech-col]")).toHaveCount(0);

    // ── open the screen: ONE scan read (AC-E01-04) ──
    const toggle = page.locator("[data-tech-toggle]");
    await expect(toggle).toHaveText(c.toggle);
    await toggle.click();
    await expect(page.locator("[data-tech-coverage]")).toBeVisible({ timeout: 30_000 });
    expect(net.scanReads()).toBe(1);
    await expect(page.locator("th[data-tech-col]")).toBeVisible();
    await expect(page.locator("th[data-tech-col]")).toHaveText(c.col("3D"));

    // ── AC-E01-02: the four populations sum to the requested universe, nothing dropped ──
    let n = await counts(page);
    expect(n.requested).toBe(net.total);
    expect(n.evaluated + n.stale + n.unsupported + n.unavailable).toBe(n.requested);
    expect(n.evaluated).toBe(3 + SYNTH);   // NVDA, AAPL, 0700.HK + the synthetic covered names
    expect(n.stale).toBe(1);               // OLDERA: published by an older engine identity
    await expect(page.locator('[data-tech-reason="unavailable:not_in_scan"] b')).toHaveText(String(NOT_IN_SCAN.length));
    await expect(page.locator('[data-tech-complete="true"]')).toBeVisible();
    await expect(page.locator('[data-tech-handover="exact"]')).toContainText("3D");
    // Each non-evaluated name is a status in the row, never a value.
    await expect(rowOf(page, "MSFT").locator('td[data-tech-status="unavailable"]')).toHaveAttribute("data-tech-reason", "not_in_scan");
    await expect(rowOf(page, "NVDA").locator('td[data-tech-status="evaluated"]')).toBeVisible();

    // Phone: the technical column replaces the hidden ones and the page never scrolls sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    // Tablet: the shared columns overflow the table's own scroller; the technical column must still
    // be on screen without a sideways scroll.
    const vw = page.viewportSize()!.width;
    for (const loc of [page.locator("th[data-tech-col]"), rowOf(page, "NVDA").locator("td[data-tech-status]")]) {
      const box = (await loc.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
    }
    await crop(page, testInfo, `coverage-${lang}`);
    if (testInfo.project.name === "mobile") { // the phone strip pushes the rows below the fold
      await rowOf(page, "NVDA").scrollIntoViewIfNeeded();
      await crop(page, testInfo, `rows-${lang}`);
    }

    // ── a manifest filter survives the technical screen (AC-E01-06) ──
    const search = page.locator(".scr2-search");
    await search.fill("NVDA");
    await expect(symRows(page)).toHaveCount(1);
    await expect.poll(() => count(page, "requested")).toBe(1);

    await page.locator("[data-tech-signal]").selectOption("buyside");
    await expect(rowOf(page, "NVDA")).toHaveCount(1);          // BUY passes
    await search.fill("AAPL");
    await expect(symRows(page)).toHaveCount(0);                 // SELL is a known failure
    await expect(page.locator(".fin-empty-why")).toContainText(c.emptyWhy);
    await expect(search).toHaveValue("AAPL");
    await search.fill("");
    // Not-evaluated names are hidden as UNKNOWN and counted — never dropped silently.
    await expect.poll(() => symRows(page).count()).toBeGreaterThan(0);
    await expect(page.locator("[data-tech-hidden-unknown]")).toContainText(String(net.total - (2 + SYNTH)));

    // ── a saved preset keeps the #884 FilterState shape: no technical keys ──
    await page.locator(".scr2-presets-tail .fin-tab").click();
    await page.locator(".scr2-preset-name").fill(`e01-${lang}`);
    await page.locator(".scr2-preset-name").press("Enter");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mm.scrPresets") ?? "null"));
    expect(saved?.v).toBe(1);
    // E03 adds its four cross-market keys (taxonomy, stale-label choice, currency scope, the
    // currency a liquidity floor was set in); none of them is technical.
    expect(Object.keys(saved.items.at(-1).f).sort()).toEqual(
      ["asset", "ccy", "classStale", "liq", "liqCcy", "market", "mcap", "move", "sector", "signal", "taxonomy", "unpriced", "uptrend", "w52"],
    );
    expect(JSON.stringify(saved)).not.toMatch(/tech|buyside|"3D"/);
    await expect(page.locator("[data-tech-signal]")).toHaveValue("buyside"); // saving did not reset the screen

    // ── falsifier: a timeframe the scan never produced is UNSUPPORTED for every name ──
    const tfSel = page.locator("[data-tech-tf]");
    await expect(tfSel.locator('option[value="W"]')).toHaveText(`W · ${c.notScanned}`);
    await tfSel.selectOption("W");
    await expect(page.locator('[data-tech-tf-not-produced="W"]')).toBeVisible();
    // The sentence wraps on a phone rather than running past the edge (where it would be clipped).
    const tag = (await page.locator('[data-tech-tf-not-produced="W"]').boundingBox())!;
    expect(tag.x + tag.width).toBeLessThanOrEqual(vw + 1);
    n = await counts(page);
    expect(n.unsupported).toBe(n.requested);
    expect(n.evaluated).toBe(0);
    await expect(page.locator('[data-tech-reason="unsupported:timeframe_not_produced"] b')).toHaveText(n.requested.toLocaleString("en-US"));
    await expect(symRows(page)).toHaveCount(0);
    await expect(page.locator(".fin-empty-why")).toContainText(c.emptyWhy);
    await expect(page.locator("th[data-tech-col]")).toHaveText(c.col("W"));
    await page.locator("[data-tech-signal]").selectOption("any");
    await expect(rowOf(page, "NVDA").locator('td[data-tech-status="unsupported"]')).toHaveAttribute("data-tech-reason", "timeframe_not_produced");
    await crop(page, testInfo, `falsifier-w-${lang}`);

    // ── AC-E01-05: the result opens the chart at the screened timeframe ──
    await tfSel.selectOption("3D");
    await search.fill("NVDA");
    await expect(symRows(page)).toHaveCount(1);
    expect(net.perSymbolReads()).toBe(0);   // AC-E01-04: the whole screen used no per-symbol OHLC
    expect(net.scanReads()).toBe(1);
    await rowOf(page, "NVDA").locator(".sym-cell").click();
    await page.waitForURL(/\/terminal\?sym=NVDA/, { timeout: 60_000 });
    await expect.poll(
      () => page.evaluate(() => window.__e01Ready.filter((d) => d.symbol === "NVDA").map((d) => d.timeframe)),
      { timeout: 60_000 },
    ).toContain("3D");
    // The chart settled on the screened timeframe (the startup "D" frame may precede it).
    expect((await page.evaluate(() => window.__e01Ready.filter((d) => d.symbol === "NVDA").map((d) => d.timeframe))).at(-1)).toBe("3D");
    await expect.poll(() => new URL(page.url()).searchParams.get("tf")).toBeNull();
    expect(new URL(page.url()).searchParams.get("sym")).toBe("NVDA");
    expect(await page.evaluate(() => localStorage.getItem("mm.startTf"))).toBe(JSON.stringify("D"));
  });
}

test("AC-E01-03: an incomplete generation is labelled, and still accounts every name", async ({ page }) => {
  const net = await setup(page, "en", scanDoc(false));
  await page.goto("/discover?tab=screener");
  await expect(symRows(page).first()).toBeVisible({ timeout: 60_000 });
  await page.locator("[data-tech-toggle]").click();
  await expect(page.locator('[data-tech-complete="false"]')).toContainText(COPY.en.incomplete);
  const n = await counts(page);
  expect(n.requested).toBe(net.total);
  expect(n.evaluated + n.stale + n.unsupported + n.unavailable).toBe(n.requested);
  expect(net.scanReads()).toBe(1);
});
