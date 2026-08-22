import { test, expect } from "./fixtures";

// Native shell mode (?shell=app): the WebView surface the installable apps load.
// Chrome (topbar, mobile bar, nav rail, watchlist rail, movers ticker) must be gone,
// the chart must fill the single grid cell, and the window.__mmShell bridge must
// drive symbol/timeframe through the existing product seams.
// Runs in every viewport project (desktop / tablet / mobile) like responsive.spec.ts.

const SHELL_URL = "/terminal?symbol=NVDA&shell=app";
const TRAY_URL = "/terminal?symbol=NVDA&shell=app&tray=1";
const DOSSIER_URL = "/terminal?symbol=NVDA&shell=app&dossier=1";
const WEB_URL = "/terminal?symbol=NVDA";

test.describe("native shell mode", () => {
  test("chart-only chrome, working bridge, no overflow", async ({ page }) => {
    await page.goto(SHELL_URL);

    // Marker the deploy verification greps for (SSR'd, since shellMode is a server prop).
    // D0 added a SECOND marker on <html> (pre-paint, so CSS-variable rethemes are visible to
    // ChartPanel.readTokens) — the SSR'd .app marker is asserted explicitly here.
    await expect(page.locator('.app[data-shell="app"]')).toHaveCount(1);
    await expect(page.locator('html[data-shell="app"]')).toHaveCount(1);

    // Global chrome is absent from the DOM entirely (not merely display:none).
    await expect(page.locator("header.topbar")).toHaveCount(0);
    await expect(page.locator(".mobilebar")).toHaveCount(0);
    await expect(page.locator(".m-symbar")).toHaveCount(0);
    await expect(page.locator("nav.appnav")).toHaveCount(0);
    await expect(page.locator("aside.rail")).toHaveCount(0);
    await expect(page.locator(".ticker")).toHaveCount(0);

    // The chart itself still mounts and renders.
    await expect(page.locator(".workspace canvas").first()).toBeVisible({ timeout: 45_000 });

    // The native roller strip owns interval switching — the toolbar TF quick tray is hidden.
    await expect(page.locator(".chart-tabs .tftray")).toBeHidden();

    // Drawing tools cede chart real estate in shell mode; the native pencil re-enables
    // them via setDrawTools → the .shell-draw class.
    await expect(page.locator(".ds-dock")).toBeHidden();
    await expect(page.locator(".ds-favorites")).toBeHidden();
    await page.waitForFunction(() => (window as any).__mmShell?.version === 1);
    await page.evaluate(() => (window as any).__mmShell.setDrawTools(true));
    await expect(page.locator(".app.shell-draw")).toHaveCount(1);
    await page.evaluate(() => (window as any).__mmShell.setDrawTools(false));
    await expect(page.locator(".app.shell-draw")).toHaveCount(0);

    // The chart fills the frame — the mobile 46–80svh cap must not apply in shell mode
    // (a shell WebView has no scrolling page below the chart).
    // Raised 0.8 → 0.97 by the TV chart-surface parity wave: D1 floats the toolbar row onto the
    // canvas and D8 floats the frame bar, returning 72.3pt (~8.7%) of chart height to the plot.
    const chartFill = await page.evaluate(() => {
      const body = document.querySelector(".chart-body");
      return body ? body.getBoundingClientRect().height / window.innerHeight : 0;
    });
    expect(chartFill).toBeGreaterThan(0.97);

    // No horizontal document overflow at any project viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Bridge installed with the contract surface.
    await page.waitForFunction(() => (window as any).__mmShell?.version === 1);
    const tfs = await page.evaluate(() => {
      // ready() already posted; re-derive the advertised list from the API for the assertion.
      const api = (window as any).__mmShell;
      return { hasGetState: typeof api.getState === "function", sym: api.getState().sym };
    });
    expect(tfs.hasGetState).toBe(true);
    expect(tfs.sym).toBe("NVDA");

    // Native → web commands ride the existing seams and update live state.
    await page.evaluate(() => (window as any).__mmShell.setSymbol("AAPL"));
    await page.waitForFunction(() => (window as any).__mmShell.getState().sym === "AAPL");
    await page.evaluate(() => (window as any).__mmShell.setTimeframe("D"));
    await page.waitForFunction(() => (window as any).__mmShell.getState().tf === "D");
  });

  test("shell tray=1 keeps the TF tray for the embedded preview chart", async ({ page }) => {
    await page.goto(TRAY_URL);
    // .app carries the SSR'd marker; <html> carries D0's pre-paint twin.
    await expect(page.locator('.app[data-tray="1"]')).toHaveCount(1);
    await expect(page.locator('html[data-tray="1"]')).toHaveCount(1);
    await expect(page.locator(".chart-tabs .tftray")).toBeVisible();
    // Drawing tools stay hidden even with the tray enabled.
    await expect(page.locator(".ds-favorites")).toBeHidden();
  });

  test("embed widget hdr=0 hides the quote line, keeps range tabs", async ({ page }) => {
    await page.goto("/embed/chart?symbol=NVDA&hdr=0");
    await expect(page.locator(".embed-ranges")).toBeVisible();
    await expect(page.locator(".embed-head-quote")).toBeHidden();
    // Without the param the quote line stays (dossier iframes unchanged).
    await page.goto("/embed/chart?symbol=NVDA");
    await expect(page.locator(".embed-head-quote")).toBeVisible();
  });

  // ── TV symbol-sheet mini chart (docs/tv-parity/spec-symbol-detail.md §2B) ──────────
  test("embed clean=1 is candles-only with TV chips; fs=1 adds the fullscreen affordance", async ({ page }) => {
    await page.goto("/embed/chart?symbol=NVDA&clean=1&fs=1&hdr=0");

    // Root marker — every clean-mode CSS rule hangs off it.
    await expect(page.locator('.embed-root[data-clean="1"]')).toHaveCount(1);
    // Candles only: no SMA series ⇒ no SMA legend to drive them.
    await expect(page.locator(".embed-legend")).toHaveCount(0);
    // The range row survives and gains the ⤢ square (a browser tap is a silent no-op).
    await expect(page.locator(".embed-ranges")).toBeVisible();
    const fs = page.locator(".embed-fs");
    await expect(fs).toBeVisible();
    const fsBox = await fs.boundingBox();
    expect(fsBox!.width).toBeGreaterThanOrEqual(30);
    expect(fsBox!.height).toBeGreaterThanOrEqual(30);
    await fs.click(); // must not throw / navigate without a native host
    await expect(page.locator('.embed-root[data-clean="1"]')).toHaveCount(1);

    // ── C24: TV parks the range row UNDER the chart so thumbs stay low ────────────
    // The header keeps its DOM position; clean mode flips flex order on the column root.
    const bodyBox = (await page.locator(".embed-body").boundingBox())!;
    const rangeBox = (await page.locator(".embed-ranges").boundingBox())!;
    expect(rangeBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height - 1);
    // …the ⤢ rides with it and stays at the right end of that same row, still clickable.
    const fsBox2 = (await fs.boundingBox())!;
    expect(fsBox2.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height - 1);
    expect(fsBox2.x + fsBox2.width).toBeGreaterThan(rangeBox.x + rangeBox.width / 2);
    await expect(fs).toBeVisible();
    await fs.click();
    // …the pills sit ~8px above the widget's bottom edge (.embed-root is position:fixed;inset:0).
    const bottomGap = await page.evaluate(
      () => window.innerHeight - document.querySelector(".embed-ranges")!.getBoundingClientRect().bottom,
    );
    expect(bottomGap).toBeGreaterThanOrEqual(6);
    expect(bottomGap).toBeLessThanOrEqual(12);
    // …and the chart body still fills everything above it — the absolute-inset host keeps sizing
    // after the order flip (the regression this guards is a 0-height chart host).
    const hostBox = (await page.locator(".embed-chart-host").boundingBox())!;
    expect(hostBox.height).toBeGreaterThan(0);
    expect(hostBox.height).toBeCloseTo(bodyBox.height, 0);
    const vh = await page.evaluate(() => window.innerHeight);
    expect(bodyBox.height / vh).toBeGreaterThan(0.7);
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )).toBeLessThanOrEqual(0);

    // Chips wear the measured TV capsule treatment (selected #2E2E2E on #DBDBDB).
    const active = page.locator(".embed-chip.is-active").first();
    const chip = await active.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, weight: s.fontWeight, size: parseFloat(s.fontSize) };
    });
    expect(chip.bg).toBe("rgb(46, 46, 46)");
    expect(chip.color).toBe("rgb(219, 219, 219)");
    expect(Number(chip.weight)).toBeGreaterThanOrEqual(600);
    expect(chip.size).toBeGreaterThanOrEqual(13);
    expect(chip.size).toBeLessThanOrEqual(14);
    const idle = await page.locator(".embed-chip:not(.is-active)").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    expect(idle.bg).toBe("rgba(0, 0, 0, 0)");
    expect(idle.color).toBe("rgb(140, 140, 140)");

    // Web parity: without ?clean the widget is untouched — SMA legend back, no fs button,
    // no marker, and the chips keep their house styling.
    await page.goto("/embed/chart?symbol=NVDA");
    await expect(page.locator("[data-clean]")).toHaveCount(0);
    await expect(page.locator(".embed-fs")).toHaveCount(0);
    await expect(page.locator(".embed-legend")).toBeVisible({ timeout: 30_000 });
    const webChip = await page.locator(".embed-chip.is-active").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, size: parseFloat(s.fontSize) };
    });
    expect(webChip.size).toBeCloseTo(11, 0);
    expect(webChip.color).not.toBe("rgb(219, 219, 219)");
    // …and the order flip is inert too: the browser widget keeps its ranges ABOVE the chart.
    const webBody = (await page.locator(".embed-body").boundingBox())!;
    const webRanges = (await page.locator(".embed-ranges").boundingBox())!;
    expect(webRanges.y + webRanges.height).toBeLessThanOrEqual(webBody.y + 1);
  });

  // ── dossier mode: the detail rail is the whole page, no chart workspace ────────────
  test("shell dossier=1 renders the detail rail as the only content", async ({ page }) => {
    await page.goto(DOSSIER_URL);

    await expect(page.locator('[data-dossier="1"]')).toHaveCount(1);
    // The chart workspace is absent from the DOM entirely — the native sheet owns the chart.
    await expect(page.locator(".workspace")).toHaveCount(0);
    // …and the rail, which plain shell mode drops, is here and visible.
    const rail = page.locator("aside.rail");
    await expect(rail).toBeVisible();
    await expect(page.locator(".detail-board")).toBeVisible();
    // Watchlist board + resizer stay out at every viewport (the native list owns them).
    await expect(page.locator(".rail .wl-board")).toBeHidden();
    await expect(page.locator(".rail-resizer")).toHaveCount(0);
    // Still no global web chrome.
    await expect(page.locator("header.topbar")).toHaveCount(0);
    await expect(page.locator(".mobilebar")).toHaveCount(0);
    await expect(page.locator(".ticker")).toHaveCount(0);

    // The rail is ordinary full-width block flow, not a fixed-width grid column.
    const geom = await page.evaluate(() => {
      const r = document.querySelector("aside.rail") as HTMLElement;
      const s = getComputedStyle(r);
      return { display: s.display, w: r.getBoundingClientRect().width, vw: window.innerWidth };
    });
    expect(geom.display).toBe("block");
    expect(geom.w).toBeCloseTo(geom.vw, 0);

    // The page scrolls naturally: nothing traps the dossier in an inner scroller, and the
    // document is at least a full viewport tall (min-height:100svh, no 100svh LOCK).
    const scroll = await page.evaluate(() => ({
      rail: getComputedStyle(document.querySelector("aside.rail")!).overflow,
      inner: getComputedStyle(document.querySelector(".detail-scroll")!).overflow,
      docH: document.documentElement.scrollHeight,
      vh: window.innerHeight,
    }));
    expect(scroll.rail).toBe("visible");
    expect(scroll.inner).toBe("visible");
    expect(scroll.docH).toBeGreaterThanOrEqual(scroll.vh);
    // …with no horizontal document overflow at any project viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The bridge still installs and answers without a chart on the page.
    await page.waitForFunction(() => (window as any).__mmShell?.version === 1);
    expect(await page.evaluate(() => (window as any).__mmShell.getState().sym)).toBe("NVDA");

    // Scope law: dossier is inert without the param — plain shell keeps chart-only chrome.
    await page.goto(SHELL_URL);
    await expect(page.locator("[data-dossier]")).toHaveCount(0);
    await expect(page.locator("aside.rail")).toHaveCount(0);
    await expect(page.locator(".workspace")).toHaveCount(1);
    // …and the browser web app never sees it either.
    await page.goto(WEB_URL);
    await expect(page.locator("[data-dossier]")).toHaveCount(0);
    await expect(page.locator(".workspace")).toHaveCount(1);
    await expect(page.locator("aside.rail")).toHaveCount(1);
  });

  // ── R2.5 bridge additions: tool activation, panels, history, richer payloads ──────────
  test("bridge v1 R2 additions drive drawings, panels and history", async ({ page }) => {
    // Stand in for the WKWebView message handler so the outbound payloads can be read back.
    await page.addInitScript(() => {
      const posts: unknown[] = [];
      (window as unknown as { __mmPosts: unknown[] }).__mmPosts = posts;
      (window as unknown as { webkit: unknown }).webkit = {
        messageHandlers: { mm: { postMessage: (message: unknown) => posts.push(message) } },
      };
    });
    await page.goto(SHELL_URL);
    await page.waitForFunction(() => (window as any).__mmShell?.version === 1);

    // `ready` carries the favourites and the whole engine tool inventory, so the native sheet
    // never hardcodes an engine list.
    const posted = () => page.evaluate(() => (window as any).__mmPosts as any[]);
    const ready = (await posted()).find((message) => message.type === "ready");
    expect(ready.availableTimeframes.length).toBeGreaterThan(5);
    expect(ready.favTimeframes).toEqual(["D", "3D", "W", "1M"]);
    expect(ready.drawTools.length).toBeGreaterThan(50);
    expect(ready.drawTools.find((tool: any) => tool.id === "trendline"))
      .toEqual({ id: "trendline", label: "Trend Line", group: "trendlines" });
    expect([...new Set(ready.drawTools.map((tool: any) => tool.group))].sort())
      .toEqual(["gannfib", "patterns", "tools", "trendlines"]);

    // …and every stateChanged repeats them, so a native shell that missed `ready` still catches up.
    await page.evaluate(() => (window as any).__mmShell.setTimeframe("W"));
    await page.waitForFunction(() => (window as any).__mmShell.getState().tf === "W");
    await expect.poll(async () => {
      const state = (await posted()).filter((message) => message.type === "stateChanged").at(-1);
      return { tf: state?.tf, favs: state?.favTimeframes, tools: state?.drawTools?.length > 50 };
    }).toEqual({ tf: "W", favs: ["D", "3D", "W", "1M"], tools: true });

    // setDrawTool arms the tool through the dock's own path — and the dock stays hidden.
    await expect
      .poll(() => page.evaluate(() => (window as any).__mmShell.setDrawTool("trendline")), { timeout: 20_000 })
      .toBe(true);
    await expect(page.getByTestId("drawing-group-lines-main")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("drawing-group-lines-main")).toHaveAttribute("data-tool-id", "trendline");
    await expect(page.locator(".ds-dock")).toBeHidden();
    await expect(page.locator(".ds-favorites")).toBeHidden();
    expect(await page.evaluate(() => (window as any).__mmShell.setDrawTool("not-a-tool"))).toBe(false);

    // Undo/redo are real history calls; an empty stack is a safe no-op, not a throw.
    expect(await page.evaluate(() => (window as any).__mmShell.drawUndo())).toBe(false);
    expect(await page.evaluate(() => (window as any).__mmShell.drawRedo())).toBe(false);

    // openPanel raises the WEB modal — one implementation of each, wherever it is asked for.
    expect(await page.evaluate(() => (window as any).__mmShell.openPanel("indicators"))).toBe(true);
    await expect(page.locator("#indicator-library-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#indicator-library-dialog")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__mmShell.openPanel("compare"))).toBe(true);
    await expect(page.locator(".smodal-cmp")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as any).__mmShell.openPanel("nope" as never))).toBe(false);
  });

  test("normal mode is untouched", async ({ page }) => {
    await page.goto("/terminal?symbol=NVDA");
    // Chrome present in the DOM (viewport CSS decides visibility)…
    await expect(page.locator(".mobilebar")).toHaveCount(1);
    await expect(page.locator("nav.appnav")).toHaveCount(1);
    await expect(page.locator('[data-shell="app"]')).toHaveCount(0);
    // …and no bridge is installed outside shell mode.
    const hasBridge = await page.evaluate(() => "__mmShell" in window && (window as any).__mmShell != null);
    expect(hasBridge).toBe(false);
  });
});

