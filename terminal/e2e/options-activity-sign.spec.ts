import { expect, test } from "@playwright/test";

// Local response fixtures exercise the real Tape and its SSE consumer. The
// negative witness reproduces the Oct20 live display defect; it is not market
// data or a claim that a fixture qualifies a production source.
for (const lang of ["en", "zh"] as const) {
  test(`Tape preserves signed activity and missing baselines in ${lang}`, async ({ page, request }, testInfo) => {
    const original = await request.get("/api/flow?f=feed");
    expect(original.ok()).toBe(true);
    expect(original.headers()["x-flow-source"]).toBe("fixture");
    const feed = await original.json();
    feed.unusual_names = [
      { root: "TSLA", prem_z: -1.98 },
      { root: "AAPL", prem_z: 1.98 },
      { root: "QQQ", prem_z: null },
    ].map((row) => ({
      ...row, group: "Fixture comparison", group_zh: "测试比较",
      gross_premium_today: 125000, baseline_source: row.prem_z === null ? "missing" : "eod252",
      n_obs: row.prem_z === null ? 0 : 252, call_prem_share: 0.5, top_contracts: [],
    }));
    await page.addInitScript((locale) => {
      localStorage.setItem("mm.lang", locale);
      document.documentElement.setAttribute("data-lang", locale);
      document.documentElement.setAttribute("lang", locale === "zh" ? "zh-CN" : "en");
    }, lang);
    await page.route("**/api/flow/stream?f=feed", (route) => route.fulfill({
      status: 200, contentType: "text/event-stream",
      body: `data: ${JSON.stringify(feed)}\n\n`,
    }));
    await page.route("**/api/flow?f=feed", (route) => route.fulfill({ json: feed }));
    await page.goto("/options?tab=tape");
    const rail = page.locator(".flow-unusual-rail");
    await expect(rail).toHaveCount(1, { timeout: 15000 });
    // The existing phone layout deliberately hides this rail. Verify its
    // mounted labels and page containment without inventing a mobile surface.
    if (testInfo.project.name === "mobile") await expect(rail).toBeHidden();
    else await expect(rail).toBeVisible();
    const expected = lang === "zh"
      ? [["TSLA", "低于均值"], ["AAPL", "高于均值"], ["QQQ", "数据不足"]]
      : [["TSLA", "Below avg"], ["AAPL", "Above avg"], ["QQQ", "Unavailable"]];
    for (const [root, label] of expected) {
      const row = rail.locator(".flow-unusual-row").filter({
        has: page.locator(".flow-unusual-symbol", { hasText: new RegExp(`^${root}$`) }),
      });
      await expect(row.locator(".flow-unusual-band")).toHaveText(label);
    }
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth, viewport: window.innerWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${lang}-signed-activity.png`) });
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`Flow Desk preserves signed radar and inspector activity in ${lang}`, async ({ page, request }, testInfo) => {
    const response = await request.get("/api/flow?f=feed");
    expect(response.headers()["x-flow-source"]).toBe("fixture");
    const feed = await response.json();
    const tickerResponse = await request.get("/api/flow?f=ticker:NVDA");
    expect(tickerResponse.headers()["x-flow-source"]).toBe("fixture");
    const ticker = await tickerResponse.json();
    expect(ticker.day).toBeTruthy();
    feed.unusual_names = [{ root: "TSLA", prem_z: -1.98, group: "Technology", group_zh: "科技",
      gross_premium_today: 125000, baseline_source: "eod252", n_obs: 252, call_prem_share: 0.5, top_contracts: [] }];
    await page.addInitScript((locale) => {
      localStorage.setItem("mm.lang", locale);
      localStorage.setItem("flowdesk.tutorial.seen", "1");
    }, lang);
    await page.route(/\/api\/flow(?:\/stream)?\?/, (route) => {
      const kind = new URL(route.request().url()).searchParams.get("f");
      if (kind === "feed") return route.fulfill({
        status: 200,
        contentType: route.request().url().includes("/stream") ? "text/event-stream" : "application/json",
        body: route.request().url().includes("/stream") ? `data: ${JSON.stringify(feed)}\n\n` : JSON.stringify(feed),
      });
      if (kind?.startsWith("ticker:")) return route.fulfill({ json: {
        ...ticker, root: kind.slice(7), day: { ...ticker.day, prem_z: -1.98 },
      } });
      return route.continue();
    });
    await page.goto("/options?tab=desk");
    const radar = page.locator(".obs-fd-radar-z");
    await expect(radar.first()).toHaveText(lang === "zh" ? "低于均值" : "Below avg");
    await page.locator('[data-tut="flow-card"]').first().click();
    const inspector = page.locator('[data-tut="flow-inspector"]').first();
    await expect(inspector.getByText(lang === "zh" ? "当日活跃度" : "Day activity", { exact: true })).toBeVisible();
    const dayActivity = inspector.locator(".obs-insp-kv").filter({ has: page.getByText(lang === "zh" ? "当日活跃度" : "Day activity", { exact: true }) });
    await expect(dayActivity.locator(".obs-insp-kv-v")).toContainText(lang === "zh" ? "低于均值" : "Below avg");
    await expect(dayActivity.locator(".obs-insp-kv-note")).toContainText(lang === "zh" ? "未按日内时段调整" : "not adjusted for the time of day");
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${lang}-desk-signed-activity.png`) });
  });
}
