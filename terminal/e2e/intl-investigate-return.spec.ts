import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { SHELL, LEGACY, installRealNextLegacyTransport } from "./fixtures/real-next-legacy-transport";
import { readRetainedLegacyFixture } from "./fixtures/retained-legacy-fixture";

test.skip(process.env.MMX_SHARED_SHELL !== "1", "Incumbent Shared Shell beta fixture opt-in required");
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
type SourceCase = { selection: { view: string; market: string; pins: string[]; horizon: string; basis: string; field: string }; canonical: string; relative: string; identity: { context: string; generation: string; fingerprint: string; field: string } };

test("selected Macro/Risk Investigate opens truthful native preview then authored Return restores context", async ({ page, context, baseURL }, info) => {
  const directory = path.join(__dirname, "fixtures/intl-return-page-reviewed-query");
  const sourceBytes = readFileSync(path.join(directory, "actual-source-links.json"));
  expect(digest(sourceBytes)).toBe("cb650323676961c963f6aec5b7c1bcf7a8c7f7d408de47aa0f0c94fa41a4198a");
  const source = JSON.parse(sourceBytes.toString()) as { rows: SourceCase[] };
  expect(source.rows).toHaveLength(2);
  const retained = readRetainedLegacyFixture(path.join(directory, "fixture.json.gz"), "f967ca83d7d239506fb290b2bc92a91bb6931d3c406a5dfe96add8cfd785a9ce");
  expect(digest(retained.assets.get("/intl_workspace.js")!)).toBe("e5e3a76ec1277f80266a153829360e4e8cc40e277d5250e806ecb7d3d89458aa");
  const observations = await installRealNextLegacyTransport({ page, context, baseURL: baseURL!, canonicalChildPath: "/intl.html", html: retained.html, assets: retained.assets });
  const states: unknown[] = [];
  try {
    for (const row of source.rows) {
      // Begin at the actual selected source, never at an invented Analysis URL.
      await page.goto(SHELL + row.canonical, { waitUntil: "domcontentloaded" });
      const shell = page.locator('[data-shared-shell="beta"]');
      await expect(shell).toBeVisible();
      await expect(page.locator('[data-shared-shell-phase="ready"]')).toBeVisible();
      const frame = page.frameLocator("iframe[data-shared-shell-frame]");
      const panel = frame.locator(`[data-im-panel][data-view="${row.selection.view}"][data-horizon="${row.selection.horizon}"][data-basis="${row.selection.basis}"]`);
      await expect(panel).toBeVisible();
      const action = panel.locator(`[data-im-investigate][data-im-investigation-field="${row.identity.field}"]`);
      await expect(action).toHaveCount(1); await expect(action).toBeVisible();
      for (const key of ["context", "generation", "fingerprint", "field"] as const) await expect(action).toHaveAttribute(`data-im-investigation-${key}`, row.identity[key]);
      const actualHref = new URL((await action.getAttribute("href"))!, LEGACY + row.canonical);
      expect(actualHref.pathname + actualHref.search).toBe(row.relative);
      await page.evaluate(() => { (window as Window & { __s28JoinedDocument?: string }).__s28JoinedDocument = "real-source-investigate-return"; });
      await action.click(); // Real emitted producer -> bridge -> LegacyPageHost -> Next router.
      await expect(page).toHaveURL(SHELL + row.relative);
      expect(await page.evaluate(() => (window as Window & { __s28JoinedDocument?: string }).__s28JoinedDocument)).toBe("real-source-investigate-return");
      await expect(shell).toBeVisible();
      await expect(page.getByRole("heading", { name: "Start research from selected International evidence", exact: true })).toBeVisible();
      await expect(page.getByText("This local preview cannot verify source access. Return to International Markets to continue.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Use this International selection", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Start new research", exact: true })).toBeEnabled();
      const current = new URL(page.url());
      for (const key of ["context", "generation", "fingerprint", "field"] as const) expect(current.searchParams.get("intl_" + key)).toBe(row.identity[key]);
      const back = page.getByRole("link", { name: "Return to International Markets", exact: true });
      await expect(back).toHaveAttribute("href", row.canonical);
      await page.screenshot({ path: info.outputPath(`joined-${row.selection.view}-preview.png`) });
      await back.click();
      await expect(page).toHaveURL(SHELL + row.canonical);
      expect(await page.evaluate(() => (window as Window & { __s28JoinedDocument?: string }).__s28JoinedDocument)).toBe("real-source-investigate-return");
      await expect(shell).toBeVisible(); await expect(page.locator('[data-shared-shell-phase="ready"]')).toBeVisible();
      const workspace = frame.locator('[data-im-workspace][data-im-enhanced="true"]');
      await expect(workspace).toBeVisible();
      const state = await workspace.evaluate(root => {
        const api = (window as Window & { IntlWorkspace?: { mountIntlWorkspace: (root: Element, config: unknown) => { getState: () => unknown } } }).IntlWorkspace;
        if (!api) throw new Error("Actual Intl controller unavailable");
        return api.mountIntlWorkspace(root, JSON.parse(root.querySelector("[data-im-config]")!.textContent!)).getState();
      });
      expect(state).toMatchObject({ view: row.selection.view, selected_market: row.selection.market, compare_markets: row.selection.pins, horizon: row.selection.horizon, currency_basis: row.selection.basis, return_basis: "price" });
      await expect(panel).toBeVisible(); states.push({ source: row.relative, canonical: row.canonical, state, previewSourceAccess: "unavailable" });
      await page.screenshot({ path: info.outputPath(`joined-${row.selection.view}-returned.png`) });
    }
    expect(observations.baselines).toEqual([]); expect(observations.mutations).toEqual([]); expect(observations.pageErrors).toEqual([]);
    expect(observations.blockedTelemetryAttempts.every(item => ["shell", "legacy"].includes(item.origin) && item.method === "POST" && item.path === "/api/collect" && item.disposition === "blocked-before-transport")).toBe(true);
  } finally {
    await info.attach("real-source-investigate-return", { body: JSON.stringify({ scope: "Real source DOM Investigate/bridge/Next preview/Return; controlled retained fixture, source access explicitly unavailable; no auth/baseline/Save/current feed/Paper claim", observations, states }, null, 2), contentType: "application/json" });
  }
});
