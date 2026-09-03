import { expect, test, type Page } from "@playwright/test";

async function armTerminalVisualReady(page: Page) {
  await page.addInitScript(() => {
    const readyWindow = window as Window & { __mmResponsiveVisualReady?: boolean };
    readyWindow.__mmResponsiveVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmResponsiveVisualReady = true;
    }, { once: true });
  });
}

async function waitForTerminalVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() =>
      Boolean((window as Window & { __mmResponsiveVisualReady?: boolean }).__mmResponsiveVisualReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

test("the canonical Terminal shell works at its supported responsive widths", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.set", JSON.stringify({
      tableView: true,
      cols: { last: true, changePct: true, change: false, volume: false, ext: true },
      disp: "symbol",
      logo: false,
      colW: {},
    }));
    localStorage.removeItem("mm.setVersion");
  });
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");

  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-body")).toBeVisible();
  // The shell is server-rendered before React attaches toolbar/settings handlers.
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await waitForTerminalVisualReady(page);

  const desktop = testInfo.project.name === "desktop";
  const logos = page.locator(".wl-row .asset-logo");
  await expect.poll(() => logos.count()).toBeGreaterThan(0);
  if (desktop) await expect(logos.first()).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("mm.setVersion"))).toBe("1");
  const migrated = await page.evaluate(() => ({
    version: localStorage.getItem("mm.setVersion"),
    settings: JSON.parse(localStorage.getItem("mm.set") || "{}"),
  }));
  expect(migrated.version).toBe("1");
  expect(migrated.settings.logo).toBe(true);
  if (desktop) {
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".mobilebar")).toBeHidden();
    await expect(page.locator(".m-symbar")).toBeHidden();
  } else {
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(page.locator(".mobilebar")).toBeVisible();
    await expect(page.locator(".m-symbar")).toContainText("NVDA");

    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator(".m-drawer.open")).toBeVisible();
    await page.mouse.click((page.viewportSize()?.width ?? 390) - 8, 100);
    await expect(page.locator(".m-drawer.open")).toBeHidden();

    if (testInfo.project.name === "mobile") {
      // R2: the phone's top toolbar row and floating drawing dock are replaced by the bottom
      // roller strip — its wheels own symbol + interval and its pencil/••• own the sheets.
      // mobile-chart-chrome.spec.ts covers that chrome in full.
      await expect(page.locator(".chart-tabs")).toBeHidden();
      await expect(page.locator(".ds-dock")).toBeHidden();
      const strip = page.getByTestId("roller-strip");
      await expect(strip).toBeVisible();
      await expect(page.getByTestId("roller-symbol")).toHaveAttribute("aria-valuetext", "NVDA");
      await expect(page.getByTestId("roller-interval")).toBeVisible();
    } else {
      await page.locator(".tfbtn-edit").click();
      await expect(page.locator(".msheet")).toBeVisible();
      await expect(page.locator(".msheet-row").filter({ hasText: /^4h/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".msheet")).toBeHidden();
    }
  }

  const settingsButton = desktop
    ? page.locator(".topbar button.avatar")
    : page.locator(".mobilebar button.avatar");
  await settingsButton.click();
  const settingsDialog = page.locator(".acs-card");
  await expect(settingsDialog).toBeVisible({ timeout: 10_000 });
  await expect(settingsDialog).toHaveAttribute("role", "dialog");
  await expect(settingsDialog).toHaveAttribute("aria-label", "Terminal");
  await expect(settingsDialog.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  if (testInfo.project.name === "mobile") {
    const settingsTabs = settingsDialog.locator(".acs-nav");
    const tabStrip = await settingsTabs.evaluate((el) => {
      const css = getComputedStyle(el);
      return {
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        overflowX: css.overflowX,
        touchAction: css.touchAction,
      };
    });
    expect(tabStrip.scrollWidth).toBeGreaterThan(tabStrip.clientWidth);
    expect(tabStrip.overflowX).toBe("auto");
    expect(tabStrip.touchAction).toBe("pan-x");
    await settingsTabs.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect.poll(() => settingsTabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  }
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-terminal-settings.png`),
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(settingsDialog).toBeHidden();

  if (!desktop) {
    // Tapping the mobile ticker is navigation into the watchlist hub, not an implicit search.
    // R2c: the phone presents that hub as a drag-to-size drawer, the tablet as the centred
    // near-full-page sheet. Same content and same verbs either way — only the frame differs.
    const phone = testInfo.project.name === "mobile";
    await page.locator(".m-symbar").click();
    const searchHub = page.locator(phone ? ".msheet-search" : ".smodal-hub");
    const searchInput = searchHub.getByPlaceholder("Symbol or company name");
    const viewToggle = searchHub.locator(".sh-view-toggle");
    const closeSearch = async () => {
      if (phone) await page.keyboard.press("Escape");
      else await searchHub.locator(".smodal-title-bar .esc").click();
    };
    await expect(searchHub.locator(".s-home")).toBeVisible();
    await expect(searchInput).not.toBeFocused();
    await expect(viewToggle).toHaveText("Recent");
    await searchHub.screenshot({
      path: testInfo.outputPath(`${testInfo.project.name}-search-watchlist.png`),
    });

    // The explicit action can show Recent without summoning the keyboard. NVDA arrived through the
    // route (the same path Macro Dashboard uses), so it must be recorded as viewed without a search.
    // The inverse action restores the active watchlist; focusing the field is the keyboard path.
    await viewToggle.click();
    await expect(searchHub.locator(".s-home")).toHaveCount(0);
    await expect(searchInput).not.toBeFocused();
    await expect(viewToggle).toHaveText("Watchlist");
    await expect(searchHub.locator(".sres-section-hd")).toHaveText("Recently viewed");
    await expect(searchHub.locator(".sres .r").first().locator(".tk")).toHaveText("NVDA");
    await searchHub.screenshot({
      path: testInfo.outputPath(`${testInfo.project.name}-search-recent.png`),
    });
    await viewToggle.click();
    await expect(searchHub.locator(".s-home")).toBeVisible();
    await searchInput.click();
    await expect(searchInput).toBeFocused();
    await expect(searchHub.locator(".s-home")).toHaveCount(0);
    await expect(viewToggle).toHaveText("Watchlist");
    // Typing a symbol is not a view. Leaving without opening AAPL must not add it to Recent.
    await searchInput.fill("AAPL");
    await expect(searchHub.locator(".sres .r").first().locator(".tk")).toHaveText("AAPL");
    await closeSearch();
    await expect(searchHub).toHaveCount(0);
    await page.locator(".m-symbar").click();
    await searchHub.locator(".sh-view-toggle").click();
    await expect(searchHub.locator(".sres .tk")).toHaveText(["NVDA"]);
    await closeSearch();
    await expect(searchHub).toHaveCount(0);
  }

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-responsive.png`),
    fullPage: false,
  });
});