// The statusline is innerHTML-rebuilt by paintStatus on every live-quote tick, so a Playwright
// locator handle to one of its nodes can be detached before it is measured — and a detached node
// reports an empty computed style. Always re-query inside the evaluate and poll the result.
const statusNameSize = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".status-symbol-name");
    return el ? parseFloat(getComputedStyle(el).fontSize) : NaN;   // NaN keeps the poll running
  });

// ── TV chart-surface parity (docs/tv-parity CHART_SURFACE_DELTA_SPEC, D0–D12) ──────────
// Every rule under test is scoped to html[data-shell="app"]; the final test re-asserts the
// scope law (the browser web app must be inert to all of it).
test.describe("TV chart-surface parity (shell)", () => {
  const chartReady = async (page: import("@playwright/test").Page) => {
    await expect(page.locator(".workspace canvas").first()).toBeVisible({ timeout: 45_000 });
  };

  // The production CSS pipeline minifies custom-property VALUES (rgba(255,255,255,.055) ships as
  // #ffffff0e), so a raw getPropertyValue string comparison is a build-detail assertion. Resolve
  // the token through a probe element instead and compare the actual rendered color.
  const resolveToken = (page: import("@playwright/test").Page, name: string) =>
    page.evaluate((n) => {
      const d = document.createElement("div");
      d.style.color = `var(${n})`;
      document.body.appendChild(d);
      const c = getComputedStyle(d).color;
      d.remove();
      const m = c.match(/[\d.]+/g)!.map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
    }, name);

  // A. Root marker + token plumbing (guards D0/D6 — the silent-failure mode).
  test("A · root marker is set pre-paint and the chart tokens are retuned", async ({ page }) => {
    await page.goto(SHELL_URL);
    await expect(page.locator("html[data-shell='app']")).toHaveCount(1);
    const tok = await page.evaluate(() => {
      const g = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      return { up: g("--up"), down: g("--down"), axis: g("--chart-axis-text") };
    });
    expect(tok.up).toBe("#089981");
    expect(tok.down).toBe("#f23645");
    expect(tok.axis).toBe("#b1b5be");
    const grid = await resolveToken(page, "--chart-grid");
    expect([grid.r, grid.g, grid.b]).toEqual([255, 255, 255]);
    expect(grid.a).toBeCloseTo(0.055, 2);
    // web must NOT be retouched
    await page.goto(WEB_URL);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--up").trim())).toBe("#26c281");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--chart-axis-text").trim())).toBe("#717a8e");
    const webGrid = await resolveToken(page, "--chart-grid");
    expect([webGrid.r, webGrid.g, webGrid.b]).toEqual([255, 255, 255]);
    expect(webGrid.a).toBeCloseTo(0.04, 2);
  });

  // B. Toolbar row is gone entirely in plain shell mode (C24 revision of D1).
  // TV's chart tab carries no top controls at all, so the floating pill row that D1 shipped is
  // deleted rather than restyled; indicator / chart-type management returns via the native hub.
  // tray=1 — the embedded preview-engine sheet — keeps its icon-only tray (see H).
  test("B · plain shell hides the toolbar row; tray=1 still shows the tray", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const tabs = page.locator(".chart-tabs");
    await expect(tabs).toBeHidden();
    expect(await tabs.evaluate((el) => getComputedStyle(el).display)).toBe("none");
    // nothing the row contained is reachable — the whole subtree goes with it
    await expect(page.locator(".chart-tabs .indicator-library-trigger")).toBeHidden();
    await expect(page.locator(".chart-tabs .tftray")).toBeHidden();
    await expect(page.locator(".chart-tabs .tbtn.dtm")).toBeHidden();
    // no chart height is consumed above the canvas
    const wrapTop = await page.locator(".chart-wrap").first().evaluate((el) => el.getBoundingClientRect().top);
    expect(wrapTop).toBeLessThanOrEqual(2);

    // tray=1 keeps the row and its controls.
    await page.goto(TRAY_URL);
    await chartReady(page);
    await expect(page.locator(".chart-tabs")).toBeVisible();
    await expect(page.locator(".chart-tabs .tftray")).toBeVisible();
    await expect(page.locator(".chart-tabs .indicator-library-trigger")).toBeVisible();
  });

  // C. Chart reclaims both bands (D1 + D8).
  test("C · the chart reclaims the toolbar and range bands", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const fill = await page.evaluate(() => {
      const b = document.querySelector(".chart-body")!.getBoundingClientRect();
      return b.height / window.innerHeight;
    });
    expect(fill).toBeGreaterThan(0.97);
    expect(await page.locator(".chart-frame-bar").evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
    await expect(page.locator(".cfb-left")).toBeHidden();
    await expect(page.locator(".cfb-clock")).toBeHidden();
    await expect(page.locator(".cfb-gear")).toBeVisible();
  });

  // D. Header is two rows, nothing clips (D2).
  test("D · identity/quote header stacks into two rows and never clips", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const col = page.locator(".statusline > span").first();
    expect(await col.evaluate((el) => getComputedStyle(el).flexDirection)).toBe("column");
    await expect(page.locator(".status-ohlc")).toBeHidden();
    await expect(page.locator(".status-last")).toBeVisible();
    // C7 added the regular-width branch: 17px is the phone ramp, 20px from min-width:700px.
    const wide = (page.viewportSize()?.width ?? 0) >= 700;
    await expect.poll(() => statusNameSize(page), { timeout: 45_000 }).toBeCloseTo(wide ? 20 : 17, 0);
    // no element in the header may cross the viewport edge
    const rightMost = await page.evaluate(() => Math.max(
      ...[...document.querySelectorAll(".statusline *")].map((e) => e.getBoundingClientRect().right)));
    expect(rightMost).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  });

  // E. Legend chip + rows (D3 + D4).
  test("E · legend chip is an outlined ghost pill and the rows lose their plate", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const chip = page.locator(".lg-collapse").first();
    await expect(chip).toBeVisible();
    const cs = await chip.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, bw: s.borderTopWidth, bc: s.borderTopColor, h: s.height, top: el.getBoundingClientRect().top };
    });
    expect(cs.bg).toBe("rgba(0, 0, 0, 0)");
    expect(cs.bw).toBe("1px");
    expect(cs.bc).toBe("rgb(61, 61, 61)");
    // C7's regular-width branch grows the pill to 30px above min-width:700px.
    const wide = (page.viewportSize()?.width ?? 0) >= 700;
    expect(parseFloat(cs.h)).toBeCloseTo(wide ? 30 : 26, 0);
    expect(cs.top).toBeGreaterThan(50);            // clears the two-row header
    const row = page.locator(".lg-row").first();
    if (!(await row.isVisible())) await chip.click();   // expand when the legend starts collapsed
    await expect(row).toBeVisible();
    // plate killed despite the inline style attribute
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await page.locator(".lg-name").first().evaluate((el) => getComputedStyle(el).color)).toBe("rgb(177, 181, 190)");
  });

  // F. Axis chips carry no series-name pill (D5).
  test("F · axis value pills carry no series-name chip", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    // LWC renders axis labels on canvas — assert at the option layer via the dev-only hook.
    await expect.poll(
      async () => (await page.evaluate(() => (window as any).__mmChartSeriesTitles?.() ?? [])).length,
      { timeout: 45_000 },
    ).toBeGreaterThan(0);
    const titles: string[] = await page.evaluate(() => (window as any).__mmChartSeriesTitles());
    expect(titles.every((t) => t === "")).toBe(true);
    // …and the same hook proves the web app still ships its titles (the assertion is not vacuous).
    await page.goto(WEB_URL);
    await chartReady(page);
    await expect.poll(
      async () => (await page.evaluate(() => (window as any).__mmChartSeriesTitles?.() ?? [])).filter((t: string) => t !== "").length,
      { timeout: 45_000 },
    ).toBeGreaterThan(0);
  });

  // G. Price badge is single-line (D9) and the countdown rides BELOW it (C10).
  test("G · the last-price axis badge is a single line with the countdown lifted out", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const tag = page.locator(".mm-ptag");
    await expect(tag).toBeVisible({ timeout: 45_000 });
    const tagH = await tag.evaluate((el) => el.getBoundingClientRect().height);
    expect(tagH).toBeGreaterThan(0);
    expect(tagH).toBeLessThanOrEqual(20);          // TV measures 17pt
    // C10/CHART-07 — D9 hid the countdown with `display:none!important`, which also overrode the
    // user's chartSettings.countdownVisible toggle. It is now a sibling caption positioned out of
    // the badge's flow, so the badge stays single-line AND the setting works again.
    const cd = page.locator(".mm-ptag-cd");
    // The shell rule must NOT declare `display` at all — renderPriceTag writes it inline from
    // countdownVisible, and the old `display:none!important` won in ONE direction only. Drive the
    // inline value from both sides: the computed value has to follow it every time.
    const geom = await cd.evaluate((el) => {
      const e = el as HTMLElement;
      e.style.display = "none";
      const off = getComputedStyle(e).display;
      e.style.display = "block";
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const tag = (e.closest(".mm-ptag") as HTMLElement).getBoundingClientRect();
      return { off, on: s.display, position: s.position, size: parseFloat(s.fontSize), top: r.top, tagBottom: tag.bottom };
    });
    expect(geom.off).toBe("none");
    expect(geom.on).toBe("block");
    expect(geom.position).toBe("absolute");
    expect(geom.size).toBeCloseTo(12, 0);
    expect(geom.top).toBeGreaterThanOrEqual(geom.tagBottom - 1);   // sits BELOW the badge, not inside it
  });

  // H. Tray mode: no crowding, no duplicate identity (D11).
  test("H · tray mode fits every control and drops the duplicated identity", async ({ page }) => {
    await page.goto(TRAY_URL);
    await chartReady(page);
    await expect(page.locator(".chart-tabs .tftray")).toBeVisible();
    await expect(page.locator(".statusline > span").first()).toBeHidden();
    // every toolbar control is inside the viewport — nothing clipped, no scroll needed
    const overflowPx = await page.locator(".chart-tabs").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflowPx).toBeLessThanOrEqual(0);
    const vw = await page.evaluate(() => window.innerWidth);
    for (const sel of [".chart-tabs .indicator-library-trigger", ".chart-tabs .tbtn.dtm"]) {
      const r = await page.locator(sel).evaluate((el) => el.getBoundingClientRect().right);
      expect(r).toBeLessThanOrEqual(vw);
    }
  });

  // I. Web-parity guard (the scope law).
  test("I · every parity rule is inert without ?shell=app", async ({ page }) => {
    await page.goto(WEB_URL);
    await chartReady(page);
    expect(await page.locator(".chart-tabs").evaluate((el) => getComputedStyle(el).position)).not.toBe("absolute");
    // The toolbar row survives on the web at every width the web still ships it — R2.2 retired it
    // on the PHONE (≤640px) in favour of the roller strip, which is not a shell-parity rule.
    const web = (page.viewportSize()?.width ?? 1440) > 640;
    if (web) {
      const toolbarMode = await page.locator(".chart-tabs").getAttribute("data-toolbar-mode");
      if (toolbarMode === "full") await expect(page.locator(".chart-tabs .ct")).toBeVisible();
      else {
        await expect(page.locator(".chart-tabs .ct")).toBeHidden();
        await expect(page.getByTestId("toolbar-more")).toBeVisible();
      }
    }
    await expect(page.locator(".status-last")).toBeHidden();
    // R2c retired the range row on the PHONE too — also not a shell-parity rule, so the row's
    // web presence is only assertable where the web still ships it.
    if (web) {
      await expect(page.locator(".cfb-left")).toBeVisible();
      await expect(page.locator(".chart-frame-bar")).toBeVisible();
      expect(await page.locator(".chart-frame-bar").evaluate((el) => getComputedStyle(el).position)).toBe("relative");
    }
    const chip = page.locator(".lg-collapse").first();
    expect(await chip.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
    expect(await chip.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe("rgba(0, 0, 0, 0)");
    // D12's quieter pane separator must not reach the web app either
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pane-sep").trim())).toBe("#39404d");
  });
});

