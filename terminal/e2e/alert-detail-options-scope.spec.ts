import { expect, test, type Page } from "@playwright/test";

test.setTimeout(75_000);
const sharedShell = process.env.MMX_SHARED_SHELL === "1";
const themes = sharedShell ? ["dark", "light"] as const : ["dark"] as const;
const kinds = ["opt_premium_burst", "opt_0dte_spike"] as const;
type AggregateKind = typeof kinds[number];

async function installFixture(page: Page, lang: "en" | "zh", theme: "dark" | "light", kind: AggregateKind) {
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
  }, { lang, theme });
  const now = new Date().toISOString();
  const id = kind === "opt_premium_burst" ? "scope-premium" : "scope-0dte";
  const firedAt = "2026-11-13T15:41:00Z";
  const condition = kind === "opt_premium_burst"
    ? { type: kind, root: "MARKET", leg: "ncp", z: 3, triggered: { at: firedAt, value: 3.8 } }
    : { type: kind, root: "MARKET", share_pct: 55, triggered: { at: firedAt, value: 62 } };
  const summary = kind === "opt_premium_burst"
    ? "Net call premium accelerated across the covered options tape."
    : "0DTE share reached 62% of the covered options activity.";
  const evidenceUrl = "https://example.com/evidence/" + id;
  await page.route("**/api/alerts", route => route.fulfill({ json: { alerts: [{
    id, symbol: "MARKET", active: false, created_at: "2026-11-12T12:00:00Z", condition,
  }] } }));
  await page.route("**/api/alerts/receipts", route => route.fulfill({ json: {
    run: { lane: "alerts_engine", run_id: "scope-run-" + id, started_at: now, concluded_at: now,
      outcome: "success", lane_cadence_budget_s: 300 },
    runs_state: "READ_OK", last_success_at: now, outbox_state: "READ_OK",
    outbox: [{
      alert_id: id, fire_event_id: "fired-" + id, status: "failed", attempts: 2,
      last_error: "source-response-" + id, deliver_after: null, delivered_at: null, created_at: firedAt,
      payload: { subject: summary, summary_plain: summary, condition_plain: summary,
        ticker: "MARKET", evidence_url: evidenceUrl, fired_at: firedAt },
    }],
  } }));
  return { id, evidenceUrl, summary };
}

for (const lang of ["en", "zh"] as const) for (const theme of themes) for (const kind of kinds) {
  test(`aggregate alert detail retains exact evidence and covered scope (${kind}, ${lang}, ${theme})`, async ({ page }, info) => {
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/alerts") && !["GET", "HEAD"].includes(request.method())) {
        writes.push(request.method() + " " + new URL(request.url()).pathname);
      }
    });
    await page.emulateMedia({ colorScheme: theme });
    const fixture = await installFixture(page, lang, theme, kind);
    await page.goto("/alerts");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    if (sharedShell) await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
    const row = page.locator('[data-alerts-module="recent-activity"]').getByRole("button").first();
    await expect(row).toBeVisible(); await row.focus(); await row.press("Enter");
    const dialog = page.getByRole("dialog", { name: lang === "zh" ? "警报详情" : "Alert detail", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(dialog.getByText(lang === "zh" ? "范围" : "Scope", { exact: true })).toBeVisible();
    await expect(dialog.getByText(lang === "zh" ? "覆盖范围内的期权交易" : "Covered options tape", { exact: true })).toBeVisible();
    await expect(dialog.getByText(lang === "zh" ? "代码" : "Symbol", { exact: true })).toHaveCount(0);
    await expect(dialog.locator('a[href="/portfolio"]')).toHaveCount(0);
    await expect(dialog).not.toContainText(/MARKET|market-wide|全市场/);
    const evidence = dialog.getByRole("link", { name: lang === "zh" ? "查看证据" : "View evidence", exact: true });
    await expect(evidence).toHaveAttribute("href", fixture.evidenceUrl);
    if (lang === "en") await expect(dialog).toContainText(fixture.summary);

    const close = dialog.getByRole("button", { name: lang === "zh" ? "关闭" : "Close", exact: true });
    await page.keyboard.press("Tab"); await expect(close).toBeFocused();
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const box = await dialog.boundingBox(), viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const screenshot = info.outputPath("aggregate-alert-scope.png");
    await page.screenshot({ animations: "disabled", path: screenshot });
    await info.attach("aggregate-alert-scope", { path: screenshot, contentType: "image/png" });

    // Removing a misleading symbol link leaves the real evidence next in keyboard order.
    await close.press("Tab"); await expect(evidence).toBeFocused();
    await evidence.press("Tab");
    const receipt = dialog.locator("summary"); await expect(receipt).toBeFocused();
    await receipt.press("Enter"); await expect(dialog.locator("details")).toHaveAttribute("open", "");
    await expect(dialog.locator("details")).toContainText("source-response-" + fixture.id);
    await dialog.locator("details > div").last().scrollIntoViewIfNeeded();
    await expect(dialog.locator("details > div").last()).toBeInViewport();
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(row).toBeFocused();
    if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) await row.tap();
    else await row.click();
    await expect(dialog).toBeVisible();
    await close.click(); await expect(dialog).toBeHidden(); await expect(row).toBeFocused();
    expect(writes).toEqual([]); expect(errors).toEqual([]);
    await info.attach("scope-consumer-proof", { contentType: "application/json",
      body: Buffer.from(JSON.stringify({ kind, lang, theme, sharedShell, viewport,
        evidenceUrl: fixture.evidenceUrl, scope: "covered-options-tape", writes, pageErrors: errors }, null, 2)) });
  });
}
