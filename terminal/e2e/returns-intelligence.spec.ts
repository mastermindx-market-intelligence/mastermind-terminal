import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildCurrentBasket, decodeReturnSeries, returnSessions } from "../lib/returnsIntelligence";

// These are explicitly synthetic paths, not historical NVDA/sector/GEX evidence.
const DAYS = returnSessions("2025-01-02", "2026-10-16")!.slice(-320);
function fixture(symbol: string, unverified = false) {
  let close = symbol === "SPY" ? 400 : symbol === "QQQ" ? 350 : 100;
  const scale = symbol === "SPY" ? 0.33 : symbol === "QQQ" ? 0.53 : symbol === "AMD" ? 0.7 : symbol === "AVGO" ? 1.2 : 1;
  const bars = DAYS.map((day, i) => {
    const prior = close, drift = i < 278 ? 0.0018 : i < 299 ? 0.0053 : 0.0016;
    close *= Math.exp(scale * (drift + Math.sin(i * 1.14) * (i < 299 ? 0.003 : 0.006)));
    const open = prior * (1 + Math.sin(i) * 0.001);
    return [day, open, Math.max(open, close) * 1.002, Math.min(open, close) * 0.998, close, 1000000 + i * 17];
  });
  return { t: symbol, src: "fixture", bar_quality: "real_ohlc", bars,
    ...(unverified ? {} : { view: { schema: "terminal.ohlc_view.v1", listing: { mic: "XNAS", src: "fixture" },
      contract: { schema: "dataos.view_contract.v1", purpose: "terminal_daily_ohlc", identity_namespace: "synthetic_returns_fixture", field_units: { close: "USD/share" }, coverage: { from: DAYS[0], to: DAYS.at(-1) }, adjustment_reference: { basis: "tradj", as_at: "2026-10-16T20:00:00Z" }, evidence_mode: { mode: "CURRENT" } },
      segments: [], basis_drift: null, suspected_breaks: [], refusal_reasons: [] } }) };
}
async function install(page: Page, lang = "en", controls: { fail?: boolean; unverified?: boolean; wrongRoot?: boolean } = {}) {
  await page.addInitScript(language => { localStorage.setItem("mm.lang", language); }, lang);
  await page.route("**/data/*.json", async route => {
    const symbol = new URL(route.request().url()).pathname.split("/").at(-1)!.replace(/\.json$/, "");
    if (controls.fail && symbol === "NVDA") return route.fulfill({ status: 503, json: { error: "synthetic source outage" } });
    if (["NVDA", "AMD", "AVGO", "SPY", "QQQ"].includes(symbol)) return route.fulfill({ json: fixture(symbol, controls.unverified) });
    return route.fallback();
  });
  await page.route("**/api/sector-intelligence?**", route => route.fulfill({ json: { receipt: { source: "confluence", status: "ready", asOf: "2026-10-16", stale: false }, data: { ok: true, asof: "2026-10-16", sectors: [], subsectors: [{ key: "semis", kind: "subsector", label: "Semiconductors", sector: "Technology", members: ["NVDA", "AMD", "AVGO"].map(ticker => ({ ticker })) }] } } }));
  await page.route("**/api/returns/basket", async route => {
    const input = route.request().postDataJSON();
    const result = buildCurrentBasket(input.symbols.map((s: string) => decodeReturnSeries(s, fixture(s))), input.horizon, input.membershipAsOf);
    return route.fulfill({ json: result });
  });
  await page.route("**/api/returns/forecast?**", route => route.fulfill({ status: 404, json: { schema: "returns.forecast.v1", status: "abstain", reasons: ["QUALIFIED_FORECAST_NOT_PUBLISHED"] } }));
  await page.route("**/api/flow?**", route => {
    const f = new URL(route.request().url()).searchParams.get("f") || "", parts = f.split(":"), root = controls.wrongRoot ? "SPY" : parts[1];
    if (f.startsWith("gex")) return route.fulfill({ json: { schema: "options_hub.gex/v1", root, asof: parts[2] || DAYS.at(-1), net_gex_bn: -1.24, gamma_flip: 180, call_wall: 200, put_wall: 165, convention: "Synthetic fixture · illustrative estimated dealer convention" } });
    if (f.startsWith("ticker:")) return route.fulfill({ json: { schema: "live_flow.ticker/v1", root, asof: `${DAYS.at(-1)}T20:00:00Z`, day: { gross: 19472467, n_events: 243, call_share: 0.481 } } });
    return route.fulfill({ status: 404, json: { error: "not a returns fixture" } });
  });
}
async function capture(page: Page, name: string, project: string) {
  const dir = path.join(process.cwd(), "docs/pr-crops/returns-intelligence"); mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${project}-${name}.png`);
  await page.screenshot({ path: file });
  const sources = ["components/fin/ReturnsPage.tsx", "components/fin/returns/ReturnPathChart.tsx", "components/fin/returns/SessionCalendar.tsx", "components/fin/returns/ReturnsEvidencePanel.tsx", "components/fin/returns/ReturnsWorkspace.module.css", "lib/returnsIntelligence.ts", "lib/returnsEvidence.ts", "lib/terminalMaterialization.ts", "components/fin/returns/returnsCopy.ts", "components/TerminalShell.tsx", "components/fin/MegaPane.tsx"];
  writeFileSync(file.replace(/\.png$/, ".json"), JSON.stringify({ kind: "synthetic_fixture_browser_evidence", production: false, paperApplied: false, viewport: page.viewportSize(), url: page.url(), screenshotSha256: createHash("sha256").update(readFileSync(file)).digest("hex"), sourceSha256: Object.fromEntries(sources.map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])) }, null, 2));
}

for (const lang of ["en", "zh"]) test(`stock path, calendar and responsive layout (${lang})`, async ({ page }, info) => {
  await install(page, lang); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/analysis?symbol=NVDA&page=returns", { waitUntil: "domcontentloaded" });
  const root = page.getByTestId("returns-workspace");
  await expect(root.getByRole("heading", { name: lang === "en" ? "Returns intelligence" : "回报分析", exact: true })).toBeVisible();
  await expect(root.getByText(lang === "en" ? "Illustrative test data" : "示例测试数据", { exact: true })).toBeVisible();
  await expect(root.getByRole("img", { name: lang === "en" ? "NVDA Performance" : "NVDA 累计回报", exact: true })).toBeVisible();
  await expect.poll(() => root.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  await capture(page, `stock-${lang}`, info.project.name);
  await root.getByRole("button", { name: lang === "en" ? "Relative" : "相对表现", exact: true }).click();
  await expect(root.getByRole("img", { name: lang === "en" ? "NVDA Relative" : "NVDA 相对表现", exact: true })).toBeVisible();
  const chart = root.getByRole("group", { name: lang === "en" ? /^Return chart\./ : /^回报图。/ });
  await chart.focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
  const selected = root.locator('button[aria-pressed="true"][aria-label^="2026-"]');
  await expect(selected).toHaveCount(1);
  await root.getByRole("button", { name: lang === "en" ? "Performance" : "累计回报", exact: true }).click();
  const calendar = root.getByRole("group", { name: lang === "en" ? "Session calendar" : "交易日历", exact: true });
  const picked = calendar.locator("button:not(:disabled)").first();
  const pickedDay = (await picked.getAttribute("aria-label"))!.slice(0, 10);
  await picked.click();
  const pickedLabel = new Date(pickedDay + "T12:00:00Z").toLocaleDateString(lang === "en" ? "en-US" : "zh-CN", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  await expect(root.locator('[class*="chartReadout"]')).toContainText(pickedLabel);
  await calendar.scrollIntoViewIfNeeded();
  await capture(page, `calendar-${lang}`, info.project.name);
  expect(errors).toEqual([]);
});

test("source basket preserves membership and opens constituent Returns", async ({ page }, info) => {
  await install(page); await page.goto("/analysis?symbol=NVDA&page=returns", { waitUntil: "domcontentloaded" });
  const root = page.getByTestId("returns-workspace"); await root.getByRole("button", { name: "Sector / theme basket", exact: true }).click();
  await expect(root.getByRole("option", { name: "Semiconductors · 3" })).toBeAttached();
  await root.getByLabel("Source group", { exact: true }).selectOption("semis");
  await expect(root.getByRole("heading", { name: "Members · 3", exact: true })).toBeVisible();
  await expect(root.getByText("Current members · reconstructed history", { exact: true })).toBeVisible();
  await expect(root.getByRole("link", { name: "AMD ↗", exact: true })).toHaveAttribute("href", /symbol=AMD&page=returns/);
  await expect.poll(() => root.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  await root.getByRole("heading", { name: "Members · 3", exact: true }).scrollIntoViewIfNeeded();
  await capture(page, "basket-en", info.project.name);
});

test("an unavailable read is recoverable and an unverified basis stays unqualified", async ({ page }) => {
  const controls = { fail: true, unverified: true }; await install(page, "en", controls);
  await page.goto("/analysis?symbol=NVDA&page=returns", { waitUntil: "domcontentloaded" });
  const root = page.getByTestId("returns-workspace"); await expect(root.getByRole("heading", { name: "History could not be loaded.", exact: true })).toBeVisible();
  controls.fail = false; await root.getByRole("button", { name: "Retry", exact: true }).last().click();
  await expect(root.getByText("Adjustment unverified", { exact: true })).toBeVisible();
  await expect(root.getByRole("heading", { name: "State not qualified", exact: true })).toBeVisible();
  await expect(root.getByRole("img", { name: "NVDA Performance", exact: true })).toBeVisible();
});

test("wrong-root options cannot appear as matching evidence", async ({ page }) => {
  await install(page, "en", { wrongRoot: true }); await page.goto("/analysis?symbol=NVDA&page=returns", { waitUntil: "domcontentloaded" });
  const panel = page.getByRole("region", { name: "Options context", exact: true });
  await expect(panel.getByText("The returned evidence does not match this symbol and session.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Net GEX estimate", { exact: true })).toHaveCount(0);
});

test("browser verifies the owner golden rows before qualifying the history and rejects changed content", async ({ page }) => {
  // The synthetic owner golden subject is never installed into public production data.
  const golden = JSON.parse(readFileSync(path.join(process.cwd(), "lib/__tests__/terminalMaterialization.fixture.json"), "utf8"));
  let changed = false;
  await install(page);
  await page.route("**/data/ZQXA.json", route => {
    const document = structuredClone(golden.document);
    if (changed) document.bars[1][2] += 1; // valid OHLC, different materialization
    return route.fulfill({ json: document });
  });
  await page.goto("/analysis?symbol=ZQXA&page=returns", { waitUntil: "domcontentloaded" });
  const root = page.getByTestId("returns-workspace");
  await expect(root.getByText("Vendor total-return proxy", { exact: true })).toBeVisible();
  await expect(root.getByText("Adjustment unverified", { exact: true })).toHaveCount(0);
  changed = true;
  await root.getByRole("button", { name: "Retry", exact: true }).first().click();
  await expect(root.getByText("Price basis needs repair", { exact: true }).first()).toBeVisible();
  await expect(root.getByText("Vendor total-return proxy", { exact: true })).toHaveCount(0);
});

test("an unavailable benchmark remains explicit while absolute analysis stays usable", async ({ page }) => {
  await install(page);
  await page.route("**/data/SPY.json", route => route.fulfill({ status: 404, json: { error: "synthetic absent benchmark" } }));
  await page.goto("/analysis?symbol=NVDA&page=returns", { waitUntil: "domcontentloaded" });
  const root = page.getByTestId("returns-workspace");
  await expect(root.getByRole("img", { name: "NVDA Performance", exact: true })).toBeVisible();
  await expect(root.getByText(/SPY · Benchmark comparison unavailable/)).toBeVisible();
  await root.getByRole("button", { name: "Relative", exact: true }).click();
  await expect(root.getByText("A comparison needs matching dates and price bases.", { exact: true })).toBeVisible();
});
