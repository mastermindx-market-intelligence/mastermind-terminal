import { expect, test, type Page, type TestInfo } from "@playwright/test";

const latestDate = "2024-03-04";
const bars = Array.from({ length: 260 }, (_, i) => {
  const close = 100 + i * 0.2 + Math.sin(i / 9) * 4;
  const date = new Date(Date.UTC(2024, 2, 4) - (259 - i) * 86400000).toISOString().slice(0, 10);
  return [date, close - 0.6, close + 1.4, close - 1.2, close, 1000000 + i * 1000];
});

function contrastRatio(foreground: string, background: string): number | null {
  const fg = foreground.match(/[\d.]+/g)?.map(Number);
  const bg = background.match(/[\d.]+/g)?.map(Number);
  if (!fg || !bg || (bg.length === 4 && bg[3] < 1)) return null;
  const luminance = (rgb: number[]) => rgb.slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function watchRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat(?:ion|ed)/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

async function capture(page: Page, info: TestInfo, phase: string) {
  const path = info.outputPath(`embed-data-${info.project.name}-${phase}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(phase, { path, contentType: "image/png" });
}

async function checkGeometry(page: Page, info: TestInfo, phase: string) {
  const geometry = await page.locator(".embed-root").evaluate((root) => {
    const chart = root.querySelector(".embed-chart-host")!.getBoundingClientRect();
    const attr = root.querySelector(".embed-attr")!.getBoundingClientRect();
    const dateElement = root.querySelector(".embed-date");
    const date = dateElement?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      rootWidth: root.clientWidth, rootScrollWidth: root.scrollWidth, rootScrollLeft: root.scrollLeft,
      coarsePointer: matchMedia("(pointer: coarse)").matches,
      dateColor: dateElement ? getComputedStyle(dateElement).color : null,
      background: getComputedStyle(root).backgroundColor,
      chart: { top: chart.top, bottom: chart.bottom, height: chart.height },
      attribution: { top: attr.top, bottom: attr.bottom, left: attr.left, right: attr.right, height: attr.height },
      date: date ? { left: date.left, right: date.right, height: date.height } : null,
    };
  });
  const dateContrast = geometry.dateColor ? contrastRatio(geometry.dateColor, geometry.background) : null;
  await info.attach(`geometry-${phase}`, { body: Buffer.from(JSON.stringify({ ...geometry, dateContrast }, null, 2)), contentType: "application/json" });
  expect(geometry.scrollWidth).toBe(geometry.documentWidth);
  expect(geometry.rootScrollWidth).toBe(geometry.rootWidth);
  expect(geometry.rootScrollLeft).toBe(0);
  expect(geometry.chart.height).toBeGreaterThan(100);
  if (await page.locator(".embed-attr").isVisible()) {
    expect(geometry.attribution.top).toBeGreaterThanOrEqual(geometry.chart.bottom);
    expect(geometry.attribution.height).toBeGreaterThanOrEqual(geometry.coarsePointer ? 44 : 24);
    expect(geometry.attribution.bottom + 3).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.attribution.left - 3).toBeGreaterThanOrEqual(0);
    expect(geometry.attribution.right + 3).toBeLessThanOrEqual(geometry.viewport.width);
  }
  if (geometry.date && geometry.date.height > 0) {
    if (dateContrast !== null) expect(dateContrast).toBeGreaterThanOrEqual(4.5);
    expect(geometry.date.left).toBeGreaterThanOrEqual(0);
    expect(geometry.date.right).toBeLessThanOrEqual(geometry.viewport.width);
  }
}

for (const lang of ["en", "zh"] as const) {
  test.describe(`daily data ${lang}`, () => {
    // A date-only bar must survive opposite sides of the date line unchanged.
    test.use({ timezoneId: lang === "en" ? "Pacific/Honolulu" : "Pacific/Kiritimati" });
    test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });
    const theme = lang === "zh" ? "light" : "dark";
    const emptyTitle = lang === "zh" ? "暂无图表数据" : "No chart data yet";
    const unavailableTitle = lang === "zh" ? "日线图表暂不可用" : "Daily chart unavailable";
    const url = `/embed/chart?symbol=nvda&lang=${lang}&theme=${theme}&range=3M`;

    test("dates the displayed bar and keeps attribution clear of the time axis", async ({ page }, info) => {
      const errors = watchRuntimeErrors(page);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/data/NVDA.json", async (route) => {
        await pending;
        await route.fulfill({ json: { bars } });
      });
      try {
        await page.goto(url);
        await expect(page.locator(".embed-skel")).toBeVisible();
        await expect(page.locator(".embed-skel-shimmer")).toHaveCSS("display", "none");
        await expect(page.locator(".embed-day-skel")).toBeVisible();
        await expect(page.locator(".embed-date")).toHaveCount(0);
        await expect(page.locator(".embed-root").getByRole("status")).toContainText(lang === "zh" ? "正在加载" : "Loading");
      } finally {
        release();
      }
      await expect(page.locator(".embed-chart-host canvas").first()).toBeVisible();
      await expect(page.locator(".embed-ribbon")).toHaveCSS("animation-name", "none");
      await capture(page, info, `${lang}-ready`);
      await expect(page.locator(".embed-date")).toHaveText(`${lang === "zh" ? "最新日线：" : "Latest daily bar: "}${latestDate}`);
      await expect(page.locator(".embed-date time")).toHaveAttribute("datetime", latestDate);
      await expect(page.locator(".embed-day-skel")).toHaveCount(0);
      await expect(page.locator(".embed-root").getByRole("status")).toContainText(latestDate);
      const settledStatus = await page.locator(".embed-root").getByRole("status").textContent();
      await checkGeometry(page, info, `${lang}-ready`);
      const average = page.getByRole("button", { name: lang === "zh" ? "切换50日移动平均线" : "Toggle the 50-day moving average" });
      await average.click();
      await expect(average).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "MAX", exact: true }).click();
      await expect(page.getByRole("button", { name: "MAX", exact: true })).toHaveAttribute("aria-pressed", "true");
      const plot = await page.locator(".embed-chart-host").boundingBox();
      await page.mouse.move(plot!.x + plot!.width * 0.5, plot!.y + plot!.height * 0.4);
      await expect(page.locator(".embed-ohlc")).toBeVisible();
      const hoveredDate = await page.locator(".embed-date time").getAttribute("datetime");
      expect(bars.some((bar) => bar[0] === hoveredDate)).toBe(true);
      expect(hoveredDate).not.toBe(latestDate);
      await expect(page.locator(".embed-date")).toHaveText(`${lang === "zh" ? "日线日期：" : "Daily bar: "}${hoveredDate}`);
      await expect(page.locator(".embed-root").getByRole("status")).toHaveText(settledStatus!);
      await page.mouse.move(1, 1);
      await expect(page.locator(".embed-date time")).toHaveAttribute("datetime", latestDate);
      const attribution = page.locator(".embed-attr");
      await expect(attribution).toHaveAttribute("href", "https://app.mastermind-x.com/terminal?sym=NVDA&from=embed");
      await attribution.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(attribution).toBeFocused();
      expect(await attribution.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
      await expect(attribution).toHaveCSS("outline-style", "solid");
      await capture(page, info, `${lang}-attribution-focus`);
      expect(errors).toEqual([]);
    });

    test("keeps confirmed absence distinct and stops loading indicators", async ({ page }, info) => {
      for (const response of ["empty", "404"] as const) {
        await page.unroute("**/data/NVDA.json");
        await page.route("**/data/NVDA.json", (route) => route.fulfill(response === "empty"
          ? { json: { bars: [] } }
          : { status: 404, json: { error: "not_found" } }));
        await page.goto(`${url}&case=${response}`);
        await expect(page.locator(".embed-empty-title")).toHaveText(emptyTitle);
        await expect(page.locator(".embed-empty-body")).toContainText("NVDA");
        await expect(page.locator(".embed-day-skel, .embed-skel, .embed-date, .embed-chart-host")).toHaveCount(0);
        await expect(page.locator(".embed-root").getByRole("status")).toHaveText(await page.locator(".embed-empty-body").textContent() ?? "");
      }
      await capture(page, info, `${lang}-empty`);
    });

    test("reports unavailable data without claiming the symbol has no history", async ({ page }, info) => {
      const cases = ["503", "network", "json", "envelope", "bars", "ohlc", "date", "duplicate"] as const;
      const errors = watchRuntimeErrors(page);
      for (const scenario of cases) {
        await page.unroute("**/data/NVDA.json");
        await page.route("**/data/NVDA.json", (route) => {
          if (scenario === "network") return route.abort("failed");
          if (scenario === "503") return route.fulfill({ status: 503, json: { error: "unavailable" } });
          if (scenario === "json") return route.fulfill({ contentType: "application/json", body: "{invalid" });
          const json = scenario === "envelope" ? {} : scenario === "bars" ? { bars: "invalid" }
            : scenario === "ohlc" ? { bars: [["2024-03-04", 1, 2, 0, null, 10]] }
            : scenario === "date" ? { bars: [["2024-02-30", 1, 2, 0, 1, 10]] }
            : { bars: [bars[0], bars[0]] };
          return route.fulfill({ json });
        });
        await page.goto(`${url}&case=${scenario}`);
        await expect(page.locator(".embed-empty-title")).toHaveText(unavailableTitle);
        await expect(page.locator(".embed-empty-body")).toContainText("NVDA");
        await expect(page.locator(".embed-empty-title")).not.toHaveText(emptyTitle);
        await expect(page.locator(".embed-day-skel, .embed-skel, .embed-date, .embed-chart-host")).toHaveCount(0);
        await expect(page.locator(".embed-root").getByRole("status")).toHaveText(await page.locator(".embed-empty-body").textContent() ?? "");
        await expect(page.locator(".embed-empty-link")).toHaveAttribute("href", "https://app.mastermind-x.com/terminal?sym=NVDA&from=embed");
      }
      await capture(page, info, `${lang}-unavailable`);
      await info.attach("outcomes", { body: Buffer.from(JSON.stringify({ cases, errors })), contentType: "application/json" });
      expect(errors).toEqual([]);
    });
  });
}

test("preserves compact native variants in short and narrow frames", async ({ page }, info) => {
  // Native preview simulation: its existing bridge owns the full-chart handoff.
  await page.addInitScript(() => {
    const messages: unknown[] = [];
    Object.assign(window, { __d06NativeMessages: messages, webkit: { messageHandlers: { mm: { postMessage(message: unknown) { messages.push(message); } } } } });
  });
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: info.project.name === "desktop" ? 900 : info.project.name === "tablet" ? 390 : 320, height: 300 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const lang = info.project.name === "desktop" ? "en" : "zh";
  const theme = info.project.name === "tablet" ? "light" : "dark";
  await page.route("**/data/NVDA.json", (route) => route.fulfill({ json: { bars } }));
  for (const [name, variant] of [
    ["normal", ""], ["hidden-header", "&hdr=0"],
    ["clean-header", "&clean=1&fs=1"], ["clean-hidden", "&clean=1&hdr=0&fs=1&transparent=1"],
  ] as const) {
    await page.goto(`/embed/chart?symbol=NVDA&lang=${lang}&theme=${theme}${variant}`);
    await expect(page.locator(".embed-chart-host canvas").first()).toBeVisible();
    await expect(page.locator(".embed-status").first()).toContainText(latestDate);
    if (variant.includes("hdr=0")) await expect(page.locator(".embed-head-quote")).toBeHidden();
    else {
      // Compact native mode puts the header BELOW the plot; (0, 0) is a real bar there.
      const dateBox = await page.locator(".embed-date").boundingBox();
      expect(dateBox).not.toBeNull();
      await page.mouse.move(dateBox!.x + dateBox!.width / 2, dateBox!.y + dateBox!.height / 2);
      await expect(page.locator(".embed-date time")).toHaveAttribute("datetime", latestDate);
    }
    if (variant.includes("clean=1")) {
      await expect(page.locator(".embed-attr")).toBeHidden();
      await expect(page.locator(".embed-legend")).toHaveCount(0);
      const initialUrl = page.url();
      await page.locator(".embed-fs").click();
      expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
      expect(await page.evaluate(() => (window as unknown as {__d06NativeMessages: unknown[]}).__d06NativeMessages)).toEqual([{type:"openFullChart"}]);
      expect(page.url()).toBe(initialUrl);
      await expect(page.locator(".embed-chart-host canvas").first()).toBeVisible();
    }
    if (variant.includes("transparent=1")) {
      const backgrounds = await page.evaluate(() => [document.documentElement, document.body].map((node) => getComputedStyle(node).backgroundColor));
      expect(backgrounds).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
    }
    await checkGeometry(page, info, name);
    await capture(page, info, name);
  }
  await page.unroute("**/data/NVDA.json");
  await page.route("**/data/NVDA.json", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto(`/embed/chart?symbol=NVDA&lang=${lang}&theme=light&clean=1&hdr=0`);
  await expect(page.locator(".embed-empty-title")).toHaveText(lang === "zh" ? "日线图表暂不可用" : "Daily chart unavailable");
  const colors = await page.locator(".embed-empty-body").evaluate((node) => ({
    foreground: getComputedStyle(node).color,
    background: getComputedStyle(node.closest(".embed-root")!).backgroundColor,
  }));
  const contrast = contrastRatio(colors.foreground, colors.background);
  expect(contrast).not.toBeNull();
  expect(contrast!).toBeGreaterThanOrEqual(4.5);
  await info.attach("unavailable-contrast", { body: Buffer.from(JSON.stringify({ ...colors, contrast })), contentType: "application/json" });
  await capture(page, info, "clean-unavailable");
  expect(errors).toEqual([]);
});
