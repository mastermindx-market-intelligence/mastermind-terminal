import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";

test.use({ timezoneId: "UTC" });

// Synthetic business data, real served appearance controls. No mode/CSS injection.



function themeFixture() {
  return {
    schema: "company_theme_exposure.v1", authority: "context_only", is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z", generation_id: "f".repeat(24), status: "ready",
    company: { ticker: "NVDA" },
    company_intelligence: { generation_id: "a".repeat(24), context_sha256: "9".repeat(64), latest_event_id: "cie_d8488221fd8c710c53d6537d", latest_event_call_date: "2026-05-20" },
    exposures: [{ theme_id: "ai_infrastructure", name_en: "AI Infrastructure", name_zh: "人工智能基础设施", basket_id: "ai_semiconductors", mapping_qualifier: "proxy" }],
    coverage: { status: "mapped", active_basket_count: 1, mapped_basket_count: 1, unmapped_basket_count: 0 },
    theme_state: { status: "fresh", as_of: "2026-08-01", sha256: "8".repeat(64) }, warnings: [] as string[],
  };
}
async function arrange(page: Page, zh: boolean, payload: unknown, status = 200) {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.addInitScript(zh => localStorage.setItem("mm.lang", zh ? "zh" : "en"), zh);
  await page.route("https://www.mastermind-x.com/mm_brain.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/api/event-workspace/**", route => route.fulfill({ status: 404, json: { ok: false, state: "error", available: false, error: { code: "not_found", message: "fixture uncovered", retryable: false } } }));
  await page.route("**/api/company-intelligence/NVDA**", route => route.fulfill({ json: { ok: true, state: "ready", context: contextFixture() } }));
  await page.route("**/api/company-institutional-context/NVDA**", route => route.fulfill({ status: 404, json: { ok: false, state: "error", error: { code: "not_found", message: "fixture uncovered", retryable: false } } }));
  await page.route("**/api/company-theme-context/NVDA**", route => route.fulfill({ status, json: payload }));
  await page.goto("/analysis?symbol=NVDA&page=intelligence");
  await expect(page.locator(".ci-page")).toBeVisible({ timeout: 30_000 });
  return browserErrors;
}
async function selectAppearance(page: Page, zh: boolean, mode: "dark" | "light" | "auto", returnToAnalysis = true) {
  // /analysis's incumbent local preview is guest. The existing /terminal E2E
  // identity seam supplies a fixture account to the real served settings host.
  // Select there, then navigate to the card; no auth-plane or mode injection.
  if (!new URL(page.url()).pathname.startsWith("/terminal")) await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  const mobile = (page.viewportSize()?.width || 1440) <= 860;
  await page.locator(mobile ? ".mobilebar .avatar" : "header.topbar .avatar").first().click({ timeout: 20_000 });
  await expect(page.locator(".acs-card")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: zh ? "偏好" : "Preferences", exact: true }).click({ timeout: 20_000 });
  const group = page.getByRole("group", { name: zh ? "外观" : "Appearance", exact: true });
  const label = mode === "light" ? (zh ? "浅色" : "Light") : mode === "dark" ? (zh ? "深色" : "Dark") : (zh ? "自动" : "Auto");
  await group.getByRole("button", { name: label, exact: true }).click({ timeout: 20_000 });
  await expect(group.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".acs-card")).not.toBeVisible();
  if (returnToAnalysis) {
    await page.goto("/analysis?symbol=NVDA&page=intelligence");
    await expect(page.locator(".ci-page")).toBeVisible({ timeout: 30_000 });
  }
}
async function assertAppearance(page: Page, mode: "dark" | "light") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(mode === "light" ? "rgb(247, 248, 250)" : "rgb(10, 11, 14)");
}
async function proof(page: Page, name: string, outputPath: (path: string) => string) {
  await page.screenshot({ path: outputPath(name + "-shell.png") });
  const card = page.locator(".ci-theme-card");
  await card.scrollIntoViewIfNeeded();
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, width: document.documentElement.scrollWidth }));
  expect(widths.width).toBeLessThanOrEqual(widths.viewport + 1);
  await card.screenshot({ path: outputPath(name + "-card.png") });
}

