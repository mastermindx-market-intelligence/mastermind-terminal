/** Ordinary-CI transport fixtures only; no React/Next/component/route replacement.
 * Reuses signed SDK cookies, current public JWKS, Sector archive and Prophet fixture.
 * Positive execution additionally needs the existing fixture owner to enroll the
 * real SDK GET user transport. This file does NOT implement an auth authority.
 */
import { createHash } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { nativeEntranceAuthSetup } from "./native-intelligence-auth";
import nativeConfig from "../../playwright.intelligence.config";
import { sectorFixture } from "./sector-company-v3";
import { requireNativeCatalog, requireOwnedFixtureAuthority, isBlockedNativeAppearanceIntent } from "./native-intelligence-contract";
import { sharedShellCatalog, sharedShellDirectory } from "../../lib/sharedShellRoutes";
import prophetFrame from "../../test-fixtures/prophet_stale_frame_fixture.json";

export const SOURCE_CLOCKS = { macro: "2026-10-30", cycles: "2026-10-29", prophet: "2026-10-28",
  published: "2026-11-02", price: "2026-09-25", plan: "2026-09-26" } as const;
export const compactMacro = {
  schema: "mastermind.macro_command_read.v1", state: "partial",
  source: { served_root_qualified: true, manifest_generated_at: "2099-01-01T00:00:00Z", manifest_sha256: "d".repeat(64), composed_at: "2099-01-01T00:00:00Z" },
  read: { as_of: SOURCE_CLOCKS.macro, as_of_display: null, as_of_meaning: null, omitted: true,
    clauses: [{ topic: { en: "Liquidity", zh: "流动性" }, predicate: { en: "is mixed", zh: "不均衡" }, punct: { en: ".", zh: "。" }, section: "liquidity" }] },
  strip: [], coverage: { available: 2, total: 5 },
  sections: [{ id: "liquidity", label: { en: "Liquidity", zh: "流动性" }, href: "/macro_monetary.html#liquidity" }], workspaces: [],
};
export const compactCycles = { schema: "mmx.intelligence.cycles.v1", sourceAsOf: SOURCE_CLOCKS.cycles,
  stale: true, benchmark: "SPY", coverage: 1,
  rows: [{ id: "xlk", ticker: "XLK", name: "Technology", nameZh: "科技", phase: "Downturn", position: 41, model: "published" }] };
export const compactProphet = { schema: "mmx.intelligence.prophet.v1", publishedAt: SOURCE_CLOCKS.published,
  sourceAsOf: SOURCE_CLOCKS.prophet, sourceUnknown: false, sourceDelayed: true, mixedVintage: true, stale: true,
  openCount: 1, previewLimit: 3,
  plans: [{ id: "NVDA-20260917", symbol: "NVDA", phase: "triggered_pre_t1", priceAsOf: SOURCE_CLOCKS.price, planAsOf: SOURCE_CLOCKS.plan }] };

