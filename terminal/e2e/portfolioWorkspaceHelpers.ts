import { expect, type Page } from "@playwright/test";

/** The real workspace paths used by both legacy acceptance and new design tests. */
export async function holdings(page: Page, status: "open" | "closed" = "open") {
  await page.locator("#portfolio-tab-holdings").click();
  const panel = page.locator("#portfolio-panel-holdings");
  await panel.getByRole("group").getByRole("button").nth(status === "open" ? 0 : 1).click();
}
export async function inspectRecord(page: Page, ticker: string, status: "open" | "closed" = "open") {
  await holdings(page, status);
  await page.getByTestId(status === "open" ? "portfolio-open" : "portfolio-closed")
    .locator(`tr[data-ticker='${ticker}']`).first().getByRole("button").click();
  return page.getByRole("dialog").filter({ has: page.locator("#portfolio-record-title") });
}
export async function editRecord(page: Page, ticker: string, status: "open" | "closed" = "open") {
  const inspector = await inspectRecord(page, ticker, status);
  await inspector.getByRole("button", { name: new RegExp(`^(Edit|编辑) ${ticker}$`) }).click();
  return editor(page);
}
export function editor(page: Page) {
  return page.getByRole("dialog").filter({ has: page.locator("input[name='ticker']") });
}
export async function closeInspector(page: Page) {
  const inspector = page.getByRole("dialog").filter({ has: page.locator("#portfolio-record-title") });
  if (await inspector.isVisible()) {
    await inspector.getByRole("button", { name: /^(Close details|关闭详情)$/ }).click();
  }
}
export async function discardEditor(page: Page) {
  const modal = editor(page);
  await modal.getByRole("button", { name: /^(Cancel|取消)$/ }).first().click();
  const discard = modal.getByRole("button", { name: /^(Discard changes|放弃更改)$/ });
  if (await discard.isVisible()) await discard.click();
  await expect(modal).not.toBeVisible();
}
export async function coverage(page: Page) {
  await page.locator("#portfolio-tab-overview").click();
  const details = page.getByTestId("portfolio-currency-coverage");
  if (!(await details.getAttribute("open"))) {
    if (!(await details.evaluate(el => (el as HTMLDetailsElement).open))) await details.locator("summary").click();
  }
  return details;
}
