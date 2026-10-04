import { expect, test, type Page } from "@playwright/test";

// MarketOntology F11-6 — the /analysis Brain host reports ambient page/panel (Sol 5967105152
// on macro #7100). Asserts the EXACT object the production mm_brain.js copies into the chat
// envelope: `window.MM_BRAIN_CFG.getAiContext()` (schema ai_context_client.v1).
//
// Same stub idiom as company-intelligence.spec.ts: the production widget script is fulfilled
// empty, so BrainWidget's install effect seeds MM_BRAIN_CFG and nothing cross-origin executes.
const BRAIN_SCRIPT_SRC = "https://www.mastermind-x.com/mm_brain.js";

type AiCtx = {
  schema: string;
  origin_id: string;
  context_revision: number;
  active: { type: string; id: string } | null;
  ambient: { symbol?: string; timeframe?: string; page: string; panel: string | null };
};

async function readAiContext(page: Page): Promise<AiCtx> {
  await page.waitForFunction(() => {
    const cfg = (window as unknown as { MM_BRAIN_CFG?: { getAiContext?: () => unknown } }).MM_BRAIN_CFG;
    return typeof cfg?.getAiContext === "function" && cfg.getAiContext() !== undefined;
  }, undefined, { timeout: 30_000 });
  return page.evaluate(() => {
    const cfg = (window as unknown as { MM_BRAIN_CFG: { getAiContext: () => AiCtx } }).MM_BRAIN_CFG;
    return cfg.getAiContext();
  });
}

async function softNavigate(page: Page, href: string) {
  // Next (>=14.1) syncs native history.pushState into the app router: this is a client-side
  // navigation that keeps the (shell) layout — and therefore the provider — mounted, which is
  // exactly what the revision assertions below depend on (a full load would mint origin_id 0).
  await page.evaluate((h) => window.history.pushState(null, "", h), href);
}

async function waitForPanel(page: Page, panel: string | null) {
  await page.waitForFunction((want) => {
    const cfg = (window as unknown as { MM_BRAIN_CFG?: { getAiContext?: () => AiCtx } }).MM_BRAIN_CFG;
    const ctx = cfg?.getAiContext?.();
    return !!ctx && ctx.ambient.page === "analysis" && ctx.ambient.panel === want;
  }, panel, { timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.route(BRAIN_SCRIPT_SRC, async (route) => route.fulfill({
    contentType: "application/javascript",
    body: "",
  }));
});

test.describe("analysis ai-context ambient page/panel", () => {
  test("cold load of the thesis view reports analysis/theses at revision 0", async ({ page }) => {
    await page.goto("/analysis?view=theses&symbol=NVDA");
    const ctx = await readAiContext(page);
    expect(ctx.schema).toBe("ai_context_client.v1");
    expect(ctx.ambient.page).toBe("analysis");
    expect(ctx.ambient.panel).toBe("theses");
    expect(ctx.ambient.symbol).toBe("NVDA");
    expect(ctx.active).toEqual({ type: "security", id: "NVDA" });
    expect(ctx.context_revision).toBe(0);
  });

  test("cold load of the company view reports analysis/company", async ({ page }) => {
    await page.goto("/analysis?symbol=NVDA");
    const ctx = await readAiContext(page);
    expect(ctx.ambient).toMatchObject({ page: "analysis", panel: "company", symbol: "NVDA" });
    expect(ctx.context_revision).toBe(0);
  });

  test("an unsupported view reports analysis with no panel", async ({ page }) => {
    await page.goto("/analysis?view=nope");
    const ctx = await readAiContext(page);
    expect(ctx.ambient.page).toBe("analysis");
    expect(ctx.ambient.panel).toBeNull();
  });

  test("company → theses bumps the revision exactly once; a repeat does not bump", async ({ page }) => {
    await page.goto("/analysis?symbol=NVDA");
    const before = await readAiContext(page);
    expect(before.ambient.panel).toBe("company");
    expect(before.context_revision).toBe(0);

    await softNavigate(page, "/analysis?view=theses&symbol=NVDA");
    await waitForPanel(page, "theses");
    const afterFirst = await readAiContext(page);
    expect(afterFirst.origin_id).toBe(before.origin_id); // same provider, same mount
    expect(afterFirst.context_revision).toBe(1);

    // A URL change that leaves the logical tuple alone: `from=` is not a route switch, so the
    // host re-renders with the same (path, panel, symbol) and nothing bumps. (An IDENTICAL URL
    // would prove nothing here — Next re-renders nothing for it. The provider's duplicate
    // suppression on an identical re-fire of the host effect is pinned at component level in
    // lib/__tests__/analysisBrainHost.test.tsx, where a path-only change re-fires it.)
    await softNavigate(page, "/analysis?view=theses&symbol=NVDA&from=repeat");
    await page.waitForFunction(() => window.location.search.includes("from=repeat"));
    await waitForPanel(page, "theses");
    const afterRepeat = await readAiContext(page);
    expect(afterRepeat.origin_id).toBe(before.origin_id);
    expect(afterRepeat.ambient.panel).toBe("theses");
    expect(afterRepeat.context_revision).toBe(1);

    await softNavigate(page, "/analysis?symbol=NVDA"); // back to company: a real transition
    await waitForPanel(page, "company");
    const afterBack = await readAiContext(page);
    expect(afterBack.origin_id).toBe(before.origin_id);
    expect(afterBack.context_revision).toBe(2);
  });

  test("the chart Terminal keeps its historical ambient: page terminal, no panel", async ({ page }) => {
    await page.goto("/terminal?symbol=NVDA");
    const ctx = await readAiContext(page);
    expect(ctx.ambient.page).toBe("terminal");
    expect(ctx.ambient.panel).toBeNull();
  });
});