export async function prepareNativeEntrance(page: Page, baseURL: string, lang: "en" | "zh") {
  requireNativeCatalog(sharedShellCatalog); // fail, never skip or hand-enroll a route
  for (const href of ["/intelligence", "/prophet", "/sectors"]) expect(
    sharedShellDirectory.some(page => page.href === href), `I3 canonical directory metadata for ${href}`,
  ).toBe(true);
  const server = Array.isArray(nativeConfig.webServer) ? nativeConfig.webServer[0] : nativeConfig.webServer;
  const origin = requireOwnedFixtureAuthority(baseURL, server?.env?.BILLING_GATEWAY_BASE);
  expect(server?.env?.MMX_SHARED_SHELL, "explicit ordinary-CI Shared Shell opt-in").toBe("1");
  const auth = await nativeEntranceAuthSetup(page, origin);
  // The new server pages AND browser lifetime use getUser, not claims-only.
  // Missing/disabled finite transport must fail here, never make readShellMember
  // trust a cookie, a browser-only mock or local preview.
  const userRead = await page.request.get(`${origin}/api/__e2e__/supabase/auth/v1/user`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  expect(userRead.status(), "NATIVE_MEMBER_FIXTURE_REQUIRED: signed fixture user GET must be enrolled by its owner").toBe(200);
  expect(await userRead.json()).toMatchObject({ id: auth.sub, aud: "authenticated" });
  const writes: string[] = [], blockedAppearanceWrites: string[] = [], foreign: string[] = [], readPaths: string[] = [];
  let cycleUnavailable = false, sourceUnknown = false;
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("mm.lang", lang); localStorage.setItem("lang", lang);
    localStorage.setItem("theme", lang === "zh" ? "light" : "dark"); localStorage.setItem("theme_auto", "0");
    localStorage.setItem("mmx.shell.theme", lang === "zh" ? "light" : "dark");
  }, { lang });
  // Ordinary local compiled assets and retained /data remain real. A browser
  // cannot accidentally turn this finite fixture into a provider/write test.
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    // Same exact peripheral no-op used by incumbent company-intelligence.spec.ts.
    // No provider request or script execution is delegated to the real origin.
    if (request.url() === "https://www.mastermind-x.com/mm_brain.js" && request.method() === "GET" && request.resourceType() === "script")
      return route.fulfill({ contentType: "application/javascript", body: "/* ordinary-CI peripheral stub */" });
    if (url.origin !== origin) { foreign.push(url.origin + url.pathname); return route.abort("blockedbyclient"); }
    if (!["GET", "HEAD"].includes(request.method())) {
      // Record only the fixed method/path, never bodies/credentials or a save claim.
      try { if (!url.search && isBlockedNativeAppearanceIntent(request.method(), url.pathname, request.postDataJSON()))
        blockedAppearanceWrites.push(request.method() + " " + url.pathname); } catch { /* unqualified remains in writes */ }
      writes.push(request.method() + " " + url.pathname); return route.abort("blockedbyclient");
    }
    if (url.pathname === "/api/shared-shell/today") {
      readPaths.push(url.pathname); return route.fulfill({ json: compactMacro });
    }
    if (url.pathname === "/api/sector-intelligence") {
      readPaths.push(url.pathname + url.search);
      if (url.searchParams.get("view") === "intelligence") {
        expect(url.searchParams.get("source")).toBe("history");
        return cycleUnavailable ? route.fulfill({ status: 503, json: { error: "fixture_unavailable" } }) : route.fulfill({ json: compactCycles });
      }
      return sectorFixture(route);
    }
    if (url.pathname === "/api/flow") {
      readPaths.push(url.pathname + url.search);
      if (url.searchParams.get("f") === "prophet_idx") {
        if (url.searchParams.get("view") === "intelligence") return route.fulfill({ json: compactProphet });
        return route.fulfill({ json: { ...prophetFrame, asof: SOURCE_CLOCKS.published,
          source_asof: sourceUnknown ? null : SOURCE_CLOCKS.prophet,
          source_unknown: sourceUnknown, source_delayed: !sourceUnknown, source_mixed_vintage: !sourceUnknown } });
      }
      return route.fulfill({ status: 503, json: { error: "fixture_unavailable" } });
    }
    // SDK requests use the real fixture owner, never a browser-only fake user.
    if (url.pathname.startsWith("/api/__e2e__/supabase/") || url.pathname === "/api/me") return route.continue();
    // Other tools' APIs are unavailable honestly; retained local chart/fund files
    // are served unchanged by the incumbent webServer (no symbol relabelling).
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "fixture_unavailable" } });
    return route.continue();
  });
  await page.routeWebSocket("**/*", socket => {
    const url = new URL(socket.url());
    if ((url.protocol === "ws:" && `http://${url.host}` === origin) && url.pathname.startsWith("/_next/")) socket.connectToServer();
    else socket.close();
  });
  return { readPaths, writes, blockedAppearanceWrites, foreign, setCycleUnavailable: () => { cycleUnavailable = true; }, setSourceUnknown: () => { sourceUnknown = true; } };
}
export async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator("[data-shared-shell=beta]")).toBeVisible();
}
export async function recordSourceScope(page: Page, info: TestInfo, reads: string[]) {
  await info.attach("native-entrance-source-fixture-scope", { contentType: "application/json", body: JSON.stringify({
    scope: "ORDINARY_CI_SYNTHETIC_IDENTITY_AND_API_FIXTURE_NOT_LIVE_ACCOUNT_DATA_OR_PAPER",
    pathname: new URL(page.url()).pathname, project: info.project.name, reads, peripheral: "exact incumbent mm_brain.js no-op; unexpected foreign requests abort/fail",
  }) });
}