for (const mode of ["dark", "light"] as const) for (const zh of [false, true]) {
  test(`existing card ages at UTC expiry without reloading or fetching (${mode}/${zh ? "ZH" : "EN"})`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.clock.install({ time: new Date("2026-08-06T23:00:00Z") });
    let reads = 0;
    page.on("request", request => { if (request.url().includes("/api/company-theme-context/NVDA")) reads++; });
    const errors = await arrange(page, zh, { ok: true, state: "ready", context: themeFixture() });
    await selectAppearance(page, zh, mode);
    await assertAppearance(page, mode);
    const footer = page.locator(".ci-theme-footer");
    await expect(footer).toContainText(zh ? "新鲜" : "Fresh");
    await proof(page, `${mode}-${zh ? "zh" : "en"}-fresh`, info.outputPath.bind(info));
    const before = reads;
    await page.clock.fastForward(3_600_000);
    await expect(footer).toContainText(zh ? "已过期" : "Stale");
    await expect(page.locator(".ci-theme-header")).toContainText(zh ? "最近验证" : "Last verified");
    await expect(page.locator(".ci-theme-warning")).toContainText(zh ? "独立主题状态凭证已过期" : "theme-state receipt is stale");
    expect(reads).toBe(before);
    await proof(page, `${mode}-${zh ? "zh" : "en"}-expired`, info.outputPath.bind(info));
    const eventSelector = page.getByLabel(zh ? "选择公司事件" : "Select company event");
    await eventSelector.selectOption("cie_4c0410e7c4358283cf37a557", { timeout: 20_000 });
    await expect(page.locator(".ci-theme-boundary")).toBeVisible();
    await expect(page.locator(".ci-theme-card")).not.toContainText(zh ? "人工智能基础设施" : "AI Infrastructure");
    await proof(page, `${mode}-${zh ? "zh" : "en"}-historical`, info.outputPath.bind(info));
    expect(errors).toEqual([]);
  });

  for (const variant of ["source-stale", "missing", "invalid", "future", "future-generation", "last-good", "mixed", "unmapped-only", "empty", "refreshing", "unavailable"] as const) {
    test(`degraded existing theme card: ${variant} (${mode}/${zh ? "ZH" : "EN"})`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.clock.setFixedTime(new Date("2026-08-01T12:00:01Z"));
      const body = themeFixture();
      let expected = zh ? "新鲜" : "Fresh";
      if (variant === "source-stale") { body.theme_state.status = "stale"; body.status = "partial"; body.warnings = ["theme_state_stale"]; expected = zh ? "已过期" : "Stale"; }
      if (variant === "missing" || variant === "invalid") {
        Object.assign(body.theme_state, { status: variant, as_of: null, sha256: variant === "missing" ? null : "8".repeat(64) });
        body.status = "partial"; body.warnings = [`theme_state_${variant}`]; expected = variant === "missing" ? (zh ? "缺失" : "Missing") : (zh ? "无效" : "Invalid");
      }
      if (variant === "future") { body.theme_state.as_of = "2026-08-02"; expected = zh ? "未来日期" : "Future date"; }
      if (variant === "future-generation") body.generated_at = "2026-08-02T12:00:00Z";
      if (variant === "mixed") { body.coverage = { status: "mixed", active_basket_count: 2, mapped_basket_count: 1, unmapped_basket_count: 1 }; body.status = "partial"; body.warnings = ["active_membership_unmapped"]; }
      if (variant === "unmapped-only") { body.coverage = { status: "unmapped_only", active_basket_count: 1, mapped_basket_count: 0, unmapped_basket_count: 1 }; body.exposures = []; body.status = "partial"; body.warnings = ["active_membership_unmapped"]; }
      if (variant === "empty") { body.coverage = { status: "no_active_membership", active_basket_count: 0, mapped_basket_count: 0, unmapped_basket_count: 0 }; body.exposures = []; }
      if (variant === "refreshing") body.company_intelligence.generation_id = "7".repeat(24);
      const payload = variant === "unavailable" ? { ok: false, state: "error", error: { code: "upstream_unavailable", message: "opaque fixture outage", retryable: true } } : { ok: true, state: variant === "last-good" || variant === "source-stale" ? "stale" : variant === "future" ? "partial" : body.status, context: body };
      const errors = await arrange(page, zh, payload, variant === "unavailable" ? 503 : 200);
      await selectAppearance(page, zh, mode);
      await assertAppearance(page, mode);
      if (variant === "refreshing") {
        await expect(page.locator(".ci-theme-unavailable")).toContainText(zh ? "主题背景正在刷新" : "Theme context is refreshing");
        await expect(page.locator(".ci-theme-card")).not.toContainText(zh ? "人工智能基础设施" : "AI Infrastructure");
      } else if (variant === "unavailable" || variant === "future-generation") {
        await expect(page.locator(".ci-theme-unavailable")).toContainText(zh ? "已验证主题背景暂不可用" : "Verified theme context unavailable");
      } else {
        await expect(page.locator(".ci-theme-footer")).toContainText(expected);
        if (variant === "future") await expect(page.locator(".ci-theme-header")).toContainText(zh ? "部分覆盖" : "Partial");
        if (variant === "last-good") await expect(page.locator(".ci-theme-header")).toContainText(zh ? "最近验证" : "Last verified");
        if (variant === "empty") await expect(page.locator(".ci-theme-empty")).toContainText(zh ? "不在当前策展篮子名册" : "no active membership");
        if (variant === "unmapped-only") await expect(page.locator(".ci-theme-empty")).toContainText(zh ? "不会为其推断主题标签" : "no theme label is inferred");
      }
      await proof(page, `${mode}-${zh ? "zh" : "en"}-${variant}`, info.outputPath.bind(info));
      expect(errors).toEqual([]);
    });
  }
}

