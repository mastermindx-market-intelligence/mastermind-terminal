import { expect, test, type Page } from "@playwright/test";

async function setLanguage(page: Page, lang: "en" | "zh") {
  await page.evaluate((nextLang) => {
    localStorage.setItem("mm.lang", nextLang);
    document.documentElement.setAttribute("data-lang", nextLang);
    document.documentElement.setAttribute("lang", nextLang === "zh" ? "zh-CN" : "en");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, lang);
}

test("Prophet PERF renders the private forward ledger truthfully at every supported width", async ({ page }, testInfo) => {
  await page.goto("/options?tab=prophet");

  const prophet = page.locator(".obs-prophet");
  await expect(prophet).toBeVisible({ timeout: 15_000 });
  await prophet.getByRole("button", { name: "PERF", exact: true }).click();

  const panel = page.getByTestId("prophet-perf-panel");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole("heading", { name: "Forward track record" })).toBeVisible();

  const source = page.getByTestId("prophet-perf-source");
  await expect(source).toContainText("data/prophet/ledger.jsonl");
  await expect(source).toContainText("Sep 18, 2026");

  await expect(panel).toContainText("Closed plans");
  await expect(panel).toContainText("Raw underlying · mean");
  await expect(page.getByTestId("prophet-perf-raw-return-note")).toContainText(
    "Not option-contract return, portfolio return, benchmarked return, or alpha.",
  );
  await expect(page.getByTestId("prophet-perf-benchmark")).toContainText(
    "benchmark and excess returns are not shown",
  );

  await expect(page.getByTestId("prophet-perf-integrity")).toContainText(
    "Quarantined rows excluded",
  );
  await expect(page.getByTestId("prophet-perf-history-row")).toHaveCount(4);
  await expect(page.getByTestId("prophet-perf-history-row").first()).toContainText("AAA");
  await expect(page.getByTestId("prophet-perf-history-row").first()).toContainText("+6.50%");
  await expect(panel).toContainText("T1 close");
  await expect(panel).toContainText("No position");

  await expect(prophet.locator(".obs-prophet-center")).toHaveCount(0);
  await expect(prophet.locator(".obs-prophet-right")).toHaveCount(0);
  await expect(prophet.locator(".obs-prophet-status")).toHaveCount(0);

  const geometry = await panel.evaluate((root) => {
    const box = root.getBoundingClientRect();
    const host = root.closest(".obs-prophet-left")?.getBoundingClientRect();
    return {
      width: box.width,
      hostWidth: host?.width ?? 0,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    };
  });
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.width).toBeGreaterThanOrEqual(geometry.hostWidth - 2);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);

  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);

  await setLanguage(page, "zh");
  await expect(panel.getByRole("heading", { name: "前向记录" })).toBeVisible();
  await expect(panel).toContainText("已平仓计划");
  await expect(page.getByTestId("prophet-perf-raw-return-note")).toContainText(
    "不是期权合约收益、投资组合收益、基准收益或阿尔法",
  );
  await expect(page.getByTestId("prophet-perf-benchmark")).toContainText(
    "不显示基准收益或超额收益",
  );
  await expect(panel).toContainText("已排除隔离行");
  await expect(panel).toContainText("T1 平仓");

  await page.screenshot({
    path: testInfo.outputPath(testInfo.project.name + "-prophet-perf-zh.png"),
    fullPage: false,
  });
});


test("Prophet PERF fails visibly when the private projection is unavailable", async ({ page }) => {
  await page.route("**/api/flow?f=prophet_perf", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "feed unavailable" }),
    });
  });

  await page.goto("/options?tab=prophet");
  const prophet = page.locator(".obs-prophet");
  await expect(prophet).toBeVisible({ timeout: 15_000 });
  await prophet.getByRole("button", { name: "PERF", exact: true }).click();

  const state = page.getByTestId("prophet-perf-unavailable");
  await expect(state).toBeVisible({ timeout: 15_000 });
  await expect(state).toContainText("Track record unavailable");
  await expect(state).toContainText("private forward-ledger projection could not be read");
  await expect(prophet.locator(".obs-prophet-center")).toHaveCount(0);
  await expect(prophet.locator(".obs-prophet-right")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("0.00% alpha");
});

test("Prophet PERF distinguishes an empty effective ledger from an outage", async ({ page }) => {
  const empty = {
    schema: "prophet.perf_projection/v1",
    source: {
      path: "data/prophet/ledger.jsonl",
      schema: "prophet.ledger/v1",
      projection: "canonical_effective_ledger",
      latest_asof: null,
      latest_close_date: null,
      freshness_unavailable_reason: "no_effective_terminal_rows",
    },
    summary: {
      terminal_plan_count: 0,
      closed_plan_count: 0,
      no_entry_count: 0,
      outcome_counts: {
        T1_HIT: 0,
        T2_HIT: 0,
        INVALIDATED: 0,
        EXPIRED: 0,
        CLOSED_EARLY: 0,
        NO_ENTRY: 0,
      },
      raw_stock_return: {
        label: "Raw underlying return (unweighted per entered plan)",
        available_count: 0,
        unavailable_count: 0,
        mean_pct: null,
        median_pct: null,
        min_pct: null,
        max_pct: null,
        positive_count: 0,
        negative_count: 0,
        zero_count: 0,
        unavailable_reason: "no_canonical_stock_return_values",
      },
      benchmarked_performance: {
        available: false,
        benchmark_return_pct: null,
        excess_return_pct: null,
        unavailable_reason: "canonical_effective_ledger_has_no_benchmark_return_evidence",
      },
    },
    integrity: {
      canonical_row_count: 0,
      effective_row_count: 0,
      quarantined_excluded_count: 0,
      quarantined_id_count: 0,
      corrected_row_count: 0,
      correction_application_count: 0,
    },
    semantics: {
      outcome_count_basis: "Terminal ledger outcome labels only.",
      raw_stock_return_basis: "Unweighted per-plan underlying returns for entered plans.",
    },
    plans: [],
  };

  await page.route("**/api/flow?f=prophet_perf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(empty),
    });
  });

  await page.goto("/options?tab=prophet");
  const prophet = page.locator(".obs-prophet");
  await expect(prophet).toBeVisible({ timeout: 15_000 });
  await prophet.getByRole("button", { name: "PERF", exact: true }).click();

  await expect(page.getByTestId("prophet-perf-empty")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("prophet-perf-empty")).toContainText("No terminal plans yet");
  await expect(page.getByTestId("prophet-perf-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("prophet-perf-source")).toContainText("data/prophet/ledger.jsonl");
  await expect(page.getByTestId("prophet-perf-benchmark")).toContainText(
    "benchmark and excess returns are not shown",
  );
});