/** Ordinary test attachments, never a publication/approval manifest. Only the
 * chosen desktop/narrow EN/ZH states are captured; tablet still runs assertions.
 * The incumbent checkout identity helper is read-only here (not its capture run).
 */
export async function observeNativeState(page: Page, info: TestInfo,
  phase: "overview-ready" | "overview-unavailable" | "prophet-ready" | "sector-evidence" | "company-chart" | "sector-return" | "presentation-en-light" | "presentation-zh-dark" | "presentation-prophet-en-light" | "presentation-prophet-zh-dark" | "presentation-sector-return-en-light" | "presentation-sector-return-zh-dark" | "presentation-unavailable" | "presentation-auto-en-light" | "presentation-auto-en-dark" | "presentation-auto-zh-light" | "presentation-auto-zh-dark" | "presentation-320-focus") {
  if (info.project.name !== "desktop" && info.project.name !== "mobile") return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- incumbent CommonJS source identity helper only
  const { checkoutIdentity } = require("../tools/capture_ci_evidence.cjs") as {
    checkoutIdentity: (root: string, env: Record<string,string>) => { actualCheckout: { commit: string; tree: string } };
  };
  const root = process.cwd(), before = checkoutIdentity(path.dirname(root), {}).actualCheckout;
  const files = ["playwright.intelligence.config.ts", "e2e/native-intelligence-entrances.journey.ts",
    "e2e/fixtures/native-intelligence-entrances.ts", "e2e/fixtures/native-intelligence-auth.ts",
    "e2e/fixtures/sector-company-v3.ts", "e2e/fixtures/sector-intraday-pulse.ts",
    "test-fixtures/prophet_stale_frame_fixture.json", "lib/sharedShellRoutes.generated.json",
    "lib/e2e/nativeIntelligenceFixture.ts", "lib/shared-shell/memberIdentity.ts",
    "components/intelligence/IntelligenceWorkspace.tsx", "components/intelligence/IntelligenceToolWorkspace.tsx",
    "components/sector-intelligence/SectorIntelligenceWorkspace.tsx", "components/prophet/ProphetLanesView.tsx",
    "components/prophet/ProphetView.tsx", "components/intelligence/Intelligence.module.css",
    "components/sector-intelligence/SectorIntelligenceWorkspace.module.css",
    "components/chrome/shared-shell/shared-shell.css",
    "components/chrome/shared-shell/SharedShellPresentation.tsx", "components/chrome/shared-shell/SharedShellPresentationControls.tsx",
    "components/settings/SettingsButton.tsx", "components/settings/SectionPreferences.tsx", "lib/useMarketPrefs.ts",
    "e2e/fixtures/native-intelligence-contract.ts", "e2e/fixtures/investigation-auth.ts", "app/layout.tsx", "app/globals.css", "app/fin.css"];
  const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  const sources = Object.fromEntries(files.map(file => {
    const absolute = path.join(root, file), stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4*1024*1024) throw Error("NATIVE_JOURNEY_SOURCE_BINDING");
    return [file, sha(readFileSync(absolute))];
  }));
  const imagePath = info.outputPath(`${phase}.png`);
  const png = await page.screenshot({ path: imagePath, animations: "disabled" });
  const after = checkoutIdentity(path.dirname(root), {}).actualCheckout;
  expect(after).toEqual(before);
  await info.attach(phase, { path: imagePath, contentType: "image/png" });
  await info.attach(`${phase}-source-binding`, { contentType: "application/json", body: JSON.stringify({
    state: "OBSERVATION_NOT_TEST_OR_PAPER_VERDICT", scope: "SYNTHETIC_IDENTITY_AND_API_FIXTURE_NOT_LIVE_ACCOUNT",
    checkout: before, sources, phase, project: info.project.name, viewport: page.viewportSize(),
    presentation: await page.locator("html").evaluate(node => ({ lang: node.getAttribute("data-lang"), theme: node.getAttribute("data-theme") })),
    png: { name: `${phase}.png`, bytes: png.length, sha256: sha(png) },
    fixture: { compactMacro: sha(JSON.stringify(compactMacro)), compactCycles: sha(JSON.stringify(compactCycles)),
      compactProphet: sha(JSON.stringify(compactProphet)), clocks: SOURCE_CLOCKS },
  }) });
}
