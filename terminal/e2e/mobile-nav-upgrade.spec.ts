import { expect, test, type Page, type TestInfo } from "@playwright/test";

const READY_FLAG = "__mmNavUpgradeReady";
const MOBILE_PROJECTS = new Set(["tablet", "mobile"]);
const MENU = '.mobilebar button[aria-label="Menu"]';

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(20_000);
  await page.addInitScript((readyFlag) => {
    const win = window as Window & { __mmNavUpgradeReady?: boolean };
    win[readyFlag as "__mmNavUpgradeReady"] = false;
    window.addEventListener("mm:terminal-visual-ready", () => { win[readyFlag as "__mmNavUpgradeReady"] = true; }, { once: true });
  }, READY_FLAG);
});

function mobileOnly(testInfo: TestInfo) {
  test.skip(!MOBILE_PROJECTS.has(testInfo.project.name), "Mobile drawer contract.");
}

function phoneOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "mobile", "One self-sized phone proof is sufficient.");
}

async function gotoTerminal(page: Page, expectMobile = true) {
  await page.goto("/terminal?symbol=NVDA");
  await expect.poll(
    () => page.evaluate((readyFlag) => Boolean(
      (window as Window & { __mmNavUpgradeReady?: boolean })[readyFlag as "__mmNavUpgradeReady"],
    ), READY_FLAG),
    { message: "Terminal visual-ready event", timeout: 20_000 },
  ).toBe(true);
  const menu = page.locator(MENU);
  if (expectMobile) await expect(menu).toBeVisible();
  return menu;
}

async function openDrawer(page: Page) {
  const menu = page.locator(MENU);
  await menu.click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  return { menu, dialog };
}

async function ensureScrollableAt(page: Page, y = 320) {
  return page.evaluate((top) => {
    let spacer = document.querySelector<HTMLElement>("#mm-nav-scroll-spacer");
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.id = "mm-nav-scroll-spacer";
      spacer.style.cssText = "position:absolute;top:180vh;left:0;width:1px;height:80vh;pointer-events:none";
      document.body.appendChild(spacer);
    }
    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.scrollBehavior = "auto";
    window.scrollTo(0, top);
    return window.scrollY;
  }, y);
}

async function swipe(page: Page, x: number, fromY: number, toY: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: fromY }] });
  for (let i = 1; i <= 8; i++) {
    const y = fromY + ((toY - fromY) * i) / 8;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(25); // Real gesture cadence, not a readiness delay.
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function pointMisses(page: Page, selector: string) {
  return page.locator(selector).evaluate((target, offsets) => {
    const rect = target.getBoundingClientRect();
    const misses: number[][] = [];
    for (const dx of offsets) for (const dy of offsets) {
      const hit = document.elementFromPoint(rect.x + rect.width / 2 + dx, rect.y + rect.height / 2 + dy);
      if (hit?.closest("button") !== target) misses.push([dx, dy]);
    }
    return misses;
  }, [-21.5, 0, 21.5]);
}

test("MM-001 closed drawer has no focus stops; open drawer focuses nav and wraps both ways", async ({ page }, testInfo) => {
  mobileOnly(testInfo);
  const menu = await gotoTerminal(page);
  const controls = await menu.getAttribute("aria-controls");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(controls).toBeTruthy();
  expect(await page.locator(".m-drawer").count()).toBe(0);

  const pageStops = await page.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])').evaluateAll((nodes) => nodes.filter((node) => {
    const el = node as HTMLElement;
    const style = getComputedStyle(el);
    return el.tabIndex >= 0 && !el.closest("[hidden], [inert], [aria-hidden='true']")
      && style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
  }).length);
  expect(pageStops).toBeGreaterThan(2);
  for (const key of ["Tab", "Shift+Tab"]) {
    await menu.focus();
    let returnedToMenu = false;
    for (let i = 0; i < pageStops * 2 + 10; i++) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".m-drawer")))).toBe(false);
      if (await menu.evaluate((button) => button === document.activeElement)) {
        returnedToMenu = true;
        break;
      }
    }
    expect(returnedToMenu, `${key} completes a closed-page focus cycle`).toBe(true);
  }

  await menu.click();
  const dialog = page.locator(`dialog[id="${controls}"]`);
  await expect(dialog).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.locator(".m-nav a[href]").first()).toBeFocused();

  const tabbables = dialog.locator('.m-drawer a[href], .m-drawer button:not([disabled]), .m-drawer [tabindex]:not([tabindex="-1"])');
  const count = await tabbables.evaluateAll((nodes) => nodes.filter((node) => {
    const el = node as HTMLElement;
    const style = getComputedStyle(el);
    return el.tabIndex >= 0 && !el.closest("[hidden], [inert], [aria-hidden='true']")
      && style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
  }).length);
  expect(count).toBeGreaterThan(2);

  for (const key of ["Tab", "Shift+Tab"]) {
    await dialog.locator(".m-nav a[href]").first().focus();
    for (let i = 0; i < count + 1; i++) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".m-drawer")))).toBe(true);
    }
  }

  const close = dialog.locator('button[aria-label="Close"], button[aria-label="关闭"]').first();
  const last = tabbables.last();
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("mm001-focus-trap.png") });
});