// Synthetic owner-shaped fixtures; no natural-publication or production claim.
for (const zh of [false, true]) {
  test(`actual appearance selection survives navigation and a new cold context (${zh ? "ZH" : "EN"})`, async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    await page.clock.setFixedTime(new Date("2026-08-01T12:00:01Z"));
    await arrange(page, zh, { ok: true, state: "ready", context: themeFixture() });
    await selectAppearance(page, zh, "light"); await assertAppearance(page, "light");
    await proof(page, `control-light-${zh ? "zh" : "en"}`, info.outputPath.bind(info));
    // New page/context receives only the browser's actual stored selection.
    // No init script sets theme or html attributes.
    const cold = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: await page.context().storageState(), viewport: page.viewportSize()!, locale: zh ? "zh-CN" : "en-US" });
    try {
      const next = await cold.newPage();
      await next.clock.setFixedTime(new Date("2026-08-01T12:00:01Z"));
      await arrange(next, zh, { ok: true, state: "ready", context: themeFixture() });
      await assertAppearance(next, "light");
      await selectAppearance(next, zh, "dark"); await assertAppearance(next, "dark");
      await next.goto("/analysis?symbol=NVDA&page=intelligence");
      await expect(next.locator(".ci-page")).toBeVisible({ timeout: 30_000 });
      await assertAppearance(next, "dark");
      await proof(next, `control-dark-cold-${zh ? "zh" : "en"}`, info.outputPath.bind(info));
    } finally { await cold.close(); }
  });
}

for (const zh of [false, true]) {
  test(`shared header brand remains legible in served light and preserves dark (${zh ? "ZH" : "EN"})`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.clock.setFixedTime(new Date("2026-08-01T12:00:01Z"));
    await arrange(page, zh, { ok: true, state: "ready", context: themeFixture() });
    const selector = (page.viewportSize()?.width || 1440) <= 860 ? ".mobilebar .m-brand > svg" : "header.topbar .brand > svg";
    const inspect = () => page.locator(selector).evaluate((svg) => {
      const rect = svg.querySelector("rect")!, path = svg.querySelector("path")!;
      return { svg: svg.outerHTML, rectFill: getComputedStyle(rect).fill, pathStroke: getComputedStyle(path).stroke, rect: [rect.getAttribute("x"), rect.getAttribute("y"), rect.getAttribute("width"), rect.getAttribute("height"), rect.getAttribute("rx")], duplicateGradientIds: document.querySelectorAll('[id="mbT"]').length };
    });
    const dark = await inspect();
    await selectAppearance(page, zh, "light");
    const light = await inspect();
    await fs.writeFile(info.outputPath("brand-computed.json"), JSON.stringify({ dark, light }, null, 2));
    expect(light.rectFill).toBe("rgb(41, 98, 255)");
    expect(light.pathStroke).toBe("rgb(255, 255, 255)");
    expect(light.rect).toEqual(dark.rect); expect(light.svg).toBe(dark.svg);
    await page.locator(selector).screenshot({ path: info.outputPath(`brand-light-${zh ? "zh" : "en"}.png`) });
    await selectAppearance(page, zh, "dark");
    expect(await inspect()).toEqual(dark);
    await page.locator(selector).screenshot({ path: info.outputPath(`brand-dark-${zh ? "zh" : "en"}.png`) });
  });

  test(`auto survives route navigation, local19:00 and focus resume (${zh ? "ZH" : "EN"})`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.clock.install({ time: new Date("2026-08-01T18:00:00Z") });
    await arrange(page, zh, { ok: true, state: "ready", context: themeFixture() });
    await selectAppearance(page, zh, "auto"); await assertAppearance(page, "light");
    await page.clock.fastForward(3_600_000); await assertAppearance(page, "dark");
    await page.clock.setSystemTime(new Date("2026-08-02T08:00:00Z"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await assertAppearance(page, "light");
    await proof(page, `auto-resumed-light-${zh ? "zh" : "en"}`, info.outputPath.bind(info));
  });
}

