import { test, expect, type Page } from "@playwright/test";

// Data OS U02 — the chart frame bar's data-origin readout, derived from the OHLC file's
// view contract (schema terminal.ohlc_view.v1).
//
// The "known" cases inject a SYNTHETIC fixture view through page.route: production
// /data files carry no view block yet (Macro package C01 emits the contract later), and
// the committed public/data/NVDA.json therefore exercises the "unknown" state — the
// normal state today, which must read "unknown", never as an error and never as
// "adjusted".
//
// Artifacts: 8 cropped PNGs under docs/pr-crops/dataos-u02-20261013/ (desktop + tablet ×
// known/unknown × en/zh). The phone project asserts only the no-overflow retirement of
// the frame bar (R2c) — the chip assertions are skipped there by design.

const VIEW_FIXTURE = {
  schema: "terminal.ohlc_view.v1",
  contract: {
    schema: "dataos.view_contract.v1",
    purpose: "terminal_daily_ohlc",
    identity_namespace: "mmx/us/daily",
    field_units: { o: "vendor_adjusted_usd", h: "vendor_adjusted_usd", l: "vendor_adjusted_usd", c: "vendor_adjusted_usd" },
    adjustment_reference: { basis: "tradj", action_revision_set_id: "e2e-fixture-rev-0001", as_at: "2026-10-13T00:00:00Z" },
    evidence_mode: { mode: "CURRENT", clock: "td_close", dependency_generation_ids: ["gen-e2e-1"], code_version: "e2e" },
    coverage: { from: "1999-01-04", to: "2026-10-10" },
    refusal_reasons: [],
  },
  listing: { security_id: "sec-e2e-nvda", listing_id: "lis-e2e-nvda", mic: "XNAS", src: "deep", refusal_reasons: [] },
  segments: [{ from: "1999-01-04", to: "2026-10-10", src: "deep", bar_quality: "raw" }],
  basis_drift: null,
  suspected_breaks: [],
  refusal_reasons: [],
};

const CJK = /[㐀-鿿]/;
const CROPS = "docs/pr-crops/dataos-u02-20261013";

async function injectView(page: Page): Promise<void> {
  await page.route("**/data/NVDA.json", async (route) => {
    const r = await route.fetch();
    const j = await r.json();
    j.view = VIEW_FIXTURE;
    await route.fulfill({ response: r, json: j });
  });
}

// Crop screenshot: the popover's bounding box plus the chip and a margin (never a full page).
async function cropShot(page: Page, path: string): Promise<void> {
  const chip = page.locator('[data-testid="cfb-origin"]');
  const pop = page.locator('[data-testid="cfb-origin-pop"]');
  const c = await chip.boundingBox();
  const p = await pop.boundingBox();
  expect(c).not.toBeNull();
  expect(p).not.toBeNull();
  const m = 14;
  const clip = {
    x: Math.max(0, Math.min(c!.x, p!.x) - m),
    y: Math.max(0, Math.min(c!.y, p!.y) - m),
    width: Math.min(c!.x + c!.width, p!.x + p!.width) - Math.max(0, Math.min(c!.x, p!.x) - m) + m * 2,
    height: Math.min(c!.y + c!.height, p!.y + p!.height) - Math.max(0, Math.min(c!.y, p!.y) - m) + m * 2,
  };
  await page.screenshot({ path, clip });
}

async function openPopover(page: Page): Promise<string> {
  const chip = page.locator('[data-testid="cfb-origin"]');
  await chip.click();
  const pop = page.locator('[data-testid="cfb-origin-pop"]');
  await expect(pop).toBeVisible();
  return (await pop.textContent()) ?? "";
}

test.describe("data-origin readout (Data OS U02)", () => {
  for (const lang of ["en", "zh"] as const) {
    for (const state of ["known", "unknown"] as const) {
      test(`${state} readout (${lang})`, async ({ page }, testInfo) => {
        // Phone (width ≤ 640): R2c retired the frame bar there. The origin chip cannot
        // exist by design — assert the retirement does not overflow the viewport instead.
        const width = page.viewportSize()?.width ?? 1440;
        if (width <= 640) {
          await page.goto("/terminal?symbol=NVDA");
          await page.waitForTimeout(1500);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(overflow).toBeLessThanOrEqual(0);
          return;
        }

        if (lang === "zh") {
          // The app's own mechanism: the pre-paint boot script reads mm.lang → <html data-lang>.
          await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
        }
        if (state === "known") await injectView(page);

        await page.goto("/terminal?symbol=NVDA");
        const chip = page.locator('[data-testid="cfb-origin"]');
        await expect(chip).toBeVisible({ timeout: 45_000 });
        await expect(chip).toHaveAttribute("data-origin-state", state, { timeout: 45_000 });

        if (state === "known") {
          await expect(chip).toHaveText("TRADJ");   // the basis label is a term, untranslated
        } else {
          await expect(chip).toHaveText(lang === "zh" ? "基准?" : "BASIS?");
        }

        const text = await openPopover(page);
        if (state === "known") {
          const basis = lang === "zh" ? "tradj — 数据商复权" : "tradj — vendor-adjusted";
          const foot = lang === "zh" ? "数据商复权 — 非实际成交价" : "Vendor-adjusted — not a printed price";
          expect(text).toContain(basis);
          expect(text).toContain("Mastermind");                        // src = the deep store, in either language
          expect(text).toContain("2026-10-13T00:00:00Z");              // as-of, verbatim
          expect(text).toContain("e2e-fixture-rev-0001");              // generation, verbatim
          expect(text).toContain(foot);
          if (lang === "zh") expect(text).not.toContain("Vendor-adjusted");
          else expect(text).not.toMatch(CJK);
        } else {
          const absence = lang === "zh" ? "此文件早于视图标注" : "This file predates view labels";
          const unknown = lang === "zh" ? "未知" : "unknown";
          expect(text).toContain(unknown);                             // basis/src print unknown, never a claim
          expect(text).toContain(absence);
          if (lang === "zh") expect(text).not.toContain("Vendor-adjusted");
          else expect(text).not.toMatch(CJK);
        }

        // No tooltip anywhere in the readout: the popover is the explanation, aria-label the name.
        expect(await page.locator('[data-testid="cfb-origin"][title], [data-testid="cfb-origin-pop"] [title]').count()).toBe(0);

        const project = testInfo.project.name;
        if (project === "desktop" || project === "tablet") {
          await cropShot(page, `${CROPS}/${project}-origin-${state}-${lang}.png`);
        }
      });
    }
  }
});