test("MM-002 Escape and scrim tap dismiss and restore the actual Menu opener", async ({ page }, testInfo) => {
  mobileOnly(testInfo);
  const menu = await gotoTerminal(page);
  const { dialog } = await openDrawer(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();

  await menu.click();
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  await page.touchscreen.tap(viewport.width - 8, viewport.height / 2);
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
});

test("MM-003 real scrim swipe freezes nonzero scroll and dismissal restores exact inline styles", async ({ page }, testInfo) => {
  mobileOnly(testInfo);
  const menu = await gotoTerminal(page);
  expect(await ensureScrollableAt(page)).toBeGreaterThan(0);
  const before = await page.evaluate(() => {
    const html = document.documentElement;
    html.style.overflow = "auto";
    document.body.style.overflow = "visible";
    html.style.scrollBehavior = "smooth";
    document.body.style.scrollBehavior = "auto";
    return {
      x: window.scrollX, y: window.scrollY,
      htmlOverflow: html.style.overflow, bodyOverflow: document.body.style.overflow,
      htmlBehavior: html.style.scrollBehavior, bodyBehavior: document.body.style.scrollBehavior,
    };
  });

  await page.locator('.mobilebar button[aria-label="Mastermind AI"]').evaluate((button) => {
    (button as HTMLElement).focus({ preventScroll: true });
  });
  await menu.evaluate((button) => (button as HTMLButtonElement).click());
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow])).toEqual(["hidden", "hidden"]);
  expect(await page.evaluate(() => window.scrollY)).toBe(before.y);

  const viewport = page.viewportSize()!;
  await swipe(page, viewport.width - 18, Math.min(620, viewport.height - 80), 280);
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(before.y);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => {
    const html = document.documentElement;
    return {
      x: window.scrollX, y: window.scrollY,
      htmlOverflow: html.style.overflow, bodyOverflow: document.body.style.overflow,
      htmlBehavior: html.style.scrollBehavior, bodyBehavior: document.body.style.scrollBehavior,
    };
  })).toEqual(before);
  await expect(menu).toBeFocused();
});

test("MM-004 header and drawer account targets cover their complete centered 44px squares", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await gotoTerminal(page);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const selector of [MENU, '.mobilebar button[aria-label="Mastermind AI"]', ".mobilebar button.avatar"]) {
      expect(await pointMisses(page, selector), `${selector} at ${width}px`).toEqual([]);
    }
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
      };
      const avatar = document.querySelector<HTMLElement>(".mobilebar button.avatar")!;
      const pseudo = getComputedStyle(avatar, "::after");
      return {
        menu: rect('.mobilebar button[aria-label="Menu"]'),
        ai: rect('.mobilebar button[aria-label="Mastermind AI"]'),
        account: rect(".mobilebar span:has(> button.avatar)"),
        avatar: rect(".mobilebar button.avatar"), brand: rect(".mobilebar .m-brand"),
        pseudo: { width: pseudo.width, height: pseudo.height },
      };
    });
    expect([geometry.menu.w, geometry.menu.h, geometry.ai.w, geometry.ai.h, geometry.account.w, geometry.account.h]).toEqual([44, 44, 44, 44, 44, 44]);
    expect([geometry.avatar.w, geometry.avatar.h]).toEqual([30, 30]);
    expect(geometry.pseudo).toEqual({ width: "44px", height: "44px" });
    for (const target of [geometry.menu, geometry.ai, geometry.account]) {
      const overlapX = Math.min(target.r, geometry.brand.r) - Math.max(target.l, geometry.brand.l);
      const overlapY = Math.min(target.b, geometry.brand.b) - Math.max(target.t, geometry.brand.t);
      expect(overlapX > 0 && overlapY > 0, `brand overlap at ${width}px`).toBe(false);
    }
  }
  await page.setViewportSize({ width: 320, height: 844 });
  const { dialog } = await openDrawer(page);
  expect(await pointMisses(page, ".m-drawer-ft button.avatar")).toEqual([]);
  const close = dialog.locator("button").first();
  await expect(close).toHaveCSS("width", "44px");
  await expect(close).toHaveCSS("height", "44px");
  expect(await pointMisses(page, "dialog[open] .m-drawer > button")).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("mm004-320-targets.png") });
});

