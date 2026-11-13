import type { Locator, Page } from "@playwright/test";

// Prophet secondary lanes (Options Alpha, Issue Desk) are inline tabs on
// desktop/tablet and sit behind the "More" disclosure at <=640px. Specs that
// select one of them call this instead of clicking the tab directly, so the
// same journey runs at every viewport. Not a spec file.
export async function clickProphetLaneTab(page: Page, tab: Locator): Promise<void> {
  const more = page.getByTestId("prophet-lane-more");
  await more.waitFor({ state: "attached" });
  if (!(await tab.isVisible())) await more.click();
  await tab.click();
}
