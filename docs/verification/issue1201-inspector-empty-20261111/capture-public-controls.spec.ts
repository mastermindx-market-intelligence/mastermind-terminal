import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeFlowT } from "@/lib/flowdeskStrings";
import flowFixture from "./fixtures/options-r1-w3a-flow.json";

const phase = process.env.ISSUE1201_N3_PHASE;
if (phase !== "baseline" && phase !== "postimage") throw new Error("An explicit N3 phase is required");
const requestedTheme = process.env.ISSUE1201_N3_THEME;
if (requestedTheme !== "dark" && requestedTheme !== "light") throw new Error("An explicit N3 theme is required");
const out = process.env.ISSUE1201_N3_OUTPUT;
if (!out) throw new Error("An owned N3 output directory is required");
mkdirSync(out, { recursive: true });
const root = path.resolve(__dirname, "../..");
const inputs = [
  "terminal/app/observatory.css", "terminal/app/globals.css",
  "terminal/components/flowdesk/InspectorPane.tsx",
  "terminal/components/flowdesk/FlowDeskView.tsx",
  "terminal/components/flowdesk/FeedPane.tsx",
  "terminal/lib/flowdeskStrings.ts", "terminal/lib/i18n.tsx",
  "terminal/components/chrome/shared-shell/SharedShellPresentation.tsx",
  "terminal/components/chrome/shared-shell/SharedShellPresentationControls.tsx",
  "terminal/lib/sharedShellCopy.ts", "terminal/components/MobileNav.tsx",
  "terminal/e2e/fixtures/options-r1-w3a-flow.json",
];
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const hashes = () => Object.fromEntries(inputs.map(file => [file, digest(readFileSync(path.join(root, file)))]));
test.setTimeout(120_000);
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

async function selectPublicPresentation(page: Page, width: 1440 | 390, lang: "en" | "zh", theme: "dark" | "light") {
  if (theme === "dark") {
    await expect(page.locator("html")).not.toHaveAttribute("data-mmx-shared-shell", "1");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    return;
  }
  await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
  const host = page.locator(width === 390 ? ".mobilebar" : "header.topbar");
  await expect(host).toBeVisible();
  const controls = host.getByRole("group", { name: /^(Appearance and language|外观与语言)$/ });
  await expect(controls).toBeVisible();
  const chinese = controls.getByRole("button", { name: /^(Chinese language|中文界面)$/ });
  const wantsChinese = String(lang === "zh");
  if (await chinese.getAttribute("aria-pressed") !== wantsChinese) await chinese.click();
  await expect(chinese).toHaveAttribute("aria-pressed", wantsChinese);
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  const light = controls.getByRole("button", { name: /^(Light theme|浅色主题)$/ });
  if (await light.getAttribute("aria-pressed") !== "true") await light.click();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
}