test("crossing above 860px releases once, restores styles, and permits a clean reopen", async ({ page }, testInfo) => {
  mobileOnly(testInfo);
  await gotoTerminal(page);
  await page.setViewportSize({ width: 820, height: 900 });
  const menu = page.locator(MENU);
  const controls = await menu.getAttribute("aria-controls");
  await openDrawer(page);
  await page.setViewportSize({ width: 861, height: 900 });
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow])).toEqual(["", ""]);

  await page.setViewportSize({ width: 820, height: 900 });
  await menu.click();
  await expect(page.locator(`dialog[id="${controls}"][open]`)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("short viewport keeps header and footer fixed while only the nav scrolls", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await gotoTerminal(page);
  await page.setViewportSize({ width: 390, height: 360 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDrawer(page);
  await expect(page.locator(".m-drawer")).toHaveCSS("transition-duration", "0s");
  const before = await page.evaluate(() => {
    const pos = (selector: string) => {
      const r = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const modal = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    const drawer = document.querySelector<HTMLElement>(".m-drawer")!;
    const nav = document.querySelector<HTMLElement>(".m-nav")!;
    return {
      modal: { w: modal.getBoundingClientRect().width, h: modal.getBoundingClientRect().height },
      drawerOverflow: getComputedStyle(drawer).overflow,
      nav: { scroll: nav.scrollHeight, client: nav.clientHeight, touch: getComputedStyle(nav).touchAction },
      header: pos(".m-drawer-h"), footer: pos(".m-drawer-ft"), pageY: window.scrollY,
    };
  });
  expect(before.modal).toEqual({ w: 390, h: 360 });
  expect(before.drawerOverflow).toBe("hidden");
  expect(before.nav.scroll).toBeGreaterThan(before.nav.client);
  expect(before.nav.touch).toBe("pan-y");
  const navBox = (await page.locator(".m-nav").boundingBox())!;
  await swipe(page, navBox.x + navBox.width / 2, navBox.y + navBox.height - 15, navBox.y + 15);
  await expect.poll(() => page.locator(".m-nav").evaluate((nav) => nav.scrollTop)).toBeGreaterThan(0);
  const lastItem = page.locator(".m-nav > button").last();
  await lastItem.scrollIntoViewIfNeeded();
  expect(await lastItem.evaluate((item) => {
    const rect = item.getBoundingClientRect();
    return item.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  const after = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".m-nav")!;
    const pos = (selector: string) => {
      const r = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    return { scrollTop: nav.scrollTop, header: pos(".m-drawer-h"), footer: pos(".m-drawer-ft"), pageY: window.scrollY };
  });
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.header).toEqual(before.header);
  expect(after.footer).toEqual(before.footer);
  expect(after.pageY).toBe(before.pageY);
  const overlapsBrand = await page.locator("dialog[open] button").first().evaluate((button) => {
    const a = button.getBoundingClientRect();
    const brand = document.querySelector<HTMLElement>(".m-drawer-h")!.firstElementChild!.getBoundingClientRect();
    return Math.min(a.right, brand.right) > Math.max(a.left, brand.left)
      && Math.min(a.bottom, brand.bottom) > Math.max(a.top, brand.top);
  });
  expect(overlapsBrand).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("short-drawer.png") });
});

test("signed-in drawer account hands focus to Settings without late Menu refocus", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await gotoTerminal(page);
  await openDrawer(page);
  await page.locator(".m-drawer-ft button.avatar").click();
  const settings = page.locator('.acs-card[role="dialog"]');
  await expect(settings).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow])).toEqual(["", ""]);
  await expect.poll(() => settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await expect(page.locator(MENU)).not.toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("settings-handoff.png") });
});

test("guest drawer account hands focus to onboarding without late Menu refocus", async ({ page, baseURL }, testInfo) => {
  phoneOnly(testInfo);
  await page.context().addCookies([{ name: "mm_e2e_guest", value: "1", url: baseURL! }]);
  await gotoTerminal(page);
  await openDrawer(page);
  await page.locator(".m-drawer-ft button.avatar").click();
  const onboarding = page.locator('.ob-sheet[role="dialog"]');
  await expect(onboarding).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow])).toEqual(["", ""]);
  await expect.poll(() => onboarding.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await expect(page.locator(MENU)).not.toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("onboarding-handoff.png") });
});