// ── Polish round C1–C11 (docs/tv-parity/POLISH_ROUND_SPEC_2026-08-01.md §3) ────────────
// Same scope law: every rule is shell-scoped or clean-gated, and test S re-proves the web app is
// inert to all of it. The canvas-drawn contracts (axis rule, label pitch, volume band, axis font,
// watermark) are asserted at the option layer through __mmChartAxisOpts.
test.describe("TV chart-surface polish (shell)", () => {
  const chartReady = async (page: import("@playwright/test").Page) => {
    await expect(page.locator(".workspace canvas").first()).toBeVisible({ timeout: 45_000 });
  };
  type AxisOpts = {
    priceBorderVisible: boolean | null; tickMarkDensity: number | null; paneTickMarkDensity: number[];
    timeBorderColor: string | null; fontSize: number | null; volumeTop: number | null; watermarkVisible: boolean;
  };
  const axisOpts = async (page: import("@playwright/test").Page): Promise<AxisOpts> => {
    await expect
      .poll(async () => await page.evaluate(() => (window as any).__mmChartAxisOpts?.() != null), { timeout: 45_000 })
      .toBe(true);
    return await page.evaluate(() => (window as any).__mmChartAxisOpts());
  };
  // C3/C7 share ONE breakpoint with globals.css; the desktop + tablet projects are above it.
  const isWide = (page: import("@playwright/test").Page) => (page.viewportSize()?.width ?? 0) >= 700;

  // J — C1: the canvas gradient runs lightest-top so the DARKEST row meets the black native chrome.
  test("J · the canvas gradient runs light→dark top to bottom", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const bg = await page.locator(".pane").first().evaluate((el) => getComputedStyle(el).backgroundImage);
    // computed order is authoritative: first stop = top of the pane.
    const stops = bg.match(/rgba?\([^)]*\)/g) ?? [];
    expect(stops.length).toBeGreaterThanOrEqual(2);
    const top = stops[0]!, bottom = stops[stops.length - 1]!;
    const lum = (s: string) => s.match(/[\d.]+/g)!.slice(0, 3).reduce((a, n) => a + Number(n), 0);
    expect(lum(top)).toBeGreaterThan(lum(bottom));
    expect(top).toBe("rgb(24, 27, 38)");                            // #181b26
    expect(bottom).toBe("rgb(19, 22, 33)");                         // #131621 (TV's measured floor)
  });

  // K — C2: no price-scale border; the time-axis rule lightens to TV's measured #2A2D38.
  test("K · the price scale loses its border and the time axis keeps a lighter rule", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const o = await axisOpts(page);
    expect(o.priceBorderVisible).toBe(false);
    expect(String(o.timeBorderColor).toLowerCase()).toBe("#2a2d38");
    // …and the assertion is not vacuous: the browser web app keeps both rules on --line.
    await page.goto(WEB_URL);
    await chartReady(page);
    const w = await axisOpts(page);
    expect(w.priceBorderVisible).toBe(true);
    expect(String(w.timeBorderColor).toLowerCase()).not.toBe("#2a2d38");
  });

  // L — C3/C7: label pitch + the regular-width ramp, both on the one min-width:700px breakpoint.
  test("L · gridline pitch and the regular-width type ramp step on one breakpoint", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const wide = isWide(page);
    const o = await axisOpts(page);
    // 12px font × 3.9 = TV's measured 47 CSS px pitch. 4.6 is the regular-width invention (A20.12).
    expect(o.tickMarkDensity).toBeCloseTo(wide ? 4.6 : 3.9, 2);
    expect(o.fontSize).toBe(wide ? 13 : 12);
    // every sub-pane scale carries it too, or the oscillators keep the dense default.
    expect(o.paneTickMarkDensity.length).toBeGreaterThan(0);
    for (const d of o.paneTickMarkDensity) expect(d).toBeCloseTo(o.tickMarkDensity!, 2);
    // CSS half of the ramp — identical breakpoint, so type and pitch cannot drift apart.
    // Polled: paintStatus re-renders the statusline on every live-quote tick, so a locator handle
    // can be detached by the time it is measured (a detached node computes an empty style).
    await expect.poll(() => statusNameSize(page), { timeout: 45_000 }).toBeCloseTo(wide ? 20 : 17, 0);
    const gearW = await page.locator(".cfb-gear").evaluate((el) => el.getBoundingClientRect().width);
    expect(gearW).toBeCloseTo(wide ? 30 : 26, 0);
    // C9 — the ::before inset carries the TOUCH target past the 44pt iOS minimum. The drawn box
    // must NOT grow with it (the .lg-ic min-height trap), so the width assertion above still holds.
    const hit = await page.locator(".cfb-gear").evaluate((el) => {
      const s = getComputedStyle(el, "::before");
      return { pos: s.position, inset: Math.abs(parseFloat(s.top)), box: el.getBoundingClientRect().width };
    });
    expect(hit.pos).toBe("absolute");
    expect(hit.box + 2 * hit.inset).toBeGreaterThanOrEqual(44);
    // Web keeps the library default and the untouched axis font at every viewport.
    await page.goto(WEB_URL);
    await chartReady(page);
    const w = await axisOpts(page);
    expect(w.tickMarkDensity).toBeCloseTo(2.5, 2);
    expect(w.fontSize).toBe(12);
  });

  // M — C4/C5: the volume band shrinks to 12% and the brand bug leaves it for a DOM node.
  test("M · volume band is 12% and the brand bug is a DOM node clear of it", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    // The "volume" scale only exists once buildVol has run, which trails the first canvas paint.
    await expect
      .poll(async () => (await axisOpts(page)).volumeTop, { timeout: 45_000 })
      .toBeCloseTo(0.88, 3);                         // 12% band (A20.13), was 22%
    const o = await axisOpts(page);
    expect(o.watermarkVisible).toBe(false);          // the LWC plugin is OFF in shell
    const bug = page.locator(".mm-brandbug");
    await expect(bug).toBeVisible();
    const box = await bug.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const pane = (el.closest(".pane") as HTMLElement).getBoundingClientRect();
      return { left: r.left - pane.left, fromBottom: pane.bottom - r.bottom, z: getComputedStyle(el).zIndex };
    });
    expect(box.left).toBeCloseTo(12, 0);
    expect(box.fromBottom).toBeCloseTo(38, 0);       // clears the time axis (A20.14)
    expect(Number(box.z)).toBeGreaterThanOrEqual(1); // above the canvas — no series can overpaint it
  });

  // N — C6: Row B carries OHLC under the crosshair and last/change at rest.
  test("N · crosshair scrub swaps Row B to OHLC and restores it on release", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const line = page.locator(".statusline");
    await expect(page.locator(".status-ohlc")).toBeHidden();
    await expect(page.locator(".status-last")).toBeVisible();

    const canvas = page.locator(".workspace canvas").first();
    const cb = (await canvas.boundingBox())!;
    await page.mouse.move(cb.x + cb.width * 0.45, cb.y + cb.height * 0.4);
    await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.45);
    await expect(line).toHaveClass(/is-scrub/, { timeout: 15_000 });
    await expect(page.locator(".status-ohlc")).toBeVisible();
    await expect(page.locator(".status-last")).toBeHidden();
    // all four values populated by textContent — an empty node would mean the lookup missed.
    const vals = await page.locator(".status-ohlc b").allTextContents();
    expect(vals).toHaveLength(4);
    for (const v of vals) expect(v.trim()).not.toBe("");
    // …and the handler writes textContent rather than re-rendering: across consecutive crosshair
    // frames the OHLC text must move while the identity <img> stays the SAME node. A paintStatus()
    // call would replace it and re-fetch the logo — C6's trap. Sampled over several frames because
    // the live-quote poller repaints the line on its own cadence (~1 per 4 s); a handler that
    // re-rendered would lose the node on EVERY frame, so a single clean frame is proof.
    const xs = [0.3, 0.45, 0.6, 0.72];
    let sameNode = 0, valuesMoved = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      await page.mouse.move(cb.x + cb.width * xs[i]!, cb.y + cb.height * 0.45);
      const before = await page.evaluate(() => {
        (document.querySelector(".status-symbol-logo img") as any).__mmProbe = 1;
        return [...document.querySelectorAll(".status-ohlc b")].map((b) => b.textContent).join("|");
      });
      await page.mouse.move(cb.x + cb.width * xs[i + 1]!, cb.y + cb.height * 0.45);
      const after = await page.evaluate(() => ({
        same: !!(document.querySelector(".status-symbol-logo img") as any).__mmProbe,
        vals: [...document.querySelectorAll(".status-ohlc b")].map((b) => b.textContent).join("|"),
      }));
      if (after.same) sameNode++;
      if (after.vals !== before) valuesMoved++;
    }
    expect(valuesMoved).toBeGreaterThan(0);   // non-vacuous: the readout really tracks the hovered bar
    expect(sameNode).toBeGreaterThan(0);      // …and it never rebuilt the statusline to do it

    // Release: hovering the frame bar takes the pointer off the pane, so LWC clears the crosshair
    // and Row B comes back. (.cfb-right is the one pointer-events:auto island over the canvas.)
    await page.locator(".cfb-gear").hover();
    await expect(line).not.toHaveClass(/is-scrub/, { timeout: 15_000 });
    await expect(page.locator(".status-ohlc")).toBeHidden();
    await expect(page.locator(".status-last")).toBeVisible();
  });

  // O — C8a: the permanently-disabled ETH chip is hidden on daily, back on intraday.
  test("O · the inert ETH chip is hidden on daily and returns intraday", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    const chip = page.locator(".cfb-chip", { hasText: "ETH" }).first();
    await expect(chip).toHaveClass(/dis/);
    await expect(chip).toBeHidden();
    // Intraday makes it a real control again — the rule keys off `.dis`, not the timeframe.
    await page.waitForFunction(() => (window as any).__mmShell?.version === 1);
    await page.evaluate(() => (window as any).__mmShell.setTimeframe("5m"));
    await page.waitForFunction(() => (window as any).__mmShell.getState().tf === "5m");
    await expect(chip).not.toHaveClass(/dis/);
    await expect(chip).toBeVisible();
  });

  // P — C8b: the settings glyph is TV's hexagon nut in shell, the house sun on web.
  test("P · the settings glyph is a hexagon in shell and unchanged on web", async ({ page }) => {
    await page.goto(SHELL_URL);
    await chartReady(page);
    // The swap lands on the client mount effect (the marker is read post-hydration so the SSR
    // output stays byte-identical), which resolves after the canvas paints — hence the poll.
    const gearPath = (p: import("@playwright/test").Page) =>
      p.locator(".cfb-gear svg path").first().getAttribute("d");
    await expect.poll(() => gearPath(page), { timeout: 20_000 }).toContain("M8 1.7");
    await expect(page.locator(".cfb-gear svg circle")).toHaveCount(1);
    await page.goto(WEB_URL);
    await chartReady(page);
    // …and the web glyph never changes, before or after hydration.
    expect(await gearPath(page)).toContain("M8 1.5v1.3");
    await page.waitForTimeout(1_000);
    expect(await gearPath(page)).toContain("M8 1.5v1.3");
  });

  // Q — C11: only ?clean=1 changes; the default embed keeps the house v5 look.
  test("Q · clean=1 paints the fill pair, drops gridlines and the last-value badge", async ({ page }) => {
    const opts = async (p: import("@playwright/test").Page) => {
      await expect.poll(async () => await p.evaluate(() => (window as any).__mmEmbedOpts?.() != null), { timeout: 45_000 }).toBe(true);
      return await p.evaluate(() => (window as any).__mmEmbedOpts());
    };
    await page.goto("/embed/chart?symbol=NVDA&clean=1&hdr=0");
    const c = await opts(page);
    expect(String(c.up).toLowerCase()).toBe("#089981");     // fill token, not the #22AB94 text token
    expect(String(c.down).toLowerCase()).toBe("#f23645");
    expect(c.horzLines).toBe(false);
    expect(c.vertLines).toBe(false);
    expect(c.lastValueVisible).toBe(false);
    // Default embed (no flag) is byte-identical to before: house candles, gridlines, badge.
    await page.goto("/embed/chart?symbol=NVDA");
    const d = await opts(page);
    expect(String(d.up).toLowerCase()).toBe("#26c281");
    expect(String(d.down).toLowerCase()).toBe("#f0566b");
    expect(d.horzLines).toBe(true);
    expect(d.vertLines).toBe(true);
    expect(d.lastValueVisible).toBe(true);
  });

  // S — the scope law for this round: none of it reaches the browser web app.
  test("S · every polish-round rule is inert without ?shell=app", async ({ page }) => {
    await page.goto(WEB_URL);
    await chartReady(page);
    await expect(page.locator(".mm-brandbug")).toHaveCount(0);
    await expect
      .poll(async () => (await axisOpts(page)).volumeTop, { timeout: 45_000 })
      .toBeCloseTo(0.78, 3);
    expect((await axisOpts(page)).watermarkVisible).toBe(true);
    // the gradient, the scrub class and the ETH-chip hide are all shell-only.
    expect(await page.locator(".pane").first().evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
    await expect(page.locator(".statusline.is-scrub")).toHaveCount(0);
    // …at every width that still carries the range row (R2c retired it on the phone).
    if ((page.viewportSize()?.width ?? 1440) > 640) {
      await expect(page.locator(".cfb-chip.cfb-chip-adj")).toBeVisible();
    }
    // …and the C7 regular-width ramp never fires off the shell marker, at any viewport.
    await expect.poll(() => statusNameSize(page), { timeout: 45_000 }).toBeLessThan(17);
  });
});
