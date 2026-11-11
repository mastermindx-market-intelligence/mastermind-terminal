import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const evidenceDir = process.env.FUTURES_LAB_EVIDENCE_DIR;
async function crop(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, name + ".png"), fullPage: true });
}
async function noOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
}
async function setReplay(page: Page, position: number) {
  const slider = page.locator("#futures-replay");
  await slider.focus();
  await slider.press("Home");
  for (let n = 0; n < position; n++) await slider.press("ArrowRight");
  await expect(slider).toHaveValue(String(position));
}

test("synthetic depth and footprint share gamma, method and replay without overflow", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/dev/futures");
  const lab = page.getByTestId("futures-lab");
  await expect(lab).toBeVisible();
  await expect(lab).toContainText("SYNTHETIC DATA");
  await expect(lab).toContainText("not live CME data");
  await expect(page.getByTestId("futures-volume")).toHaveText("4,203");
  await expect(page.getByTestId("futures-cvd")).toHaveAttribute("data-cvd", "1027");
  await expect(page.getByTestId("mapped-level")).toHaveCount(3);
  const depthLevels = await page.getByTestId("mapped-level").allTextContents();
  await noOverflow(page);
  await crop(page, `${info.project.name}-depth-en`);
  await page.getByRole("tab", { name: "Footprint", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Footprint", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await page.getByTestId("mapped-level").allTextContents()).toEqual(depthLevels);
  await expect(page.getByTestId("futures-volume-profile")).toBeVisible();
  await crop(page, `${info.project.name}-footprint-en`);
  await page.getByLabel("Mapping", { exact: true }).selectOption("basis");
  const offsetLevels = await page.getByTestId("mapped-level").allTextContents();
  expect(offsetLevels).not.toEqual(depthLevels);
  await page.getByRole("tab", { name: "Depth", exact: true }).click();
  expect(await page.getByTestId("mapped-level").allTextContents()).toEqual(offsetLevels);
  await setReplay(page, 5);
  await expect(page.getByTestId("futures-volume")).not.toHaveText("4,203");
  await expect(page.getByTestId("gex-bubble")).toHaveCount(18);
  const cumulative = await page.getByTestId("futures-cvd").getAttribute("data-cvd");
  expect(cumulative).not.toBe("1027");
  await page.getByRole("checkbox", { name: "Show cumulative delta" }).uncheck();
  await expect(page.getByTestId("futures-cvd")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show cumulative delta" }).check();
  await expect(page.getByTestId("futures-cvd")).toHaveAttribute("data-cvd", cumulative!);
  await page.getByRole("checkbox", { name: "Show GEX" }).uncheck();
  await expect(page.getByTestId("gex-bubble")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show GEX" }).check();
  await expect(page.getByTestId("gex-bubble")).toHaveCount(18);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("source unavailability and depth gaps cannot masquerade as healthy current data", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/dev/futures");
  const scenarios = page.getByLabel("Test scenario", { exact: true });
  await scenarios.selectOption("stale");
  await expect(page.getByTestId("gex-unavailable")).toContainText("stale_quote");
  await expect(page.getByTestId("mapped-level")).toHaveCount(0);
  await crop(page, `${info.project.name}-stale-gamma-en`);
  await scenarios.selectOption("late");
  await expect(page.getByTestId("gex-unavailable")).toContainText("not_yet_available");
  await scenarios.selectOption("gap");
  await expect(page.getByTestId("mapped-level")).toHaveCount(3);
  await expect(page.getByTestId("depth-gap")).toHaveCount(2);
  await crop(page, `${info.project.name}-depth-gap-en`);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("Chinese labels and touch-sized controls preserve the same development surface", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/dev/futures");
  await page.getByRole("button", { name: "Language", exact: true }).click();
  const lab = page.getByTestId("futures-lab");
  await expect(lab).toHaveAttribute("lang", "zh");
  await expect(lab).toContainText("合成数据");
  await expect(lab).not.toContainText("RESEARCH LAB");
  await crop(page, `${info.project.name}-depth-zh`);
  await page.getByRole("tab", { name: "足迹", exact: true }).click();
  await crop(page, `${info.project.name}-footprint-zh`);
  await noOverflow(page);
  const smallControls = await lab.locator("button, select, input[type=range]").evaluateAll(elements =>
    elements.map(el => ({ tag: el.tagName, height: el.getBoundingClientRect().height }))
      .filter(item => item.height < 43));
  expect(smallControls).toEqual([]);
  expect(errors).toEqual([]);
});

test("NQ switches both source and chart, expiry lenses conserve exposure, aggregation conserves volume", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/dev/futures");
  const esLevels = await page.getByTestId("mapped-level").allTextContents();
  await page.getByLabel("Instrument", { exact: true }).selectOption("NQ");
  await expect(page.getByTestId("futures-instrument")).toContainText("NQZ6 · NDX");
  await expect(page.getByTestId("futures-chart")).toHaveAttribute("data-contract", "NQZ6");
  await expect(page.getByTestId("futures-source-reference")).toContainText("synthetic:NQ:");
  await expect(page.getByTestId("futures-volume")).toHaveText("4,202");
  const nqLevels = await page.getByTestId("mapped-level").allTextContents();
  expect(nqLevels).not.toEqual(esLevels);
  expect(nqLevels.every(value => Number(value) > 25000)).toBe(true);
  const all = (await page.getByTestId("mapped-exposure").allTextContents()).map(Number);
  await crop(page, `${info.project.name}-nq-depth-all-en`);
  await page.getByLabel("Expiry lens", { exact: true }).selectOption("zero");
  await expect(page.getByTestId("futures-expiry-basis")).toContainText("2026-10-09");
  await expect(page.getByTestId("futures-source-reference")).toContainText("synthetic:NQ:matrix:");
  const zero = (await page.getByTestId("mapped-exposure").allTextContents()).map(Number);
  expect(await page.getByTestId("mapped-level").allTextContents()).toEqual(nqLevels);
  await page.getByLabel("Expiry lens", { exact: true }).selectOption("ex-zero");
  const later = (await page.getByTestId("mapped-exposure").allTextContents()).map(Number);
  all.forEach((value, i) => expect(zero[i] + later[i]).toBeCloseTo(value, 5));
  await page.getByLabel("Expiry lens", { exact: true }).selectOption("one");
  expect((await page.getByTestId("mapped-exposure").allTextContents()).map(Number)).toEqual(later);
  await page.getByLabel("Interval", { exact: true }).selectOption("5");
  await page.getByLabel("Price rows", { exact: true }).selectOption("4");
  await expect(page.getByTestId("futures-volume")).toHaveText("4,202");
  await page.getByRole("tab", { name: "Footprint", exact: true }).click();
  await expect(page.getByTestId("footprint-cell")).not.toHaveCount(0);
  await crop(page, `${info.project.name}-nq-footprint-later-5min-en`);
  await page.getByLabel("Test scenario", { exact: true }).selectOption("matrix-late");
  await expect(page.getByTestId("gex-unavailable")).toContainText("matrix_clock");
  await expect(page.getByTestId("mapped-level")).toHaveCount(0);
  await expect(page.getByTestId("futures-volume")).toHaveText("4,202");
  await page.getByLabel("Test scenario", { exact: true }).selectOption("normal");
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await crop(page, `${info.project.name}-nq-footprint-later-5min-zh`);
  await page.getByLabel("Instrument", { exact: true }).selectOption("ES");
  await expect(page.getByTestId("futures-chart")).toHaveAttribute("data-contract", "ESZ6");
  await expect(page.getByTestId("futures-source-reference")).toContainText("synthetic:ES:");
  await expect(page.getByTestId("futures-volume")).toHaveText("4,203");
  await noOverflow(page); expect(errors).toEqual([]);
});

test("changing aggregation never paints a future interval beyond the replay cutoff", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/dev/futures");
  await setReplay(page, 0);
  await expect(page.getByTestId("gex-bubble")).toHaveCount(3);
  await page.getByLabel("Interval", { exact: true }).selectOption("5");
  await expect(page.locator("#futures-replay")).toHaveValue("0");
  await expect(page.getByTestId("gex-bubble")).toHaveCount(0);
  await expect(page.getByTestId("futures-volume")).toHaveText("0");
  await expect(page.getByRole("status").filter({ hasText: "No completed intervals" })).toBeVisible();
  await setReplay(page, 5);
  await expect(page.getByTestId("futures-plotted-through")).toContainText("14:05");
  await expect(page.getByTestId("futures-bar")).toHaveCount(1);
  await expect(page.getByTestId("gex-bubble")).toHaveCount(3);
  await noOverflow(page); expect(errors).toEqual([]);
});
