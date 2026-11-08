import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import path from "node:path";
import { SHELL, installRealNextLegacyTransport } from "./fixtures/real-next-legacy-transport";
import { readRetainedLegacyFixture } from "./fixtures/retained-legacy-fixture";

// Same real Next/AppShell fixture seam as Intl Return. Date selection, Compare,
// Scenario and Return use actual controls; no injected date state or fake router.
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Incumbent Shared Shell fixture opt-in required");
if (process.env.MMX_SHARED_SHELL === "1" && !process.env.CI && process.env.TERMINAL_VISUAL_EVIDENCE_OPERATION === undefined) {
  throw new Error("Use the incumbent fresh-owned server harness; never reuse an unrelated local Next server.");
}
const BUNDLE_SHA = "725e82f1a98f62e22e6d73a16973f75f224805cdc8e64095bfef16d93d9b6067";
const RAW_SHA = "8eee0e38f96db1b4e7868b75a25b641aee3138391adc52f2351ca6496165f95c";
const HTML_SHA = "2756b62267ade84f0316c4f3e93847fa5fd4cce9e2ee6e6004fb2d3f1de740fb";
const dates = ["2026-01-01T00:00:00+09:00", "2026-01-03T00:00:00.123456789+09:00"];
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");

test("History accepts real date intent, compares exact reconstruction and returns with supported context", async ({ page, context, baseURL }, info) => {
  const retained = readRetainedLegacyFixture(path.join(__dirname, "fixtures/intl-history-page-reviewed-query/fixture.json.gz"), BUNDLE_SHA);
  expect(retained.provenance.macro_source).toBe("389c3ac3442547b0f38a81e7922f9581d25b1e5b");
  expect(retained.provenance.reviewed_controller_sha256).toBe("e5e3a76ec1277f80266a153829360e4e8cc40e277d5250e806ecb7d3d89458aa");
  expect(digest(retained.rawJinja)).toBe(RAW_SHA);
  expect(digest(retained.html)).toBe(HTML_SHA);
  expect(digest(retained.assets.get("/intl_workspace.js")!)).toBe("e5e3a76ec1277f80266a153829360e4e8cc40e277d5250e806ecb7d3d89458aa");
  const observations = await installRealNextLegacyTransport({ page, context, baseURL: baseURL!, canonicalChildPath: "/intl.html", html: retained.html, assets: retained.assets });
  try {
    await page.goto(SHELL + "/intl.html?view=overview&market=JP&pins=JP,KR&horizon=3m&basis=local&return_basis=price&group=", { waitUntil: "domcontentloaded" });
    const shell = page.locator('[data-shared-shell="beta"]');
    await expect(shell).toBeVisible();
    await expect(page.locator('[data-shared-shell-phase="ready"]')).toBeVisible();
    const frame = page.frameLocator("iframe[data-shared-shell-frame]");
    const workspace = frame.locator('[data-im-workspace][data-im-enhanced="true"]');
    await expect(workspace).toBeVisible();
    async function chooseHistory() {
      const button = workspace.locator('button[data-im-action="set_view"][data-im-view="history"]');
      if (await button.isVisible()) await button.click();
      else await workspace.locator('select[data-im-action="set_view"]').selectOption("history");
    }
    async function parentContext(view: string) {
      await expect.poll(() => {
        const url = new URL(page.url());
        return { origin: url.origin, path: url.pathname, view: url.searchParams.get("view"), market: url.searchParams.get("market"), pins: url.searchParams.get("pins"), horizon: url.searchParams.get("horizon"), basis: url.searchParams.get("basis"), returns: url.searchParams.get("return_basis") };
      }).toEqual({ origin: SHELL, path: "/intl.html", view, market: "JP", pins: "JP,KR", horizon: "3m", basis: "local", returns: "price" });
      await expect(shell).toBeVisible();
    }
    await chooseHistory();
    await parentContext("history");
    const panel = frame.locator('[data-im-history-panel]');
    const market = panel.locator('[data-im-history-market="JP"]');
    await expect(market).toBeVisible();
    const left = market.locator('[data-im-snapshot-date="left"]');
    const right = market.locator('[data-im-snapshot-date="right"]');
    const result = market.locator('[data-im-snapshot-result]');
    await expect(left).toHaveValue(""); await expect(right).toHaveValue("");
    await expect(result).toBeHidden();
    await market.locator('[data-im-snapshot-year="left"]').selectOption("2026");
    await left.selectOption(dates[0]);
    await market.locator('[data-im-snapshot-year="right"]').selectOption("2026");
    await right.selectOption(dates[1]);
    await expect(result).toBeHidden(); // A selection is not a comparison yet.
    await market.locator('[data-im-snapshot-form] button[type="submit"]').click();
    await expect(result).toBeVisible();
    await expect(result.locator('[data-im-snapshot-at="left"]')).toHaveText(dates[0]);
    await expect(result.locator('[data-im-snapshot-at="right"]')).toHaveText(dates[1]);
    await expect(result.locator('[data-im-snapshot-score="left-growth_score"]')).toHaveText("0.4375");
    await expect(result.locator('[data-im-snapshot-score="left-inflation_score"]')).toHaveText("-1.25");
    await expect(result.locator('[data-im-snapshot-score="right-growth_score"]')).toHaveText("19");
    await expect(result.locator('[data-im-snapshot-score="right-inflation_score"]')).toHaveText("23");
    await page.screenshot({ path: info.outputPath("history-authored-comparison.png") });
    await result.locator('button[data-im-scenario-action="set_tab"]').click();
    const local = panel.locator('[data-im-scenario-field="local"]');
    const fx = panel.locator('[data-im-scenario-field="fx"]');
    await expect(local).toHaveValue(""); await expect(fx).toHaveValue("");
    await local.fill("7"); // User assumption; never imported classifier score.
    await panel.locator('[data-im-history-tabs] button[data-im-scenario-tab="history"]').click();
    await expect(result).toBeVisible();
    await expect(left).toHaveValue(dates[0]); await expect(right).toHaveValue(dates[1]);
    await panel.locator('footer button[data-im-view="overview"]').click();
    await parentContext("overview");
    await chooseHistory();
    await parentContext("history");
    await expect(left).toHaveValue(dates[0]); await expect(right).toHaveValue(dates[1]);
    await expect(result).toBeVisible();
    await panel.locator('[data-im-history-tabs] button[data-im-scenario-tab="scenario"]').click();
    await expect(local).toHaveValue("7"); await expect(fx).toHaveValue("");
    await parentContext("history");
    await page.screenshot({ path: info.outputPath("history-return-context.png") });
    expect(observations.baselines).toEqual([]);
    expect(observations.mutations).toEqual([]);
    expect(observations.pageErrors).toEqual([]);
  } finally {
    await info.attach("real-next-history-date-intent", { body: JSON.stringify({ scope: "Real Next/AppShell/bridge plus actual repaired full-Jinja consumer; controlled existing History fixture, no live receipt/auth/feed/engine/OPEN", dates, observations }, null, 2), contentType: "application/json" });
  }
});
