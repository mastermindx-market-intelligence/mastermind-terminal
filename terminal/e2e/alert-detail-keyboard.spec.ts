import { expect, test, type Locator, type Page } from "@playwright/test";

test.setTimeout(60_000);
const sharedShell = process.env.MMX_SHARED_SHELL === "1";

async function installDetailFixture(page: Page, lang: "en" | "zh", evidence = true) {
  await page.addInitScript((language) => {
    localStorage.setItem("mm.lang", language);
    document.documentElement.setAttribute("data-lang", language);
  }, lang);
  const now = new Date().toISOString();
  await page.route("**/data/manifest.json**", route => route.fulfill({ json: { symbols: { NVDA: { name: "NVIDIA", last: 182.5 } } } }));
  await page.route("**/api/alerts", route => route.fulfill({ json: { alerts: [{
    id: "detail-a1", symbol: "NVDA", active: false, created_at: "2026-08-01T00:00:00Z",
    condition: { type: "price", op: "below", value: 150, triggered: { at: "2026-09-05T09:41:00Z", value: 100, note: "crossed" } },
  }] } }));
  await page.route("**/api/alerts/receipts", route => route.fulfill({ json: {
    run: { lane: "alerts_engine", run_id: "detail-r1", started_at: now, concluded_at: now, outcome: "success", lane_cadence_budget_s: 300 },
    runs_state: "READ_OK", last_success_at: now, outbox_state: "READ_OK",
    outbox: [{
      alert_id: "detail-a1", fire_event_id: "detail-f1", status: "failed", attempts: 2,
      last_error: "Source receipt unavailable: " + "retryable-source-response-".repeat(8),
      deliver_after: null, delivered_at: null, created_at: "2026-09-05T09:41:00Z",
      payload: {
        subject: "NVDA crossed your price line", summary_plain: "NVDA crossed your price line.",
        ticker: "NVDA", condition_plain: "Crossed your price line",
        evidence_url: evidence ? "https://example.com/evidence/detail-f1" : null,
        fired_at: "2026-09-05T09:41:00Z",
      },
    }],
  } }));
}

async function openDetail(page: Page, lang: "en" | "zh") {
  const row = page.locator('[data-alerts-module="recent-activity"]').getByRole("button").first();
  await expect(row).toBeVisible();
  await row.focus();
  await row.press("Enter");
  const dialog = page.getByRole("dialog", { name: lang === "zh" ? "警报详情" : "Alert detail", exact: true });
  await expect(dialog).toBeVisible();
  return { row, dialog, close: dialog.getByRole("button", { name: lang === "zh" ? "关闭" : "Close", exact: true }) };
}

async function withinViewport(page: Page, target: Locator) {
  const box = await target.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(await target.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return [rect.y + 8, rect.y + rect.height / 2, rect.bottom - 8].every(y => {
      const hit = document.elementFromPoint(rect.x + rect.width / 2, y);
      return hit === node || node.contains(hit);
    });
  }), "The target must paint above shell chrome, including its top edge").toBe(true);
}

for (const lang of ["en", "zh"] as const) {
  test(`alert detail contains keyboard focus and returns to its opener in ${lang}`, async ({ page }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ colorScheme: "dark" });
    await installDetailFixture(page, lang, lang === "en");
    const writes: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/alerts") && !["GET", "HEAD"].includes(request.method())) writes.push(request.method());
    });
    await page.goto("/alerts");
    if (sharedShell && lang === "zh") {
      await page.getByRole("button", { name: "浅色主题", exact: true }).click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", sharedShell && lang === "zh" ? "light" : "dark");
    const { row, dialog, close } = await openDetail(page, lang);
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await withinViewport(page, close);
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await row.focus();
    await expect(close).toBeFocused();

    const receipt = dialog.locator("summary");
    await close.press("Shift+Tab");
    await expect(receipt).toBeFocused();
    await receipt.press("Enter");
    await expect(dialog.locator("details")).toHaveAttribute("open", "");
    await receipt.press("Tab");
    await expect(close).toBeFocused();
    await close.press("Tab");
    await expect(dialog.getByRole("link", { name: "NVDA", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    if (lang === "en") {
      await expect(dialog.getByRole("link", { name: "View evidence", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
    }
    await expect(receipt).toBeFocused();
    await expect(receipt).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row).toBeFocused();

    await row.press("Enter");
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeFocused();
    expect(writes).toEqual([]);

    await row.press("Enter");
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.screenshot({ animations: "disabled", path: info.outputPath(`alert-detail-${lang}.png`) });
  });
}

test("short alert detail keeps the full receipt and close action reachable", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Explicit viewport loop runs once");
  await installDetailFixture(page, "en");
  for (const viewport of [{ width: 568, height: 320 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/alerts");
    const { dialog, close } = await openDetail(page, "en");
    await page.screenshot({ animations: "disabled", path: info.outputPath(`alert-detail-top-${viewport.width}x${viewport.height}.png`) });
    await withinViewport(page, dialog);
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await close.press("Shift+Tab");
    const receipt = dialog.locator("summary");
    await expect(receipt).toBeFocused();
    await expect(receipt).toBeInViewport();
    await receipt.press("Enter");
    await dialog.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(dialog.locator("details > div").last()).toBeInViewport();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`alert-detail-receipt-${viewport.width}x${viewport.height}.png`) });
    await receipt.press("Tab");
    await expect(close).toBeFocused();
    await withinViewport(page, close);
    await close.press("Enter");
    await expect(dialog).toBeHidden();
  }
});
