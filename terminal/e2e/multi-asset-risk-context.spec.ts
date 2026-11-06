import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { MARKET_RISK_NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "../lib/__tests__/marketRiskFixture";

// This is a synthetic transport/visual contract, NOT authenticated production,
// independently verified source history, dealer pressure, or trade authority.
test.setTimeout(90_000);

import syntheticContext from "../lib/__tests__/fixtures/multiAssetDaily.synthetic.json";
import staleContext from "../lib/__tests__/fixtures/multiAssetDaily.stale.synthetic.json";
function multiAssetFixture() {
  const x = structuredClone(syntheticContext);
  return { ...x, reasons: x.reasons as string[],
    rows: x.rows.map(row => ({ ...row, reasons: row.reasons as string[] })) };
}
type SourceMode = "qualified" | "stale" | "forged" | "unauthorized";
function bridgedVariants(): Record<SourceMode, Record<string, unknown>> {
  const contexts = { qualified: multiAssetFixture(), stale: structuredClone(staleContext),
    forged: multiAssetFixture(), unauthorized: multiAssetFixture() };
  const forged = contexts.forged.rows.find(row => row.instrument_id === "SHY")!;
  forged.label_en = "Cash - risk free"; forged.asset_class = "cash";
  contexts.unauthorized.authority.can_trade = true;
  const envelopes = Object.fromEntries(Object.entries(contexts).map(([key, context]) =>
    [key, { ...riskEnvelopeFixture(), multi_asset_context: context }]));
  const code = ["import json,sys", "from datetime import datetime",
    "from ingest.pull_macro_risk import build_market_risk", "d=json.load(sys.stdin)",
    "now=datetime.fromisoformat(d['now'].replace('Z','+00:00'))",
    "print(json.dumps({k:build_market_risk(d['source'], now=now, risk_envelope=v) for k,v in d['envelopes'].items()}, allow_nan=False))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", code], { cwd: path.resolve(process.cwd(), ".."),
    input: JSON.stringify({ source: marketRiskSourceFixture(), envelopes, now: new Date(MARKET_RISK_NOW).toISOString() }),
    encoding: "utf8", timeout: 15_000 })) as Record<SourceMode, Record<string, unknown>>;
}
for (const [lang, theme] of [["en", "light"], ["en", "dark"], ["zh", "light"], ["zh", "dark"]] as const) {
  test(`optional cross-asset source respects original risk and degraded semantics / ${lang} / ${theme}`,
    async ({ page }, testInfo) => {
      await page.addInitScript(({ lang, theme, now }) => {
        localStorage.setItem("mm.lang", lang);
        localStorage.setItem("theme", theme);
        localStorage.setItem("theme_auto", "0");
        Date.now = () => now;
        const flag = window as Window & { __mmResponsiveVisualReady?: boolean };
        flag.__mmResponsiveVisualReady = false;
        window.addEventListener("mm:terminal-visual-ready",
          () => { flag.__mmResponsiveVisualReady = true; }, { once: true });
      }, { lang, theme, now: MARKET_RISK_NOW });
      let mode: SourceMode = "qualified";
      const artifacts = bridgedVariants();
      await page.route("**/data/market_risk.json", route => route.fulfill({ json: artifacts[mode] }));
      await page.goto("/terminal?symbol=NVDA");
      await expect.poll(() => page.evaluate(() =>
        Boolean((window as Window & { __mmResponsiveVisualReady?: boolean }).__mmResponsiveVisualReady)),
        { timeout: 20_000, message: "the genuine Terminal launcher should hydrate" }).toBe(true);
      // Explicit visual-fixture input, not an account-preference or auth test.
      // Verify actual CSS mode instead of merely labelling a dark capture light.
      await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const launcher = page.getByTestId("intelligence-launcher");
      await expect(async () => {
        if (await launcher.getAttribute("aria-expanded") !== "true") await launcher.click();
        await expect(launcher).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      const chip = page.getByTestId("market-risk-chip");
      const summary = chip.locator("summary");
      await expect(summary).toContainText("51/100");
      await summary.focus();
      await page.keyboard.press("Enter");
      const details = chip.getByTestId("market-risk-details");
      await expect(details).toBeVisible();
      const em = lang === "zh" ? "新兴市场股票（EEM）" : "Emerging-market equities (EEM)";
      await expect(details).toContainText(em);
      await expect(details).toContainText(lang === "zh" ? "绝对收益未上涨" : "not an absolute gain");
      await expect(details).toContainText(lang === "zh" ? "不是实时资金流" : "Not live fund flow");
      await expect(details).toContainText(lang === "zh" ? "-2.00%" : "-2.00%");
      await expect(summary).toContainText("51/100");
      await expect(details).not.toContainText(lang === "zh" ? "建议买入" : "should buy");
      expect(await chip.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await chip.screenshot({ path: testInfo.outputPath(`cross-asset-${testInfo.project.name}-${lang}-${theme}.png`) });

      mode = "stale";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(details).toContainText(lang === "zh" ? "已过期" : "stale");
      await expect(details).toContainText("2026-10-06");
      await expect(summary).toContainText("51/100");

      mode = "forged";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(details).not.toContainText(em);
      await expect(details).not.toContainText("Cash - risk free");
      await expect(summary).toContainText("51/100");

      mode = "unauthorized";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(details).not.toContainText(em);
      await expect(summary).toContainText("51/100");
      await expect(details).toContainText(lang === "zh" ? "没有生效的风险政策" : "No risk policy is active");
      await chip.screenshot({ path: testInfo.outputPath(`cross-asset-rejected-${testInfo.project.name}-${lang}-${theme}.png`) });
    });
}