for (const zh of [false, true]) {
  test(`chart palette changes in place through real appearance and directional controls (${zh ? "ZH" : "EN"})`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.clock.setFixedTime(new Date("2026-08-01T12:00:01Z"));
    await arrange(page, zh, { ok: true, state: "ready", context: themeFixture() });
    await selectAppearance(page, zh, "dark", false);
    const canvas = page.locator(".chart-wrap canvas").first();
    await expect(canvas).toBeVisible({ timeout: 45_000 });
    const initialCanvas = await canvas.elementHandle();
    const records: unknown[] = [];
    const read = () => page.evaluate(() => {
      type ProofWindow = Window & { __mmChartAxisOpts?: () => { rowCount?: number; contextProof?: { colors?: { up: string; down: string } } }; __mmChartOwnership?: () => { engine?: number } };
      const win = window as ProofWindow;
      return { axis: win.__mmChartAxisOpts?.(), ownership: win.__mmChartOwnership?.(), labelBg: getComputedStyle(document.documentElement).getPropertyValue("--chart-label-bg").trim() };
    });
    await expect.poll(async () => (await read()).axis?.rowCount || 0, { timeout: 45_000 }).toBeGreaterThan(0);
    for (const mode of ["light", "dark"] as const) {
      await selectAppearance(page, zh, mode, false); await assertAppearance(page, mode);
      for (const direction of ["west", "east"] as const) {
        const mobile = (page.viewportSize()?.width || 1440) <= 860;
        await page.locator(mobile ? ".mobilebar .avatar" : "header.topbar .avatar").first().click({ timeout: 20_000 });
        await page.getByRole("tab", { name: zh ? "终端" : "Terminal", exact: true }).click({ timeout: 20_000 });
        const group = page.getByRole("group", { name: zh ? "涨跌颜色" : "Up / Down colors", exact: true });
        await group.getByRole("button", { name: direction === "west" ? (zh ? "绿涨红跌" : "Green up") : (zh ? "红涨绿跌" : "Red up"), exact: true }).click({ timeout: 20_000 });
        await page.keyboard.press("Escape"); await expect(page.locator(".acs-card")).not.toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-updown", direction);
        const green = mode === "light" ? "#1f9a55" : "#26c281", red = mode === "light" ? "#cf4040" : "#f0566b";
        await expect.poll(async () => (await read()).axis?.contextProof?.colors).toMatchObject({ up: direction === "west" ? green : red, down: direction === "west" ? red : green });
        expect(await initialCanvas!.evaluate((el) => el.isConnected && document.querySelector(".chart-wrap canvas") === el)).toBe(true);
        expect((await read()).ownership?.engine).toBe(1);
        if (mode === "light") expect((await read()).labelBg).toBe("#2a2e38");
        const box = await page.locator(".chart-wrap").first().boundingBox();
        await page.mouse.move(box!.x + box!.width * .6, box!.y + box!.height * .25);
        // Read actual canvas pixels: a CSS-token read alone cannot prove the
        // already-mounted engine or its crosshair accepted the new palette.
        const painted = (rgb: number[]) => page.locator(".chart-wrap canvas").evaluateAll((canvases, rgb) => {
          let count = 0;
          for (const node of canvases) {
            const canvas = node as HTMLCanvasElement, ctx = canvas.getContext("2d");
            if (!ctx || !canvas.width || !canvas.height) continue;
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let n = 0; n < data.length; n += 4) if (data[n] === rgb[0] && data[n + 1] === rgb[1] && data[n + 2] === rgb[2] && data[n + 3] > 0) count++;
          }
          return count;
        }, rgb);
        const upRgb = (mode === "light" ? (direction === "west" ? [31,154,85] : [207,64,64]) : (direction === "west" ? [38,194,129] : [240,86,107]));
        await expect.poll(() => painted(upRgb), { timeout: 15_000 }).toBeGreaterThan(20);
        if (mode === "light") await expect.poll(() => painted([42,46,56]), { timeout: 15_000 }).toBeGreaterThan(20);
        await page.locator(".chart-wrap").first().screenshot({ path: info.outputPath(`chart-${mode}-${direction}-${zh ? "zh" : "en"}.png`) });
        records.push({ mode, direction, proof: await read() });
      }
    }
    await fs.writeFile(info.outputPath("chart-live-readback.json"), JSON.stringify(records, null, 2));
  });
}

