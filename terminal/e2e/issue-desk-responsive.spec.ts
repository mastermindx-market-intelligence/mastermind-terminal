import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./fixtures";

const issueFixture = async () => JSON.parse(await readFile(path.join(process.cwd(), "test-fixtures/options_issue_desk_fixture.json"), "utf8"));

test("Issue Desk remains an explicit, responsive private operator lane", async ({ page }, testInfo) => {
  const fixture = await issueFixture();
  await page.route("**/api/options/issue-desk", async (route) => route.fulfill({ json: fixture, headers: { "Cache-Control": "private, no-store" } }));
  await page.goto("/options?tab=prophet");
  await page.getByRole("tab", { name: "Issue Desk" }).click();
  const desk = page.getByTestId("issue-desk");
  await expect(desk).toBeVisible();
  await expect(desk).toContainText("Proposals are not signals");
  await expect(desk).toContainText("not a brokerage trade");
  await expect(page.getByTestId("issue-desk-proposal")).toHaveCount(1);
  const bounds = await desk.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-issue-desk.png`), fullPage: false });
  await page.getByRole("button", { name: "Approve & issue research plan" }).click();
  const editor = page.getByTestId("issue-desk-approval-editor");
  await expect(editor).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Confirm review action" });
  const dialogBounds = await dialog.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
  expect(dialogBounds.scrollWidth).toBeLessThanOrEqual(dialogBounds.clientWidth + 1);
  await expect(page.getByRole("button", { name: "Confirm issue" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-issue-desk-editor.png`), fullPage: false });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.evaluate(() => { document.documentElement.setAttribute("data-lang", "zh"); window.dispatchEvent(new CustomEvent("mm:lang")); });
  await expect(desk).toContainText("待审核 · 非信号");
  await expect(desk).toContainText("仅研究计划 · 非经纪交易");
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-issue-desk-zh.png`), fullPage: false });
});