test("the search watchlist shows the regular-session price and change", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "the watchlist-home state is mobile Terminal navigation");
  const zh = testInfo.project.name === "tablet";
  if (zh) {
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      document.documentElement.setAttribute("lang", "zh-CN");
    });
  }

  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || "NVDA").split(",").filter(Boolean);
    const quotes = Object.fromEntries(syms.map((sym) => [sym, sym === "NVDA" ? {
      sym,
      last: 192.34,
      chg: 1.27,
      regularPrice: 192.34,
      regularChg: 1.27,
      basis: "DELAYED_15M",
      marketSession: "closed",
    } : sym === "AAPL" ? {
      sym,
      last: 281.42,
      chg: -0.83,
      regularPrice: 281.42,
      regularChg: -0.83,
      basis: "DELAYED_15M",
      marketSession: "closed",
    } : null]));
    await route.fulfill({ json: { quotes } });
  });

  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await waitForTerminalVisualReady(page);

  await page.locator(".m-symbar").click();

  const hub = page.locator(testInfo.project.name === "mobile" ? ".msheet-search" : ".smodal-hub");
  await expect(hub).toBeVisible();
  if (zh) await expect(hub).toContainText("代码搜索");

  const nvda = hub.locator(".s-home .r").filter({ has: page.locator(".tk", { hasText: /^NVDA$/ }) }).first();
  await expect(nvda).toBeVisible();
  await expect(nvda.locator(".s-row-id .mkt")).toHaveText("Equities");
  await expect(nvda.locator(".s-row-quote")).toHaveAttribute("data-quote-source", "quote");
  await expect(nvda.locator(".s-row-price")).toHaveText("192.34");
  await expect(nvda.locator(".s-row-change")).toHaveText("+1.27%");
  await expect(nvda.locator(".s-row-change")).toHaveClass(/up/);
  await expect(nvda.locator(".vr > .mkt")).toHaveCount(0);
  await expect(nvda.locator(".verd")).toHaveCount(0);

  const aapl = hub.locator(".s-home .r").filter({ has: page.locator(".tk", { hasText: /^AAPL$/ }) }).first();
  await expect(aapl.locator(".s-row-price")).toHaveText("281.42");
  await expect(aapl.locator(".s-row-change")).toHaveText("-0.83%");
  await expect(aapl.locator(".s-row-change")).toHaveClass(/down/);

  const geometry = await nvda.evaluate((row) => {
    const identity = row.querySelector<HTMLElement>(".meta")?.getBoundingClientRect();
    const quote = row.querySelector<HTMLElement>(".s-row-quote")?.getBoundingClientRect();
    const root = row.getBoundingClientRect();
    return {
      separated: Boolean(identity && quote && identity.right <= quote.left),
      contained: Boolean(quote && quote.right <= root.right + 0.5),
    };
  });
  expect(geometry).toEqual({ separated: true, contained: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await hub.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-search-watchlist-live-quotes${zh ? "-zh" : ""}.png`),
  });
});

test("Discover loads company logos in symbol rows", async ({ page }, testInfo) => {
  const logoRequests: string[] = [];
  await page.route("https://img.logo.dev/**", async (route) => {
    const url = route.request().url();
    logoRequests.push(url);
    if (url.includes("/ticker/MU?")) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2962ff"/><path d="M18 46 32 15l14 31-14-8z" fill="white"/></svg>',
    });
  });

  await page.goto("/discover");

  const rows = page.locator("table.scr2 tbody tr").filter({ has: page.locator(".sym-cell") });
  await expect(rows.first()).toBeVisible();
  const logos = rows.locator(".asset-logo");
  await expect(logos.first()).toBeVisible();
  await expect(logos.first().locator("img")).toBeVisible();
  await expect.poll(() => logoRequests.length).toBeGreaterThan(0);
  await expect(logos.first().locator("img")).toHaveAttribute("src", /https:\/\/img\.logo\.dev\/name\/Micron%20Technology/);

  const iconSize = await logos.first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(iconSize).toEqual({ width: 24, height: 24 });
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-discover-logos.png`),
    fullPage: false,
  });
});

test("regular-session performance stays primary while extended pricing is separate", async ({ page }, testInfo) => {
  const regularClose = 390.54;
  const previousClose = 393.33;
  const regularChange = ((regularClose - previousClose) / previousClose) * 100;

  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || "NVDA").split(",");
    const quotes = Object.fromEntries(syms.map((sym) => [sym, sym === "NVDA" ? {
      sym,
      last: 421.14,           // deliberately contaminated raw feed value
      chg: 7.84,
      close: regularClose,
      prevClose: previousClose,
      regularPrice: regularClose,
      regularChg: regularChange,
      basis: "DELAYED_15M",
      marketSession: "post",
      extPrice: 421.14,
      extChg: 7.84,
      extTs: 1_785_533_400,
      extSession: "post",
    } : null]));
    await route.fulfill({ json: { quotes } });
  });
  await page.route("**/api/ext-quote?**", async (route) => {
    await route.fulfill({ json: { quotes: {
      NVDA: { extPrice: 421.14, extChg: 7.84, extTs: 1_785_533_400, extSession: "post" },
    } } });
  });

  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await waitForTerminalVisualReady(page);

  if (testInfo.project.name === "desktop") {
    await expect(page.locator(".detail-hd .px")).toContainText("390.54");
    await expect(page.locator(".detail-hd .px")).toContainText("-0.71%");
    await expect(page.locator(".detail-hd .ah-block")).toContainText("421.14");
    await expect(page.locator(".detail-hd .ah-block")).toContainText("+7.84%");
  } else {
    const regular = page.locator('[data-quote-lane="regular"]');
    const extended = page.locator('[data-quote-lane="extended"]');
    await expect(regular).toContainText("390.54");
    await expect(regular).toContainText("-0.71%");
    await expect(extended).toContainText("After hours");
    await expect(extended).toContainText("421.14");
    await expect(extended).toContainText("+7.84%");
  }
});

