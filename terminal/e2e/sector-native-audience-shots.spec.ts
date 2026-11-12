import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import captured from "../lib/__tests__/fixtures/sector_generation.captured.preview.v1.json";
import entitledBlocks from "../lib/__tests__/fixtures/typed_blocks_entitled.json";
import { sectorFixture } from "./fixtures/sector-company-v3";

// R4 visual proof (COO rulings 2026-11-11): labelled fixture screenshots of the
// four audiences a member can actually receive — entitled row tables, preview
// subscription cards, the both-denied entitlement state, and the signed-out
// access state — in EN/ZH, light/dark, at the three canonical viewports.
//
// FIXTURE EVIDENCE ONLY: every generation route below is intercepted with the
// same captured Macro wire the unit suites pin. Production Macro 404s both
// /api/sector-generation paths today, so nothing here is live acceptance.
const OUT = "/tmp/si_plan/returns/lane3_entitled_read";
const ownerWire = readFileSync("lib/__tests__/fixtures/sector_generation.captured.preview.v1.json", "utf8").trimEnd();
const ownerWireHash = createHash("sha256").update(ownerWire).digest("hex");
const nativePath = "/api/sector-generation?audience=preview";
const entitledPath = "/api/sector-generation?audience=entitled";
const ROW_BLOCK_NAMES = ["confluence_universe_sp500", "confluence_universe_nasdaq",
  "confluence_universe_russell", "confluence_universe_baskets", "theme_rows"] as const;
const VIEWPORTS = [[1440, 900], [820, 1180], [390, 844]] as const;

const pathFor = (wire: typeof captured) => wire.audience === "entitled" ? entitledPath : nativePath;
const entitledWire = () => {
  const wire = structuredClone(captured);
  wire.audience = "entitled";
  (wire.projection.data as unknown as Record<string, unknown>).audience = "entitled";
  (wire.projection.data as unknown as Record<string, unknown>).typed_blocks = structuredClone(entitledBlocks);
  return wire;
};
const stubbedPreviewWire = () => {
  const wire = structuredClone(captured);
  (wire.projection.data as unknown as Record<string, unknown>).typed_blocks = Object.fromEntries(
    ROW_BLOCK_NAMES.map(name => [name, { status: "unavailable", reason: "audience_not_entitled", value: null }]));
  return wire;
};
const driversUrl = (theme: string) =>
  "/discover?tab=sectors&sectorWorkspace=detail&sectorJob=research&sectorView=drivers&sector=xlk&sectorTheme=" + theme;

type Audience = "entitled" | "signedout" | "preview" | "denied";
const CARD: Record<"en" | "zh", string> = {
  en: "Not included in your current subscription.",
  zh: "当前订阅不包含此读数。",
};

async function prepare(page: Page, audience: Audience, language: "en" | "zh") {
  expect(ownerWireHash).toBe("3e275fc69d22e990f81261c8a803576a832be9332484c7a99b2dddd165a5d425");
  await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), language);
  const wire = audience === "entitled" ? entitledWire() : audience === "preview" ? stubbedPreviewWire() : structuredClone(captured);
  await page.route("**/api/sector-intelligence?**", async route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    if (source === "sector") return route.fulfill({ json: {
      data: { as_of: captured.source_session, sectors: [{ id: "xlk", ticker: "XLK", name: "Legacy Technology", kind: "sector" }] },
      receipt: { source, status: "ready", path: "/sectordata/sector_central.json", asOf: captured.source_session,
        observedAt: captured.published_at, contentHash: "independent-legacy", stale: false },
    } });
    if (source !== "generation") return sectorFixture(route);
    // The both-denied envelope is the only subscription cause (R2): entitled
    // 403 AND preview 403, answered here in one pre-merged envelope.
    if (audience === "denied") return route.fulfill({ status: 403,
      headers: { "X-Sector-Failure": "entitlement_required" },
      json: { data: null, receipt: { source, status: "access", path: nativePath, asOf: null,
        observedAt: null, contentHash: null, stale: false, failure: "entitlement_required" } } });
    if (audience === "signedout") return route.fulfill({ status: 401, json: {
      data: null, receipt: { source, status: "access", path: nativePath, asOf: null,
        observedAt: null, contentHash: null, stale: false },
    } });
    return route.fulfill({ json: {
      data: wire,
      receipt: { source, status: "ready", path: pathFor(wire), asOf: wire.source_session,
        observedAt: captured.published_at, contentHash: ownerWireHash, stale: false },
    } });
  });
  await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: {} } }));
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function settle(page: Page, audience: Audience, language: "en" | "zh") {
  const dossier = page.getByTestId("sector-native-dossier");
  const unavailable = page.getByTestId("sector-native-unavailable");
  if (audience === "entitled") {
    await expect(dossier).toContainText("Software - Application");
    await expect(page.locator('[data-theme-rows="true"]')).toBeVisible();
    await expect(page.getByTestId("sector-intelligence")).not.toContainText(CARD[language]);
  } else if (audience === "preview") {
    await expect(dossier).toContainText(CARD[language]);
    await expect(page.locator('[data-theme-rows="true"]')).toHaveCount(0);
  } else if (audience === "denied") {
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText(CARD[language]);
    await expect(unavailable.locator('a[href="/login"]')).toHaveCount(0);
  } else {
    await expect(unavailable).toBeVisible();
    await expect(unavailable.locator('a[href="/login"]')).toBeVisible();
  }
}

mkdirSync(OUT, { recursive: true });

for (const audience of ["entitled", "preview", "denied", "signedout"] as const) {
  for (const language of ["en", "zh"] as const) {
    for (const theme of ["dark", "light"] as const) {
      test(`fixture ${audience} audience: ${language} ${theme} at three viewports`, async ({ page }) => {
        const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
        await prepare(page, audience, language);
        await page.goto(driversUrl(theme));
        await settle(page, audience, language);
        for (const [width, height] of VIEWPORTS) {
          await page.setViewportSize({ width, height });
          await noOverflow(page);
          await page.screenshot({ path: `${OUT}/fixture-${audience}-${language}-${theme}-${width}x${height}.png`, fullPage: true });
        }
        expect(errors).toEqual([]);
      });
    }
  }
}
