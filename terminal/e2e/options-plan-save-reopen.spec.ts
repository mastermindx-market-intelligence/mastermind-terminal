import { expect, test } from "@playwright/test";
import { fixtureAuthSetup } from "./fixtures/investigation-auth";
import { response as payoffResponse } from "../lib/__tests__/fixtures/optionsPlanPayoff";
import type { InvestigationCommand } from "../lib/investigations";

// Actual Options -> exact shortlist -> native Investigation mount. Only local
// transport responses are fixtures; no production Save, SQL or rights claim.
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });
for (const lang of ["en", "zh"] as const) {
  test(`whole Plan explicit transfer, Save, exact reopen and recalculation (${lang})`, async ({ page, baseURL }, info) => {
    const zh = lang === "zh", t = (en: string, cn: string) => zh ? cn : en;
    const auth = await fixtureAuthSetup(page, baseURL!);
    await page.addInitScript(l => localStorage.setItem("mm.lang", l), lang);
    const stamp = "2026-10-24T08:00:00.000Z", sourceAsOf = "2026-10-23T20:00:00Z";
    const row = { root: "SPY", right: "C", exp: "2026-10-30", strike: 765, oi: 100, oi_prev: 80, d_oi: 20, mid: 3 };
    await page.route("**/api/flow?f=oi", route => route.fulfill({ json: { schema: "options_hub.oi_movers/v1", asof: sourceAsOf, movers: [row] } }));
    await page.route("**/api/flow?f=hot", route => route.fulfill({ json: { schema: "options_hub.hot/v1", asof: sourceAsOf, by_premium: [], by_volume: [] } }));
    await page.route("**/api/brain/me", route => route.fulfill({ json: { tier: "guest", quotas: {} } }));
    const commands: InvestigationCommand[] = [], forbidden: string[] = [], calculations: unknown[] = [], reads: URL[] = [];
    let saved: InvestigationCommand | undefined;
    await page.route("**/api/investigations{,?*}", async route => {
      const request = route.request(), u = new URL(request.url());
      if (request.method() === "POST") {
        saved = request.postDataJSON() as InvestigationCommand; commands.push(saved);
        await route.fulfill({ json: { status: "committed", id: saved.id, operation_id: saved.operation_id, revision: 1, lifecycle: "active", manifest: saved.manifest, committed_at: stamp,
          investigation_id: saved.id, revision_id: "30000000-0000-4000-8000-000000000001", sequence: 1, parent_revision_id: null, author_ref: auth.sub, recorded_at: stamp, manifest_digest: "a".repeat(64) } });
      } else if (request.method() === "GET") {
        reads.push(u);
        await route.fulfill({ json: u.searchParams.has("id") && saved ? { status: "found", id: saved.id, revision: 1, current_revision: 2, lifecycle: "active", manifest: saved.manifest, committed_at: stamp, layouts: [] }
          : { status: "listed", items: saved ? [{ id: saved.id, revision: 1, lifecycle: "active", title: saved.manifest.intent.title, question: saved.manifest.intent.question, updated_at: stamp }] : [] } });
      } else { forbidden.push(request.method() + " " + u.pathname); await route.fulfill({ status: 500, json: {} }); }
    });
    await page.route("**/api/options/plan/expiry", async route => {
      const request = route.request().postDataJSON(); calculations.push(request);
      await route.fulfill({ json: payoffResponse(request) });
    });
    page.on("request", request => {
      const u = new URL(request.url());
      if (request.method() !== "GET" && /\/api\/(?:layouts|alerts|watchlist|theses|brain\/command|__e2e__\/supabase\/auth)/.test(u.pathname)) forbidden.push(request.method() + " " + u.pathname);
    });
    const url = `${baseURL}/options?tab=screener`;
    await page.goto(url);
    await page.getByRole("button", { name: t("ΔOI Builds", "持仓增长"), exact: true }).click();
    // Pin only after the real verified lifecycle has projected ready. Its first
    // pending -> ready transition intentionally retires any earlier selection.
    await expect(page.getByRole("button", { name: t("Open saved research", "打开已保存研究"), exact: true })).toBeEnabled();
    await page.locator("[data-contract-pin]").click();
    await page.getByRole("button", { name: t("Plan from pinned contracts", "用固定合约创建计划"), exact: true }).click();
    const draft = page.getByTestId("shortlist-plan-path").getByTestId("options-plan-draft").first();
    await draft.getByRole("combobox", { name: t("Your assumed side", "假设方向"), exact: true }).selectOption("buy");
    await draft.getByLabel(t("Your assumed quantity — contracts", "假设数量——张"), { exact: true }).fill("1");
    await draft.getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true }).fill("2");
    await draft.getByRole("combobox", { name: t("Assumed premium denomination", "权利金假设币种"), exact: true }).selectOption("USD");
    expect(commands).toHaveLength(0); expect(calculations).toHaveLength(0);
    await page.getByRole("button", { name: t("Open saved research", "打开已保存研究"), exact: true }).click();
    const add = page.getByRole("button", { name: t("Add Plan inputs to new research", "将计划输入添加到新研究"), exact: true });
    await expect(add).toBeDisabled();
    await page.getByRole("button", { name: t("Start new research", "开始新研究"), exact: true }).click();
    await add.click(); expect(commands).toHaveLength(0); expect(calculations).toHaveLength(0);
    // Later edits are independent of the native admitted copy.
    await draft.getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true }).fill("9");
    await page.getByLabel(t("Title", "标题"), { exact: true }).fill("Whole Plan retained");
    await page.getByLabel(t("Research question", "研究问题"), { exact: true }).fill("Preserve exact inputs and explicit recalculation");
    await page.getByRole("button", { name: t("Save research", "保存研究"), exact: true }).click();
    await expect(page.getByRole("button", { name: t("Open saved Plan inputs", "打开已保存计划输入"), exact: true })).toBeEnabled();
    expect(commands).toHaveLength(1); const original = structuredClone(commands[0].manifest.option_plan!);
    expect(original.legs[0].assumptions.entry?.premium_per_unit).toBe(2);
    expect(original.legs[0].snapshot.row).toEqual({ ...row, preset: "doi" });
    expect(original.legs[0].snapshot.asofRaw).toBe(sourceAsOf);
    expect(commands[0]).toMatchObject({ action: "create", expected_revision: 0, manifest: { schema: "investigation_manifest.v3" } });
    await page.getByRole("button", { name: t("Open saved Plan inputs", "打开已保存计划输入"), exact: true }).click();
    const opened = page.getByTestId("saved-plan-inputs");
    await expect(opened).toHaveAttribute("data-investigation-id", commands[0].id);
    await expect(opened).toHaveAttribute("data-investigation-revision", "1");
    await expect(opened.getByLabel(t("Your entry assumption — premium per unit", "假设入场价——每单位权利金"), { exact: true })).toHaveValue("2");
    expect(calculations).toHaveLength(0);
    await opened.getByRole("button", { name: t("Calculate expiry payoff", "计算到期损益"), exact: true }).click();
    await expect(opened.getByTestId("plan-expiry-chart")).toBeVisible();
    expect(calculations).toHaveLength(1); expect(commands).toHaveLength(1);
    expect(saved?.manifest.option_plan).toEqual(original); expect(forbidden).toEqual([]);
    expect(page.url()).toBe(url);
    await opened.screenshot({ path: info.outputPath("saved-plan-recalculation.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // Reload exact acknowledged revision through the existing native route.
    await page.goto(`${baseURL}/analysis?view=investigations&investigation=${commands[0].id}&revision=1`);
    await expect(page.getByText("Whole Plan retained", { exact: true }).first()).toBeVisible();
    expect(reads.some(u => u.searchParams.get("id") === commands[0].id && u.searchParams.get("revision") === "1")).toBe(true);
    expect(commands).toHaveLength(1); expect(calculations).toHaveLength(1); expect(forbidden).toEqual([]);
  });
}