test("a suspended A-share keeps its last real close and replaces zero percent at every width", async ({ page }, testInfo) => {
  const symbol = "002155.SZ";
  const lastRealClose = 24.56;
  const bars = Array.from({ length: 80 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 3, 22 + index));
    const close = index === 79 ? lastRealClose : 20 + index * 0.05;
    return [
      date.toISOString().slice(0, 10),
      Number((close - 0.12).toFixed(2)),
      Number((close + 0.21).toFixed(2)),
      Number((close - 0.25).toFixed(2)),
      Number(close.toFixed(2)),
      10_000_000 + index,
    ];
  });
  bars[79][0] = "2026-08-19";

  await page.route("**/data/manifest.json**", (route) => route.fulfill({
    json: {
      as_of: "2026-08-19",
      source: "suspension-e2e",
      symbols: {
        [symbol]: {
          name: "Hunan Gold Corporation Limited",
          sec: "Equities",
          mkt: "SZSE",
          col: "#d8ad32",
          last: lastRealClose,
          chg: 0,
          open: 24.34,
          high: 25.39,
          low: 24.20,
          vol: 47_735_572,
          hi52: 28.10,
          lo52: 12.20,
          verdict: "HOLD",
          wr: null,
          pf: null,
          cagr: null,
          regimeBull: null,
        },
      },
    },
  }));
  await page.route(`**/data/${symbol}.json**`, (route) => route.fulfill({
    json: { t: symbol, o: 1, src: "yfinance", bar_quality: "real_ohlc", bars },
  }));
  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || symbol).split(",").filter(Boolean);
    const quotes = Object.fromEntries(syms.map((sym) => [sym, sym === symbol ? {
      sym,
      last: null,
      prevClose: lastRealClose,
      chg: null,
      open: null,
      high: null,
      low: null,
      vol: null,
      amount: null,
      live: false,
      source: "tencent",
      basis: "EOD",
      market: "cn",
      marketSession: "closed",
      suspended: true,
      regularPrice: null,
      regularChg: null,
    } : null]));
    await route.fulfill({ json: { quotes } });
  });

  await armTerminalVisualReady(page);
  await page.goto(`/terminal?symbol=${symbol}`);
  await waitForTerminalVisualReady(page);

  if (testInfo.project.name === "desktop") {
    await expect(page.locator(".topbar .stat-last")).toContainText("24.56");
    await expect(page.locator(".topbar .stat-change")).toContainText("Suspended");
    await expect(page.locator(".topbar-livebadge")).toContainText("Suspended");
    await expect(page.locator(".detail-hd .px")).toContainText("24.56");
    await expect(page.locator(".detail-hd .px")).toContainText("Suspended");
  } else {
    const primary = page.locator('[data-quote-lane="regular"]');
    await expect(primary).toContainText("24.56");
    await expect(primary).toContainText("Suspended");
  }
  await expect(page.locator(".pane-hd").first()).toContainText("Suspended");
  await expect(page.getByText("+0.00%", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0.00%", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-hunan-gold-suspended.png`),
    fullPage: false,
  });
});

test("Prophet fills its Options workspace at every supported width", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  if (zh) {
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      document.documentElement.setAttribute("lang", "zh-CN");
    });
  }
  await page.goto("/options?tab=prophet");

  const prophet = page.locator(".obs-prophet");
  await expect(prophet).toBeVisible({ timeout: 15_000 });
  await expect(prophet.locator(".obs-prophet-title-row h2")).toHaveText(zh ? "预言台" : "Prophet");
  await expect(prophet.locator(".obs-prophet-title-row")).toContainText(
    zh ? "Mastermind 因子引擎" : "Mastermind factor engine",
  );
  await expect(prophet.locator(".obs-prophet-signal").first()).toBeVisible();
  await expect(prophet.locator(".obs-prophet-geometry")).toBeVisible();
  await expect(prophet.locator(".obs-prophet-confidence .obs-ring")).toBeVisible();
  await expect(prophet.locator(".obs-prophet-stage")).toHaveCount(0);

  const readLayout = () => prophet.evaluate((root) => {
    const host = root.parentElement;
    const grid = root.querySelector<HTMLElement>(".obs-prophet-grid");
    if (!host || !grid) throw new Error("Prophet layout host is unavailable");
    const rootRect = root.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      rootWidth: rootRect.width,
      hostWidth: hostRect.width,
      unusedRight: hostRect.right - rootRect.right,
      gridDisplay: getComputedStyle(grid).display,
      gridColumns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    };
  });

  const layout = await readLayout();
  expect(layout.rootWidth).toBeGreaterThanOrEqual(layout.hostWidth - 1);
  expect(layout.unusedRight).toBeLessThanOrEqual(1);
  if (testInfo.project.name === "mobile") {
    expect(layout.gridDisplay).toBe("flex");
  } else {
    expect(layout.gridDisplay).toBe("grid");
    expect(layout.gridColumns).toBe(testInfo.project.name === "desktop" ? 3 : 2);
  }

  const composition = await prophet.evaluate((root) => {
    const rect = (selector: string) => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`Missing Prophet pane: ${selector}`);
      const box = el.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    return {
      left: rect(".obs-prophet-left"),
      center: rect(".obs-prophet-center"),
      right: rect(".obs-prophet-right"),
      signal: rect(".obs-prophet-signal"),
      geometry: rect(".obs-prophet-geometry"),
    };
  });
  // Regression receipt for the pre-v2 composition: readable ledger rows, a compact
  // horizontal geometry card, and the confidence ring all survive the responsive shell.
  expect(composition.signal.height).toBeGreaterThanOrEqual(58);
  expect(composition.geometry.height).toBeLessThan(280);
  if (testInfo.project.name === "desktop") {
    expect(Math.abs(composition.left.top - composition.center.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(composition.center.top - composition.right.top)).toBeLessThanOrEqual(1);
    expect(composition.center.width).toBeGreaterThan(composition.left.width);
  } else if (testInfo.project.name === "tablet") {
    expect(Math.abs(composition.left.top - composition.center.top)).toBeLessThanOrEqual(1);
    expect(composition.right.top).toBeGreaterThan(composition.center.top);
  } else {
    expect(composition.center.top).toBeGreaterThan(composition.left.top);
    expect(composition.right.top).toBeGreaterThan(composition.center.top);
  }

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-prophet.png`),
    fullPage: false,
  });

  if (testInfo.project.name === "desktop") {
    // The July 28 restyle dropped the old grid root's full-width sizing. At widths above
    // the dossier's max-content size, Prophet then stopped around 1520px and left a large
    // dead strip on the right. Exercise the width from the operator's report explicitly.
    await page.setViewportSize({ width: 1904, height: 1198 });
    const wideLayout = await readLayout();
    expect(wideLayout.rootWidth).toBeGreaterThanOrEqual(wideLayout.hostWidth - 1);
    expect(wideLayout.unusedRight).toBeLessThanOrEqual(1);
    expect(wideLayout.gridColumns).toBe(3);
    await page.screenshot({
      path: testInfo.outputPath("wide-desktop-prophet.png"),
      fullPage: false,
    });
  }

  // The compact rail still carries the v2 honesty guard. LRN's structural stop
  // exceeds both audit thresholds, so its projected targets must be de-emphasized
  // and explicitly labeled as geometry rather than forecasts.
  await prophet.locator(".obs-prophet-signal").filter({ hasText: "LRN" }).click();
  await expect(prophet.locator(".obs-prophet-geometry .obs-note")).toContainText(
    zh ? "结构过宽" : "Wide geometry",
  );
  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: testInfo.outputPath("desktop-prophet-wide-geometry.png"),
      fullPage: false,
    });
  }

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
});

test("Levels keeps the gamma map and named-level rail reachable at every supported width", async ({ page }, testInfo) => {
  await page.goto("/options?tab=levels");

  const levelsTab = page.locator("#wtab-levels");
  await expect(levelsTab).toHaveAttribute("aria-selected", "true");
  await expect(levelsTab).toBeInViewport();
  const board = page.locator(".levels-board");
  const column = page.locator(".levels-column");
  const rail = page.locator(".levels-rail");
  await expect(board).toBeVisible({ timeout: 15_000 });
  await expect(column).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(board).toContainText("Positioning, not prophecy");

  const geometry = await board.evaluate((root) => {
    const columnEl = root.querySelector<HTMLElement>(".levels-column");
    const railEl = root.querySelector<HTMLElement>(".levels-rail");
    if (!columnEl || !railEl) throw new Error("Levels layout panes are unavailable");
    const c = columnEl.getBoundingClientRect();
    const r = railEl.getBoundingClientRect();
    return {
      boardClientWidth: root.clientWidth,
      boardScrollWidth: root.scrollWidth,
      boardClientHeight: root.clientHeight,
      boardScrollHeight: root.scrollHeight,
      column: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
      rail: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    };
  });

  expect(geometry.boardScrollWidth).toBeLessThanOrEqual(geometry.boardClientWidth + 1);
  if (testInfo.project.name === "mobile") {
    expect(geometry.rail.top).toBeGreaterThanOrEqual(geometry.column.bottom - 1);
    await rail.scrollIntoViewIfNeeded();
  } else {
    expect(Math.abs(geometry.rail.top - geometry.column.top)).toBeLessThanOrEqual(1);
    expect(geometry.rail.left).toBeGreaterThanOrEqual(geometry.column.right - 1);
  }

  const keystone = rail.getByRole("button").filter({ hasText: "Keystone" });
  await expect(keystone).toBeVisible();
  await expect(keystone).toContainText("775");
  await keystone.click();
  await expect(rail).toContainText("The largest gamma concentration");

  const viewportWidth = page.viewportSize()?.width ?? 1440;
  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.client).toBe(viewportWidth);
  expect(pageWidth.scroll).toBeLessThanOrEqual(viewportWidth);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-levels-board.png`),
    fullPage: false,
  });
});