for (const width of [1440, 390] as const) {
  test.describe(`N3 width ${width}`, () => {
    test.use({ viewport: { width, height: width === 1440 ? 900 : 844 }, hasTouch: width === 390 });
    for (const theme of ["dark", "light"] as const) for (const lang of ["en", "zh"] as const) {
      if (theme !== requestedTheme) continue;
      if (phase === "baseline" && !(width === 1440 && theme === "light" && lang === "en")) continue;
      test(`${phase}: Inspector empty ${theme}/${lang}/${width}`, async ({ page }, testInfo) => {
        const before = hashes();
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.addInitScript(locale => {
          localStorage.setItem("mm.lang", locale);
          localStorage.setItem("flowdesk.tutorial.seen", "1");
          document.documentElement.setAttribute("data-lang", locale);
        }, lang);
        const feed = (flowFixture as { feed: unknown }).feed;
        await page.route(url => (url.pathname === "/api/flow" || url.pathname === "/api/flow/stream") && url.searchParams.get("f") === "feed", async route => {
          if (new URL(route.request().url()).pathname.endsWith("/stream")) {
            await route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify(feed)}\n\n` });
          } else {
            await route.fulfill({ status: 200, json: feed });
          }
        });
        await page.goto("/options?tab=desk");
        await expect(page.getByTestId("flow-coverage")).toBeVisible({ timeout: 45_000 });
        await selectPublicPresentation(page, width, lang, theme);
        const card = page.locator('[data-tut="flow-inspector"]');
        const empty = card.locator(".obs-insp-empty");
        const title = empty.locator(".obs-insp-empty-title");
        const why = empty.locator(".obs-insp-empty-why");
        const t = makeFlowT(lang);
        await expect(empty).toBeVisible();
        await expect(card).not.toHaveClass(/has-event/);
        await expect(title).toHaveText(t("inspectorEmpty"));
        await expect(why).toHaveText(t("inspectorEmptyWhy"));
        await card.scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const geometry = await card.evaluate(el => {
          const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
          const container = el.querySelector(".obs-insp-empty") as HTMLElement;
          const titleEl = el.querySelector(".obs-insp-empty-title") as HTMLElement;
          const whyEl = el.querySelector(".obs-insp-empty-why") as HTMLElement;
          const rail = el.parentElement!;
          return {
            card: rect(el), rail: rect(rail), title: rect(titleEl), explanation: rect(whyEl),
            flexDirection: getComputedStyle(container).flexDirection,
            titleText: titleEl.textContent, explanationText: whyEl.textContent,
            explanationClientWidth: whyEl.clientWidth, explanationScrollWidth: whyEl.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth,
            theme: document.documentElement.getAttribute("data-theme"), lang: document.documentElement.getAttribute("data-lang"),
            viewport: { width: innerWidth, height: innerHeight },
          };
        });
        expect(geometry.theme).toBe(theme);
        expect(geometry.lang).toBe(lang);
        expect(geometry.card.x).toBeGreaterThanOrEqual(Math.max(0, geometry.rail.x) - 1);
        expect(geometry.card.right).toBeLessThanOrEqual(Math.min(width, geometry.rail.right) + 1);
        expect(geometry.card.y).toBeGreaterThanOrEqual(-1);
        expect(geometry.card.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
        expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.pageClientWidth + 1);
        if (phase === "postimage") {
          expect(geometry.flexDirection).toBe("column");
          expect(geometry.explanation.y).toBeGreaterThanOrEqual(geometry.title.bottom + 7);
          expect(geometry.explanation.width).toBeGreaterThanOrEqual(220);
          expect(geometry.explanationScrollWidth).toBeLessThanOrEqual(geometry.explanationClientWidth + 1);
          expect(geometry.explanation.x).toBeGreaterThanOrEqual(geometry.card.x + 15);
          expect(geometry.explanation.right).toBeLessThanOrEqual(geometry.card.right - 15);
        }
        const filename = `inspector-empty-${theme}-${lang}-${width}.png`;
        const imagePath = path.join(out, filename);
        await card.screenshot({ path: imagePath });
        await testInfo.attach(filename, { path: imagePath, contentType: "image/png" });
        let selectedEventCheck: null | { viewport: number; visible: boolean } = null;
        if (phase === "postimage" && lang === "en" && theme === "dark") {
          await page.locator('[data-tut="flow-card"]', { hasText: "$504.0K" }).click();
          await expect(card).toHaveClass(/has-event/);
          await expect(page.getByTestId("flow-print-inspector")).toBeVisible();
          await expect(empty).toHaveCount(0);
          const selectedWidth = await card.evaluate(el => el.getBoundingClientRect().width);
          expect(selectedWidth).toBeLessThanOrEqual(width);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(1);
          selectedEventCheck = { viewport: width, visible: true };
        }
        expect(errors).toEqual([]);
        const after = hashes();
        expect(after).toEqual(before);
        writeFileSync(path.join(out, filename.replace(/\.png$/, ".json")), JSON.stringify({
          phase, shellVariant: theme === "light" ? "shared-shell" : "default-shell", route: "/options?tab=desk", syntheticFeedFixture: "options-r1-w3a-flow.json",
          viewport: page.viewportSize(), hasTouch: width === 390, theme, lang, geometry,
          selectedEventCheck, pageErrors: errors, sourceHashes: before,
          screenshotSha256: digest(readFileSync(imagePath)),
        }, null, 2) + "\n");
      });
    }
  });
}
