import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Requires an independently prepared local public-sample prefix. Never downloads
// market data in CI or commits actual-price images to the public repository.
test.skip(process.env.RUN_FUTURES_PUBLIC_SAMPLE !== "1", "Local historical source canary only");
const evidence = path.resolve(__dirname, "../../.local-futures/browser-evidence");
async function capture(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, name + ".png"), fullPage: true });
}
async function noOverflow(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("actual historical executions and event-integrated depth render without generated gamma", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/dev/futures-sample");
  await expect(page.getByTestId("futures-public-sample")).toBeVisible();
  await expect(page.getByTestId("sample-volume")).toHaveText("839");
  await expect(page.getByTestId("sample-comparison")).toContainText("4,471 / 4,471");
  await expect(page.getByTestId("sample-gex-unavailable")).toContainText("no contemporaneous SPX");
  await expect(page.getByTestId("gex-bubble")).toHaveCount(0);
  await expect(page.getByTestId("futures-bar")).toHaveCount(5);
  await expect(page.getByTestId("depth-gap")).toHaveCount(0);
  await capture(page, `${info.project.name}-historical-depth-en`);
  await page.getByRole("tab", { name: "Footprint", exact: true }).click();
  await expect(page.getByTestId("footprint-cell")).not.toHaveCount(0);
  await expect(page.getByTestId("futures-volume-profile")).toHaveCount(1);
  await capture(page, `${info.project.name}-historical-footprint-en`);
  const slider = page.locator("#futures-sample-replay");
  await slider.focus(); await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await expect(page.getByTestId("sample-volume")).toHaveText("165");
  await expect(page.getByTestId("futures-bar")).toHaveCount(1);
  await slider.press("End");
  await expect(page.getByTestId("sample-volume")).toHaveText("839");
  await noOverflow(page); expect(errors).toEqual([]);
});

test("historical-source labels translations and CVD controls remain explicit", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/dev/futures-sample");
  await expect(page.getByTestId("futures-cvd")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Show cumulative delta" }).uncheck();
  await expect(page.getByTestId("futures-cvd")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show cumulative delta" }).check();
  await page.getByRole("button", { name: "Price zoom 1×" }).click();
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(page.getByRole("heading", { name: "真实来源期货验证" })).toBeVisible();
  await expect(page.getByTestId("sample-gex-unavailable")).toContainText("GEX 不可用");
  await page.getByRole("tab", { name: "足迹", exact: true }).click();
  await capture(page, `${info.project.name}-historical-footprint-zh`);
  await noOverflow(page); expect(errors).toEqual([]);
});