test("Intraday Surface separates session, observed frames, and candle interval at every supported width", async ({ page }, testInfo) => {
  const candleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/intraday" &&
      url.searchParams.get("sym") === "SPY" &&
      url.searchParams.has("date");
  });
  await page.goto("/options?tab=surface");

  await expect(page.getByText("Intraday Flow Surface", { exact: true })).toBeVisible({ timeout: 15_000 });
  const candleInterval = page.getByRole("group", { name: "Candle interval" });
  await expect(candleInterval).toBeVisible();
  await expect(candleInterval).toContainText("Candles");

  const candleResponse = await candleResponsePromise;
  expect(candleResponse.ok()).toBe(true);
  const requestedDate = new URL(candleResponse.url()).searchParams.get("date");
  expect(requestedDate).toBe("2026-07-06");
  const candlePayload = await candleResponse.json() as {
    session_date?: string;
    bars?: [number, number, number, number, number, number][];
  };
  expect(candlePayload.session_date).toBe(requestedDate);
  expect(candlePayload.bars?.length).toBeGreaterThan(0);
  const dayStart = Date.UTC(2026, 6, 6) / 1000;
  expect(candlePayload.bars?.every((bar) => bar[0] >= dayStart && bar[0] < dayStart + 86_400)).toBe(true);

  const contractStrip = page.locator(".obs-surf-data-strip");
  await expect(contractStrip).toContainText("Session");
  await expect(contractStrip).toContainText("2026-07-06");
  await expect(contractStrip).toContainText("78 observed frames");
  await expect(contractStrip).toContainText("~5m observed");
  await expect(contractStrip).toContainText("Price");
  await expect(contractStrip).toContainText("5m candles");
  await expect(contractStrip).toContainText("Observed only · no interpolation");

  const timeWindow = page.getByRole("group", { name: "Chart time window" });
  await expect(timeWindow).toBeVisible();
  await expect(timeWindow.locator("button").filter({ hasText: "Surface window" })).toHaveAttribute("aria-pressed", "true");
  await expect(timeWindow.locator("button").filter({ hasText: "Full session" })).toHaveAttribute("aria-pressed", "false");

  const frameRail = page.locator(".obs-surf-frame-rail");
  await expect(frameRail).toHaveAttribute("role", "slider");
  await expect(frameRail).toHaveAttribute("aria-valuemax", "78");
  await expect(page.locator(".obs-surf-frame-dot")).toHaveCount(78);
  const chartBox = await page.locator(".obs-surf-chart-area").boundingBox();
  expect(chartBox?.width ?? 0).toBeGreaterThan(300);

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-flow-surface.png`),
    fullPage: false,
  });
});

test("the retired ?tab=prism deep-link opens the Exposure matrix", async ({ page }, testInfo) => {
  // Tablet runs the same responsive surface in Chinese; desktop/mobile stay English.
  // This pins the LEX tuple on a real render instead of merely typechecking the keys.
  const zh = testInfo.project.name === "tablet";
  if (zh) {
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      document.documentElement.setAttribute("lang", "zh-CN");
    });
  }

  // §5.3 merged PRISM into the Exposure desk. The old deep-link must not 404 or dead-end
  // on the ladder: the TARGET side (GexDeskView) resolves the alias onto its matrix view.
  await page.goto("/options?tab=prism");

  // Named by its VISIBLE text. The chip deliberately carries no aria-label — one would
  // outrank the text in accessible-name computation and make this locator unmatchable.
  const matrixChip = page.getByRole("button", { name: zh ? "矩阵" : "Matrix", exact: true });
  await expect(matrixChip).toBeVisible({ timeout: 15_000 });
  await expect(matrixChip).toHaveAttribute("aria-pressed", "true");

  // The matrix opens on the mid strike window.
  await expect(page.getByRole("button", { name: "±6%", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "±3%", exact: true })).toHaveAttribute("aria-pressed", "false");

  // Nightly EOD provenance is stated on the view — never live chrome.
  await expect(page.getByTestId("matrix-asof")).toBeVisible();

  // Desk-only exact-side rail. One card per exact cell carries BOTH side receipts in
  // stable identity order; no fifth scalar lens appears in the matrix controls.
  const unusualRail = page.getByRole("region", {
    name: zh ? "逐边收盘成交量基线" : "Exact-side EOD volume baseline",
  });
  await expect(unusualRail).toBeVisible();
  await expect(unusualRail).toHaveAttribute("data-state", "flagged");
  await expect(unusualRail).toContainText(zh ? "逐边收盘基线" : "Exact-side EOD baseline");
  await expect(unusualRail).toContainText(zh ? "独立于热图控制项" : "independent of heatmap controls");
  await expect(unusualRail).toContainText(zh ? "仅供展示" : "DISPLAY ONLY");
  await unusualRail.scrollIntoViewIfNeeded();
  const visibleRail = await unusualRail.boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(visibleRail?.height ?? 0).toBeGreaterThan(40);
  expect(visibleRail?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(viewportHeight);
  expect((visibleRail?.y ?? 0) + (visibleRail?.height ?? 0)).toBeGreaterThan(0);
  const exactContracts = unusualRail.getByTestId("matrix-unusual-contract");
  await expect(exactContracts).toHaveCount(3);
  expect(await exactContracts.evaluateAll((cards) => cards.map((card) => ({
    strike: card.getAttribute("data-strike"),
    expiry: card.getAttribute("data-expiry"),
  })))).toEqual([
    { strike: "749", expiry: "2026-07-10" },
    { strike: "750", expiry: "2026-07-10" },
    { strike: "751", expiry: "2026-07-10" },
  ]);
  expect(await exactContracts.evaluateAll((cards) => cards.map((card) =>
    [...card.querySelectorAll<HTMLElement>("[data-testid='matrix-unusual-side']")].map((side) => ({
      side: side.dataset.side,
      status: side.dataset.status,
    }))
  ))).toEqual([
    [{ side: "call", status: "unusual" }, { side: "put", status: "normal" }],
    [{ side: "call", status: "normal" }, { side: "put", status: "unusual" }],
    [{ side: "call", status: "unusual" }, { side: "put", status: "unavailable" }],
  ]);
  await expect(exactContracts.nth(0).locator("[data-side='put']")).toContainText("1.98×");
  await expect(exactContracts.nth(1).locator("[data-side='call']")).toContainText("2.66×");
  await expect(exactContracts.nth(2).locator("[data-side='put']"))
    .toContainText(zh ? "不可用" : "UNAVAILABLE");
  await expect(unusualRail.getByText("3.00×", { exact: true })).toBeVisible();

  // The rail owns any horizontal overflow. On mobile it is intentionally swipeable;
  // no width may leak into the page. The matrix keeps a real vertical viewport even on
  // desktop's short two-pane track, where the whole dossier becomes locally scrollable.
  const unusualTrack = unusualRail.locator(".obs-mtx-unusual-track");
  const railGeometry = await unusualTrack.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(railGeometry.overflowX).toBe("auto");
  expect(railGeometry.scrollWidth).toBeGreaterThanOrEqual(railGeometry.clientWidth);
  if (testInfo.project.name === "mobile") {
    expect(railGeometry.scrollWidth).toBeGreaterThan(railGeometry.clientWidth);
    await unusualTrack.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect.poll(() => unusualTrack.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await unusualTrack.evaluate((el) => el.scrollTo({ left: 0 }));
    await expect.poll(() => unusualTrack.evaluate((el) => el.scrollLeft)).toBe(0);
  }

  const matrix = page.locator("table").filter({
    has: page.getByRole("columnheader", { name: zh ? "行权价" : "Strike", exact: true }),
  });
  await expect(matrix).toBeVisible();
  await expect.poll(() => matrix.locator("tbody > tr").count()).toBeGreaterThanOrEqual(20);
  const matrixViewport = page.locator(".obs-mtx-exposure .obs-mtx-desk-grid");
  await expect(matrixViewport).toBeVisible();
  expect(await matrixViewport.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(139);
  if (testInfo.project.name === "desktop") {
    const dossier = page.locator(".obs-mtx-exposure");
    await expect.poll(() => dossier.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    await dossier.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => dossier.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await dossier.evaluate((el) => el.scrollTo({ top: 0 }));
  }

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-exposure-matrix.png`),
    fullPage: false,
  });
});