test("Analysis navigation carries NVDA and does not steal destination focus", async ({ page }, testInfo) => {
  mobileOnly(testInfo);
  await gotoTerminal(page);
  const { dialog } = await openDrawer(page);
  const analysis = dialog.locator('a[href="/analysis?symbol=NVDA"]');
  await expect(analysis).toBeVisible();
  await analysis.click();
  await page.waitForURL(/\/analysis\?symbol=NVDA$/);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const destinationMenu = page.locator(MENU);
  await expect(destinationMenu).toBeVisible();
  await expect(destinationMenu).not.toBeFocused();
  await destinationMenu.click();
  await expect(page.locator('.m-nav a[aria-current="page"]')).toHaveAttribute("href", "/analysis");
  await page.screenshot({ path: testInfo.outputPath("analysis-nvda.png") });
});

test("shared non-chart shell uses the same modal and marks its active route", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await page.goto("/discover");
  await expect(page.locator(MENU)).toBeVisible();
  const { dialog } = await openDrawer(page);
  await expect(dialog.locator('.m-nav a[aria-current="page"]')).toHaveAttribute("href", "/discover");
  await page.keyboard.press("Escape");
  await expect(page.locator(MENU)).toBeFocused();

  await page.locator(".mobilebar button.avatar").click();
  const accountDialog = page.locator('.acs-card[role="dialog"], .ob-sheet[role="dialog"]');
  await expect(accountDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(accountDialog).toBeHidden();

  await page.locator('.mobilebar button[aria-label="Mastermind AI"]').click();
  await page.waitForURL(/\/terminal\?ai=1$/);
});

test("from-Macro header remains non-overlapping and actionable at 320px", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/terminal?symbol=NVDA&from=macro");
  await expect.poll(
    () => page.evaluate((readyFlag) => Boolean((window as Window & { __mmNavUpgradeReady?: boolean })[readyFlag as "__mmNavUpgradeReady"]), READY_FLAG),
    { timeout: 20_000 },
  ).toBe(true);
  await expect(page.locator(".mobilebar.from-macro .m-back-prom")).toBeVisible();
  await expect(page.locator(".mobilebar .m-brand")).toBeHidden();
  for (const selector of [MENU, '.mobilebar button[aria-label="Mastermind AI"]', ".mobilebar button.avatar"]) {
    expect(await pointMisses(page, selector), selector).toEqual([]);
  }
  const overlaps = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(
      '.mobilebar .m-back-prom, .mobilebar button[aria-label="Menu"], .mobilebar button[aria-label="Mastermind AI"], .mobilebar span:has(> button.avatar)',
    ));
    const rects = elements.map((element) => ({ label: element.getAttribute("aria-label") || "Back", rect: element.getBoundingClientRect() }));
    const collisions: string[] = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (x > 0 && y > 0) collisions.push(`${a.label}/${b.label}`);
    }
    return collisions;
  });
  expect(overlaps).toEqual([]);
  await page.locator(MENU).click();
  await expect(page.locator("dialog[open]")).toBeVisible();
});

test("drawer labels and modal controls render in EN and ZH", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await gotoTerminal(page);
  let opened = await openDrawer(page);
  await expect(opened.dialog).toHaveAttribute("aria-label", "Workspaces");
  await expect(opened.dialog.locator('a[href^="/analysis"]')).toContainText("Analysis");
  await expect(opened.dialog.locator('button[aria-label="Close"]')).toBeVisible();
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    localStorage.setItem("mm.lang", "zh");
    document.documentElement.lang = "zh-CN";
  });
  await page.reload();
  await expect.poll(
    () => page.evaluate((readyFlag) => Boolean((window as Window & { __mmNavUpgradeReady?: boolean })[readyFlag as "__mmNavUpgradeReady"]), READY_FLAG),
    { timeout: 20_000 },
  ).toBe(true);
  opened = await openDrawer(page);
  await expect(opened.dialog).toHaveAttribute("aria-label", "工作区");
  await expect(opened.dialog.locator('a[href^="/analysis"]')).toContainText("分析");
  await expect(opened.dialog.locator('button[aria-label="关闭"]')).toBeVisible();
});

test("desktop keeps the mobile header hidden and never mounts the drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only assertion.");
  await gotoTerminal(page, false);
  await expect(page.locator(".mobilebar")).toBeHidden();
  await expect(page.locator(".m-drawer, dialog[open]")).toHaveCount(0);
});
