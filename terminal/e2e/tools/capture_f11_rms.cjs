// Throwaway proof-capture script for the B-F11-2 lens rail (Meta-CEO B ruling r3 item
// (8): "Playwright screenshot against the dev server with a seeded thesis; fullPage").
// This is run BY HAND against a locally started dev server (see the header block
// below) to regenerate `terminal/e2e/proof/f11-rms/*.png` — it is NOT part of the
// checked-in e2e suite (`npm run test:e2e:responsive` never touches this file) and is
// committed under `e2e/tools/` per Meta-CEO B ruling r4 minor 6 purely so the exact
// capture steps stay reproducible and reviewable, not to make it a CI-run script.
//
// Usage (from `terminal/`):
//   ANALYSIS_LOCAL_PREVIEW=1 ADMIN_DEV=1 TERMINAL_E2E_FIXTURE=1 \
//   TERMINAL_E2E_EMAIL=responsive@example.com TERMINAL_E2E_ENTITLEMENT=unlimited \
//   RATE_LIMIT_MAX=100000 HUB_REALTIME_QUOTES=1 FLOW_FIXTURE=1 \
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
//   npm run dev -- --hostname 127.0.0.1 --port 3811
//   # once the dev server is up, in a second shell:
//   node e2e/tools/capture_f11_rms.cjs
const { chromium } = require("@playwright/test");
const path = require("path");
const crypto = require("crypto");

const baseURL = "http://127.0.0.1:3811";
const proofDir = path.join(__dirname, "..", "proof", "f11-rms");

async function createThesis(context, title, symbol, requestId) {
  const response = await context.request.post(`${baseURL}/api/theses`, {
    data: {
      action: "create",
      clientRequestId: requestId,
      subject: {
        schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
        key: symbol, identityState: "listing_scoped", listing: { symbol, mic: null, securityId: null },
        companyId: null, display: `${symbol} · listing scoped`,
      },
      content: {
        schema: "mastermind.thesis-content/v1", title, statement: `${title} statement`,
        catalysts: ["Data-center revenue compounds", "Software mix expands"],
        falsifiers: ["Gross margin falls below 65%"],
        risks: ["Customer concentration"],
        horizon: "quarters", effectiveAt: null, revisionNote: null,
      },
    },
  });
  if (response.status() !== 201) {
    throw new Error(`create failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()).thesisId;
}

async function shoot(zh) {
  const storeKey = `f11-rms-proof-${zh ? "zh" : "en"}-${crypto.randomUUID().slice(0, 8)}`;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([{ name: "mm_e2e_wl", value: storeKey, url: baseURL }]);
  await context.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement?.setAttribute("data-lang", useZh ? "zh" : "en");
    document.documentElement?.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, zh);

  // Seed a thesis with real catalysts/risks so the content lenses have something to
  // show once hydrated.
  const thesisId = await createThesis(context, zh ? "英伟达运营杠杆" : "NVDA operating leverage", "NVDA", crypto.randomUUID());

  for (const viewport of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
    const page = await context.newPage();
    await page.setViewportSize({ width: viewport.w, height: viewport.h });
    await page.goto(`${baseURL}/analysis?view=theses&thesis=${thesisId}`, { waitUntil: "networkidle" });
    if (viewport.w < 700) {
      // Mobile viewport lands on the detail pane; the lens rail lives in the list pane.
      await page.getByRole("button", { name: zh ? "返回列表" : "Back to list" }).click();
    }
    await page.waitForSelector('[data-testid="thesis-lens-rail"]', { timeout: 15000, state: "visible" });
    // Trigger the bounded-hydration automatic batch by opening a content lens, so the
    // crop shows a real line row, not just the empty state.
    await page.getByRole("tab", { name: zh ? "催化因素" : "Catalysts" }).click();
    await page.waitForTimeout(400);
    if (viewport.w < 700) {
      // This round's review MAJOR 2 (Meta-CEO B ruling): the rail no longer forces
      // scroll position 0 on every narrow-mode render — it scrolls the SELECTED lens
      // into view instead (component effect, on mount and on every lens change), so
      // the crop shows whichever tab is actually active rather than always the
      // leftmost few. Nothing to force here any more; the click above already
      // triggers that effect and `waitForTimeout(400)` above gives it time to settle.
      // The earlier click can still leave a stale `:hover` state on a tab the
      // pointer happens to be resting over — park the pointer well away from the
      // rail before screenshotting so that isn't a capture-script artifact.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);
    }
    const suffix = zh ? "-zh" : "";
    const out = path.join(proofDir, `lens-rail-${viewport.w}${suffix}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log("wrote", out);
    await page.close();
  }

  await context.close();
  await browser.close();
}

(async () => {
  await shoot(false);
  await shoot(true);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