test("an archived session withholds the matrix instead of captioning today's grid", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "Exposure content region collapses at 390px — pre-existing, filed as follow-up in PR #344 body"
  );

  // The matrix store is a CURRENT-session read with no dated twin. Replaying a settled
  // session must NOT render today's grid inside the archived frame (the cross-session
  // adjacency replay mode exists to prevent) — and must not silently switch the user's
  // view either: the gap is named.
  await page.goto("/options?tab=prism");

  const matrix = page.locator("table").filter({
    has: page.getByRole("columnheader", { name: "Strike", exact: true }),
  });
  await expect(matrix).toBeVisible({ timeout: 15_000 });

  // Pick the oldest archived session from the replay picker.
  const picker = page.getByLabel("Archived session", { exact: true });
  const dates = await picker.locator("option").evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean)
  );
  expect(dates.length, "fixture must publish at least one archived session").toBeGreaterThan(0);
  await picker.selectOption(dates[dates.length - 1]);

  // Matrix withheld, reason named, and the Matrix chip still the active view.
  await expect(page.getByTestId("gex-archived-matrix")).toBeVisible();
  await expect(matrix).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Matrix", exact: true }))
    .toHaveAttribute("aria-pressed", "true");

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-archived-matrix-withheld.png`),
    fullPage: false,
  });
});

test("a Pro-equivalent entitlement can discover all premium modules and add a suite preset", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One viewport is sufficient for the shared entitlement contract.");
  // A cold /terminal compile plus ~15 modal round-trips (four preset applications, each re-reading
  // the 31-module picker) does not fit the 30s default on a hosted runner: it has timed out mid-run
  // on the click AFTER the element reported visible, enabled and stable, which is a slow page, not
  // a broken control. It finishes in ~6s locally.
  test.slow();

  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  // The toolbar is present in the server-rendered shell before React attaches its handlers.
  // Waiting for the imperative chart canvas prevents a fast/parallel run from clicking pre-hydration.
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await waitForTerminalVisualReady(page);
  await page.getByRole("button", { name: "Indicators", exact: true }).click();

  const modal = page.locator(".imodal");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(modal.locator(".imod-row")).toHaveCount(31);
  await expect(modal.locator(".imod-row.locked")).toHaveCount(0);

  const marketStructure = modal.locator(".imod-row").filter({ hasText: "Market Structure" });
  await marketStructure.locator(".imod-main").click();
  await expect(marketStructure).toHaveClass(/\bon\b/);

  await modal.getByRole("button", { name: "Systems & Presets" }).click();
  const structurePreset = modal.locator(".ipreset-row").filter({ hasText: "Structure Core" });
  await expect(structurePreset.getByRole("button", { name: "Current: Structure Focus" })).toBeDisabled();
  await structurePreset.getByRole("button", { name: "Apply: Structure Workflow" }).click();
  await modal.locator(".im-nav-item").filter({ hasText: "Structure Core" }).click();
  await expect(modal.locator(".imod-row.on")).toHaveCount(3);

  await modal.getByRole("button", { name: "Systems & Presets" }).click();
  await structurePreset.getByRole("button", { name: "Apply: Complete Structure Research" }).click();
  await modal.locator(".im-nav-item").filter({ hasText: "Structure Core" }).click();
  await expect(modal.locator(".imod-row.on")).toHaveCount(9);

  await modal.getByRole("button", { name: "Systems & Presets" }).click();
  await structurePreset.getByRole("button", { name: "Apply: Structure Focus" }).click();
  await modal.locator(".im-nav-item").filter({ hasText: "Structure Core" }).click();
  await expect(modal.locator(".imod-row.on")).toHaveCount(1);

  await modal.getByRole("button", { name: "Systems & Presets" }).click();
  const trendPreset = modal.locator(".ipreset-row").filter({ hasText: "Trend Waves" });
  await trendPreset.getByRole("button", { name: "Add: Candle State" }).click();
  await expect(trendPreset.getByRole("button", { name: "Current: Candle State" })).toBeDisabled();
});

test("Seasonal read stays useful in chart and table views at every supported width", async ({ page }, testInfo) => {
  const now = new Date();
  const crowdedBucketLabels = ["Oct H2", "Nov H1", "Nov H2", "Dec H1", "Dec H2"];
  const iso = (days: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const interval = (
    start: number,
    end: number,
    dir: "bull" | "bear",
    move: number,
    winRate: number,
    score: number,
    buckets: string[] = [],
  ) => ({
    dir,
    start: iso(start),
    end: iso(end),
    expected_move: move,
    typical_move: move * 0.82,
    win_rate: winRate,
    n: 27,
    n_eff: 27,
    lo: dir === "bull" ? -2.8 : -5.6,
    hi: dir === "bull" ? 8.9 : 3.1,
    stability: 0.85,
    evidence_score: score,
    confidence: score >= 70 ? "high" : score >= 48 ? "medium" : "low",
    buckets,
  });
  const baseline = [
    interval(3, 25, "bull", 6.4, 0.74, 78),
    interval(34, 51, "bear", -2.1, 0.37, 55),
    interval(67, 104, "bull", 9.2, 0.78, 83, crowdedBucketLabels),
    interval(126, 148, "bull", 3.0, 0.67, 52),
  ];
  const artifact = {
    schema: "mastermind.seasonal_outlook/v1",
    symbol: "NVDA",
    as_of: iso(0),
    is_display_only: true,
    engine_version: "0.2.0",
    regime_table_version: "2026.1",
    disclaimer: "Historical research only.",
    mode: "baseline_fallback",
    default_view: "baseline",
    n_eff: 10.7,
    n_eff_note: "Effective analog count.",
    relaxed_filters: [],
    current_year: {
      year: now.getUTCFullYear(),
      cycle_pos: "midterm",
      rate_dir: "holding",
      is_recession: false,
      whipsaw: false,
      flags: [],
      anomaly_flags: [],
      provisional: true,
    },
    history: {
      first_year: 1999,
      last_date: iso(0),
      complete_years: 27,
      coverage: "deep",
    },
    validation: {
      loyo_years: 27,
      n_predictions: 612,
      regime_hit: 0.56,
      baseline_hit: 0.56,
      skill: -0.003,
      skill_ci_lo: -0.028,
      skill_ci_hi: 0.021,
      n_blocks: 7,
      regime_better_years: 8,
      baseline_better_years: 9,
      tied_years: 10,
      verdict: "no_edge",
    },
    analogs: [2010, 2014, 2002, 2006, 2018, 2011, 2012, 2013, 2015, 2019].map((year, i) => ({
      year,
      weight: 1 - i * 0.07,
      cycle_pos: "midterm",
      rate_dir: "holding",
      is_recession: false,
      whipsaw: false,
      flags: [],
      provisional: false,
    })),
    forward_buckets: crowdedBucketLabels.map((label, index) => ({
      start: iso(67 + index * 7),
      end: iso(73 + index * 7),
      label,
      baseline: {
        dir: "bull",
        mean: 2.4 + index,
        median: 2.1 + index,
        win_rate: 0.67,
        n: 27,
        lo: -4.2,
        hi: 9.8,
        confidence: "high",
      },
      regime: {
        dir: "bull",
        mean: 2.1 + index,
        median: 1.8 + index,
        win_rate: 0.64,
        n: 12,
        lo: -4.8,
        hi: 9.1,
        confidence: "medium",
      },
    })),
    intervals_baseline: baseline,
    intervals_regime: baseline.map((item) => ({
      ...item,
      expected_move: item.expected_move * 0.9,
      typical_move: item.typical_move * 0.9,
      evidence_score: Math.max(25, item.evidence_score - 18),
      confidence: "low",
      n_eff: 10.7,
    })),
    honest_read: "Baseline shown because the regime lens has no measurable edge.",
  };
  await page.route(/\/data\/NVDA\.seasonal\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(artifact) });
  });

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  const seasonal = page.locator(".fin-seas");
  await expect.poll(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("mm:open-pane", { detail: "seasonals" }));
    });
    return seasonal.count();
  }, {
    // All three viewport projects run alongside the heavier chart suites. Give the dynamically
    // imported finance pane time to hydrate under that deliberate parallel load.
    timeout: 15_000,
  }).toBe(1);
  await expect(seasonal).toBeVisible();
  await expect(seasonal.locator(".fin-seas-chart svg")).toBeVisible();
  await expect(seasonal.locator(".fin-seas-chart svg")).not.toHaveAttribute("preserveAspectRatio", "none");
  await expect(seasonal.locator(".fin-yo-endlbl")).toHaveCount(0);
  await expect(seasonal.locator(".fin-adv-title")).toContainText("Seasonal read");
  await seasonal.locator(".fin-seas-chart").screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-seasonal-overlay.png`),
  });

  const typical = seasonal.locator(".fin-adv-typical-chart");
  const typicalPanel = typical.locator("xpath=..");
  await typical.scrollIntoViewIfNeeded();
  await expect(typical).toBeVisible();
  await expect(typicalPanel.locator(".fin-adv-monthpulse-cell")).toHaveCount(12);
  await typicalPanel.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-seasonal-typical-path.png`),
  });

  const outlook = seasonal.locator(".fin-ro-panel");
  await outlook.scrollIntoViewIfNeeded();
  await expect(outlook.getByText("Baseline only", { exact: true })).toBeVisible();
  await expect(outlook.locator(".fin-ro-window")).toHaveCount(4);
  await outlook.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-seasonal-forward-map.png`),
  });
  const crowdedBand = outlook.locator('.fin-ro-band[data-bucket-count="5"]');
  await expect(crowdedBand).toHaveCount(1);
  await crowdedBand.hover();
  const windowTip = page.getByRole("tooltip");
  await expect(windowTip).toBeVisible();
  await expect(windowTip.locator(".fin-tip-row")).toHaveCount(5);
  await expect(windowTip).toContainText("Support");
  await expect(windowTip).toContainText("Effective years");
  await expect(windowTip).not.toContainText("Oct H2");
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-seasonal-forward-tooltip.png`),
  });
  await outlook.locator(".fin-ro-timeline-label").hover();
  await expect(windowTip).toHaveCount(0);

  await seasonal.getByRole("button", { name: "Table", exact: true }).click();
  await expect(seasonal.locator(".fin-seas-grid")).toBeVisible();
  await expect(seasonal.locator(".fin-adv-title")).toContainText("Seasonal read");
  await expect(seasonal.locator(".fin-ro-panel")).toBeVisible();

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
});

test("Golden Oracle shows the session a 3D signal became knowable", async ({ page }, testInfo) => {
  // Freeze the evaluation instant inside the live window. known_ts stays 2026-07-28;
  // production ORACLE_STALE_DAYS stays 21 (stale is age > 21). 2026-08-10 is 13 days
  // after the known date, so the Buy remains live. Mock Date.now only — Playwright
  // clock.install also fake-timers Next.js and hangs hydration.
  await page.addInitScript(() => {
    Date.now = () => Date.parse("2026-08-10T12:00:00.000Z");
  });
  // Exercise the bilingual branch at one supported width; the Terminal itself is dark-only.
  const zh = testInfo.project.name === "tablet";
  const costSlice = {
    indicator: {
      state: {
        position_hint: "long",
        last_signal: "BUY",
        last_scored_signal: "BUY",
        last_scored_ts: "2026-07-28",
        strong_bull: true,
        weeklyBull: true,
        above200: true,
      },
      signals: [{
        ts: "2026-07-24",
        known_ts: "2026-07-28",
        bar_index: 430,
        type: "BUY",
        price: 966.58,
        quality: "take",
        tier: "quality",
        score: 78,
      }],
      warnings: [],
    },
    backtest: {
      metrics: { n_trades: 10, win_rate: 0.3, profit_factor: 3.57, cagr: 0.078 },
    },
  };
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(costSlice) });
  });
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=COST");
  await expect(page.locator(".workspace")).toBeVisible();
  await waitForTerminalVisualReady(page);

  const signalButton = page.locator(".sig-btn");
  await signalButton.scrollIntoViewIfNeeded();
  if (zh) {
    // Switch through the real account-settings control so the LEX provider and persisted
    // preference take the same path they do for an operator.
    await page.locator(".mobilebar button.avatar").click();
    const settings = page.locator(".acs-card");
    await settings.getByRole("tab", { name: "Preferences" }).click();
    const zhButton = settings.getByRole("button", { name: "中文" });
    await zhButton.click();
    await expect(zhButton).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await signalButton.scrollIntoViewIfNeeded();
  }
  const expectedDate = zh ? "7月28日" : "Jul 28";

  await expect(signalButton.locator(".sig-btn-go .sig-btn-vd")).toHaveText(zh ? "买入" : "Buy");
  await expect(signalButton.locator(".sig-btn-go .sig-btn-sub")).toHaveText(expectedDate);
  const gradientSkin = await signalButton.evaluate((button) => {
    const read = (selector: string) => {
      const half = button.querySelector<HTMLElement>(selector)!;
      const halfStyle = getComputedStyle(half);
      const railStyle = getComputedStyle(half, "::before");
      return {
        background: halfStyle.backgroundImage,
        rail: railStyle.backgroundImage,
        railShadow: railStyle.boxShadow,
      };
    };
    return { oracle: read(".sig-btn-go"), research: read(".sig-btn-rd") };
  });
  for (const half of [gradientSkin.oracle, gradientSkin.research]) {
    expect(half.background).toContain("radial-gradient");
    expect(half.background).toContain("linear-gradient");
    expect(half.rail).toContain("linear-gradient");
    expect(half.railShadow).not.toBe("none");
  }
  await signalButton.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-oracle-research-gradient-card.png`),
  });
  await signalButton.click();

  const dialog = page.locator(".sd-scrim");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute(
    "aria-label",
    zh ? "研究台与黄金神谕" : "Research Desk and Golden Oracle",
  );
  await expect(dialog.locator(".sd-go .od-vsub")).toHaveText(expectedDate);

  const latest = dialog.locator(".sd-go .sd-sigrow").first();
  await latest.scrollIntoViewIfNeeded();
  await expect(latest.locator(".sd-sig-date")).toHaveText(
    zh ? "2026年7月28日" : "Jul 28, 2026",
  );
  await expect(latest).toHaveAttribute(
    "title",
    zh
      ? /确认于 2026年7月28日 · 3日K线始于 2026年7月24日/
      : /Confirmed Jul 28, 2026 · 3D bar opened Jul 24, 2026/,
  );
  await dialog.locator(".sd-go").screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-oracle-known-date.png`),
  });

  // The visible/actionable date changed, but chart navigation still targets the bar-open date.
  await page.evaluate(() => {
    (window as Window & { __oracleJumpTs?: string }).__oracleJumpTs = "";
    window.addEventListener("mm:chart-jump", (event) => {
      const detail = (event as CustomEvent<{ ts?: string }>).detail;
      (window as Window & { __oracleJumpTs?: string }).__oracleJumpTs = detail?.ts ?? "";
    }, { once: true });
  });
  await latest.click();
  await expect.poll(
    () => page.evaluate(() => (window as Window & { __oracleJumpTs?: string }).__oracleJumpTs),
  ).toBe("2026-07-24");
});

test("HK-O1: a structure stop and a refused entry are labelled for what they are", async ({ page }, testInfo) => {
  // Forensic receipt: Macro Dashboard research/prophet_us_audit/HK_ORACLE_FORENSIC_2026-08-08.md.
  // Two lies on one card, reproduced at 9988.HK's own shape: a SELL from the ARM->CONFIRM
  // structure break wearing the oracle costume, and a regime-vetoed entry drawn with BUY
  // geometry (the Jul-9 marker the operator chased). Both must now say what they are.
  const zh = testInfo.project.name === "tablet";
  // Dates are relative to run time: the rail card only grants full authority inside the
  // 21-day staleness window, so a hardcoded date would turn this into a scheduled failure.
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const shortDate = (isoTs: string) =>
    new Date(Date.parse(isoTs)).toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const stopTs = iso(6);
  const blockedTs = iso(2);

  const slice = {
    indicator: {
      state: {
        position_hint: "flat",
        last_signal: "BUY",
        last_scored_signal: "SELL",
        last_scored_ts: stopTs,
        last_scored_basis: "structure_stop",
        strong_bull: false,
        overbought: false,
        weeklyBull: false,
        above200: false,
      },
      signals: [
        {
          ts: stopTs, known_ts: stopTs, bar_index: 420, type: "SELL", price: 440.6,
          basis: "structure_stop", stop_level: 456.2,
          reasons: ["distribution_confirmed", "structure_break"],
        },
        {
          // still typed BUY on purpose — additive contract; `blocked` is the render key
          ts: blockedTs, known_ts: blockedTs, bar_index: 424, type: "BUY", price: 110.7,
          quality: "regime_blocked", blocked: true, tier: null, score: null,
          quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull",
        },
      ],
      early_dots: [],
      warnings: [],
    },
    backtest: { metrics: { n_trades: 10, win_rate: 0.3, profit_factor: 1.4, cagr: 0.05 } },
  };
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(slice) });
  });
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=COST");
  await expect(page.locator(".workspace")).toBeVisible();
  await waitForTerminalVisualReady(page);

  // NOT asserted here: the on-chart "GOLDEN ORACLE · STOP" chip. The Golden Oracle is an
  // opt-in study, and its chip text repaints on the next data render rather than on the
  // indicator toggle, so driving it from this test would be timing-dependent in the shared
  // CI lane. Its label derives from the same isStructureStop() helper asserted here and unit-
  // tested in lib/__tests__/signalVerdict.test.ts.

  const signalButton = page.locator(".sig-btn");
  await signalButton.scrollIntoViewIfNeeded();
  if (zh) {
    await page.locator(".mobilebar button.avatar").click();
    const settings = page.locator(".acs-card");
    await settings.getByRole("tab", { name: "Preferences" }).click();
    const zhButton = settings.getByRole("button", { name: "中文" });
    await zhButton.click();
    await expect(zhButton).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await signalButton.scrollIntoViewIfNeeded();
  }

  // ── the rail card: the stop names itself, and the refusal rides with it ──
  await expect(signalButton.locator(".sig-btn-go .sig-btn-vd")).toHaveText(zh ? "结构止损" : "Structure stop");
  await expect(signalButton.locator(".sig-btn-go .sig-btn-sub")).toContainText(shortDate(stopTs));
  await expect(signalButton.locator(".sig-btn-go .sig-btn-sub")).toContainText(zh ? "入场被拦截" : "entry blocked");
  await signalButton.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-hko1-rail-card.png`),
  });

  await signalButton.click();
  const dialog = page.locator(".sd-scrim");
  await expect(dialog).toBeVisible();

  // ── the refused entry gets its own disclosure, never the entry scorecard ──
  await expect(dialog.locator(".sd-go .sig-conflict").filter({ hasText: zh ? "非入场信号" : "not an entry" }))
    .toBeVisible();
  // no tier/score row for a marker the engine refused
  await expect(dialog.locator(".sd-go .sig-dims")).toHaveCount(0);

  // ── signal history: BLOCKED (newest) above STOP, neither wearing a buy pill ──
  const rows = dialog.locator(".sd-go .sd-sigrow");
  const blockedRow = rows.first();
  await blockedRow.scrollIntoViewIfNeeded();
  await expect(blockedRow.locator(".sd-sig-badge")).toHaveText(zh ? "已拦截" : "BLOCKED");
  await expect(blockedRow.locator(".sd-sig-badge")).toHaveClass(/hollow/);
  await expect(blockedRow.locator(".sd-sig-q")).toHaveText(zh ? "非入场信号" : "not an entry");
  await expect(blockedRow).toHaveAttribute("title", zh ? /入场被趋势闸拒绝/ : /Entry refused by the regime gate/);

  const stopRow = rows.nth(1);
  await expect(stopRow.locator(".sd-sig-badge")).toHaveText(zh ? "止损" : "STOP");
  await expect(stopRow.locator(".sd-sig-q")).toHaveText(zh ? "跌破前低" : "swing-low break");
  await expect(stopRow).toHaveAttribute("title", zh ? /结构止损 — 日线收盘跌破前低 456.2/ : /Structure stop — the daily close broke the prior swing low at 456.2/);
  // PIT price: the confirm session's own daily close, as emitted
  await expect(stopRow.locator(".sd-sig-price")).toHaveText("440.60");

  await dialog.locator(".sd-go").screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-hko1-signal-history.png`),
  });

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
});

test("Exposure desk replays an archived session's full ladder at every supported width", async ({ page }, testInfo) => {
  await page.goto("/options?tab=gex");

  // Live desk up first: the ladder and the session dropdown (driven by the
  // gex_history dates.json index — R0.10) are both on screen, no archived chip yet.
  const picker = page.getByRole("combobox", { name: "Archived session" });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("group", { name: "Strike range" })).toBeVisible();
  await expect(page.getByTestId("gex-archived-chip")).toHaveCount(0);

  // The ladder region must be a real band at every width. In the ≤860px
  // page-scroll mode its flex:1 1 0px used to resolve against auto-height
  // ancestors to a 0px band — the ladder/expiry-bars/lens were invisible on
  // phones while these visibility checks stayed green (children overflow the
  // clipped region, so their boxes are non-empty). Guard the region itself.
  // 150 < the ~198px the 1440×900 desk actually yields and far above the 0px
  // failure mode; phones/tablets floor at min(430px, 62dvh).
  const ladderRegionH = await page
    .locator(".obs-gexdesk-ladder-region")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(ladderRegionH).toBeGreaterThanOrEqual(150);

  // Pick an archived session → that session's FULL ladder, labelled as archived.
  await picker.selectOption("2026-07-02");
  const chip = page.getByTestId("gex-archived-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("archived session · 2026-07-02");
  await expect(page.getByRole("group", { name: "Strike range" })).toBeVisible();
  // The replay withdraws the current-session rail and says so, instead of leaving
  // an empty column that reads as breakage.
  await expect(page.getByText("Archived session", { exact: true })).toBeVisible();

  // Conditional replay actions must not resize the history strip. The original
  // implementation added the button as another readout row and shifted the entire
  // ladder section whenever keyboard or pointer scrubbing entered a prior session.
  const historyCard = page.locator(".obs-gex-history");
  const latestHeight = await historyCard.evaluate((el) => el.getBoundingClientRect().height);

  // The scrubber probes a session the index does NOT list (2026-07-07 — the fixture's
  // deliberate accrual hole, the prod 07-18/07-20 class): honest missing-session state,
  // never a fabricated ladder.
  const scrubber = page.locator('svg[role="slider"]');
  await scrubber.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const loadFullLadder = page.getByRole("button", { name: "Load full ladder" });
  await expect(loadFullLadder).toBeVisible();
  const replayHeight = await historyCard.evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(replayHeight - latestHeight)).toBeLessThanOrEqual(1);
  await loadFullLadder.click();
  await expect(chip).toContainText("archived session · 2026-07-07");
  const missing = page.getByTestId("gex-archived-missing");
  await expect(missing).toBeVisible();
  await expect(missing).toContainText("No archived snapshot for 2026-07-07");

  // Back to the live session: chip gone, live ladder back.
  await page.getByRole("button", { name: "Back to latest" }).first().click();
  await expect(page.getByTestId("gex-archived-chip")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Strike range" })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-gex-archived-session.png`),
    fullPage: false,
  });
});