const SHA = "a".repeat(64);
const metrics = (overrides: Record<string, number | null> = {}) => ({
  sentiment: 68,
  performance: 72,
  confidence: 64,
  combined: 68,
  call_positivity: 71,
  management_confidence: 66,
  analyst_criticism: 22,
  future_outlook: 74,
  revenue_growth_pct: 18.4,
  eps_growth_pct: 21.1,
  gross_margin_pct: 74.2,
  analysts_count: 12,
  questions_count: 18,
  ...overrides,
});

function event(id: string, fiscalYear: number, fiscalQuarter: number, callDate: string, summary: string) {
  const eventMetrics = metrics();
  return {
    event_id: id,
    ticker: "NVDA",
    fiscal_year: fiscalYear,
    fiscal_quarter: fiscalQuarter,
    call_date: callDate,
    summary,
    highlights: ["Data-center demand remained broad across the period."],
    positive_highlights: ["Revenue growth accelerated with broad data-center demand."],
    negative_highlights: ["Supply and deployment timing remain watch items."],
    key_quote: "We continue to see broad demand across our platform.",
    tags: ["data center", "demand"],
    metrics: eventMetrics,
    field_lineage: {
      summary: "earnings_history",
      key_quote: "earnings_history",
      metrics: Object.fromEntries(Object.keys(eventMetrics).map((key) => [key, "score_overlay"])),
      positive_highlights: ["earnings_history"],
      negative_highlights: ["earnings_history"],
      highlights: ["earnings_history"],
      tags: { "data center": "earnings_history", demand: "earnings_history" },
    },
    previous_event_deltas: metrics({ revenue_growth_pct: 2.1, eps_growth_pct: 1.6, gross_margin_pct: 0.4, questions_count: 3 }),
    sources: [
      {
        source_ref: "earnings_history",
        kind: "earnings_history",
        status: "present",
        citation_precision: "document",
        url: "https://investor.nvidia.com/earnings",
        receipt: { source_hash: SHA, source_date: callDate, record_id: `${id}-earnings` },
      },
      {
        source_ref: "score_overlay",
        kind: "score_overlay",
        status: "metadata_only",
        citation_precision: "metadata",
        url: null,
        receipt: { source_hash: "b".repeat(64), source_date: callDate, record_id: `${id}-overlay` },
      },
      {
        source_ref: "transcript",
        kind: "transcript",
        status: "present",
        citation_precision: "document",
        url: `/data/tx/NVDA/${fiscalYear}Q${fiscalQuarter}.json.gz`,
        receipt: { source_hash: "c".repeat(64), source_date: callDate, record_id: `${fiscalYear}Q${fiscalQuarter}` },
      },
    ],
    claim_citations_pending: true,
  };
}

function contextFixture() {
  const latest = event(
    "cie_d8488221fd8c710c53d6537d",
    2026,
    1,
    "2026-05-20",
    "NVIDIA reported broad platform demand, with revenue growth and gross-margin discipline remaining central to the event read-through.",
  );
  const prior = event(
    "cie_4c0410e7c4358283cf37a557",
    2025,
    4,
    "2026-02-19",
    "The preceding event established the demand and supply baseline for this quarter-over-quarter comparison.",
  );
  return {
    schema: "company_intelligence_context.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z",
    generation_id: "a".repeat(24),
    company: { ticker: "NVDA", display_name: "NVIDIA Corporation", exchange: null },
    status: "ready",
    latest_event_id: latest.event_id,
    latest_event: latest,
    history: [latest, prior],
    topics: {
      timeline: [
        { tag: "data center", first_event_id: prior.event_id, last_event_id: latest.event_id, event_count: 2, status: "persistent" },
        { tag: "demand", first_event_id: latest.event_id, last_event_id: latest.event_id, event_count: 1, status: "added" },
      ],
      added: ["demand"],
      dropped: [],
      persistent: ["data center"],
    },
    source_completeness: {
      earnings_history: { status: "present", event_count: 2 },
      score_overlay: { status: "metadata_only", event_count: 2 },
      transcripts: { status: "present", event_count: 2 },
    },
    warnings: [],
    missing_sources: [],
    transport_lineage: {
      earnings_manifest: { generation_id: "b".repeat(24), sha256: "d".repeat(64) },
      tx_index: { schema: "mastermind.tx-index/v1", generation_id: "c".repeat(24), sha256: "e".repeat(64) },
      builder: "company_intelligence.v1",
    },
  };
}
