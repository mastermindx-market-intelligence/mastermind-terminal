/** Consumer-path proof with synthetic producer-shaped receipts; no private delivery claim. */
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import receipts from "../test-fixtures/prophet_intake_receipts_fixture.json";

async function openReceipts(page: Page, lang: "en" | "zh", intake: unknown) {
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "test-fixtures", "prophet_stale_frame_fixture.json"), "utf8"));
  await page.route(
    url => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
    route => route.fulfill({ json: {
      ...fixture, asof: "2026-10-23", source_asof: "2026-10-20",
      source_delayed: true, source_mixed_vintage: true, intake,
    } }),
  );
  await page.goto("/options?tab=prophet");
  await expect(page.locator(".obs-prophet-signal").first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate((value) => {
    localStorage.setItem("mm.lang", value);
    document.documentElement.setAttribute("data-lang", value);
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, lang);
}

for (const lang of ["en", "zh"] as const) {
  test(`screening receipts stay collapsed, truthful, bilingual and contained (${lang})`, async ({ page }, testInfo) => {
    await openReceipts(page, lang, { receipts });
    const shelf = page.locator(".obs-prophet-intake-receipts");
    const summary = shelf.locator("summary");
    const title = lang === "en" ? "Not selected in this snapshot" : "本次快照未纳入";
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(title);
    await expect(summary).toContainText(lang === "en" ? "19 of 30" : "19 / 30 只");
    await expect(shelf).not.toHaveAttribute("open", "");
    await expect(shelf.locator(".obs-prophet-intake-body")).not.toBeVisible();
    const selection = await page.locator(".obs-prophet-signal.sel").textContent();
    const summaryBox = await summary.boundingBox();
    expect(summaryBox?.height).toBeGreaterThanOrEqual(44);
    if (lang === "en") {
      await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-receipts-collapsed.png`), fullPage: false });
    }

    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(shelf).toHaveAttribute("open", "");
    await expect(shelf.locator(".obs-prophet-intake-body")).toBeVisible();
    await expect(shelf).toContainText(receipts.groups[0][lang]);
    await expect(shelf).not.toContainText(receipts.groups[0][lang === "en" ? "zh" : "en"]);
    await expect(shelf).toContainText(lang === "en" ? "14 of 17 names shown" : "显示 17 只中的 14 只");
    await expect(shelf).toContainText(lang === "en" ? "3 more already have a plan running" : "另有 3 只已有在跑的计划");
    await expect(page.locator(".obs-prophet-signal.sel")).toHaveText(selection ?? "");
    expect(await shelf.locator(".obs-prophet-intake-names b").allTextContents())
      .toEqual(receipts.groups.slice(0, 2).flatMap(group => group.names.map(name => name.ticker)));
    await expect(shelf).not.toContainText("plan_not_built");
    await expect(shelf).not.toContainText("validation_failed");
    await expect(shelf).not.toContainText("already_open");
    await expect(shelf).not.toContainText("tonight");

    const vintage = page.getByTestId("prophet-source-vintage");
    await expect(vintage).toContainText("20");
    await expect(vintage).toContainText(lang === "en" ? "Delayed" : "数据延迟");
    await expect(vintage).toContainText(lang === "en" ? "Mixed vintages" : "数据时点不一致");
    const contained = await shelf.evaluate(node => ({
      shelf: node.scrollWidth <= node.clientWidth + 1,
      pane: node.parentElement!.scrollWidth <= node.parentElement!.clientWidth + 1,
      textSizes: [...node.querySelectorAll("p, b, summary")].map(item => Number.parseFloat(getComputedStyle(item).fontSize)),
    }));
    expect(contained.shelf).toBe(true);
    expect(contained.pane).toBe(true);
    expect(Math.min(...contained.textSizes)).toBeGreaterThanOrEqual(12);
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-receipts-open-${lang}.png`), fullPage: false });
    const footer = shelf.locator(".obs-prophet-intake-body > .obs-prophet-intake-context").last();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-receipts-footer-${lang}.png`), fullPage: false });

    const other = lang === "en" ? "zh" : "en";
    await page.evaluate((value) => {
      localStorage.setItem("mm.lang", value);
      document.documentElement.setAttribute("data-lang", value);
      window.dispatchEvent(new CustomEvent("mm:lang"));
    }, other);
    await expect(shelf).toHaveAttribute("open", "");
    await expect(shelf).toContainText(receipts.groups[0][other]);
    await expect(shelf).not.toContainText(receipts.groups[0][lang]);

    const left = page.locator(".obs-prophet-left");
    await left.getByRole("button", { name: other === "en" ? "PERF" : "绩效", exact: true }).click();
    await expect(shelf).toHaveCount(0);
    await left.getByRole("button", { name: other === "en" ? "Signals" : "信号", exact: true }).click();
    await expect(shelf).toHaveCount(1);
    await expect(shelf).not.toHaveAttribute("open", "");
    await shelf.locator("summary").focus();
    await page.keyboard.press("Space");
    await expect(shelf).toHaveAttribute("open", "");
  });
}

test("missing and inconsistent receipts stay absent while the incumbent desk remains usable", async ({ page }) => {
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "test-fixtures", "prophet_stale_frame_fixture.json"), "utf8"));
  let intake: unknown = undefined;
  await page.route(
    url => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
    route => route.fulfill({ json: { ...fixture, intake } }),
  );
  for (const value of [undefined, null, { receipts: { ...receipts, declined: 18 } }]) {
    intake = value;
    await page.goto("/options?tab=prophet");
    await expect(page.locator(".obs-prophet-signal")).toHaveCount(2);
    await expect(page.locator(".obs-prophet-intake-receipts")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Macro Plans/ })).toHaveAttribute("aria-selected", "true");
    await page.reload();
  }
});
