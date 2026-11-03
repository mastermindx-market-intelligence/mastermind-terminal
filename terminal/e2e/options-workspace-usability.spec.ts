import { expect, test } from "@playwright/test";

test("Surface can select, drag and step to an actual observation", async ({ page }) => {
  await page.goto("/options?tab=surface");
  const slider = page.getByRole("slider", { name: "Observed surface frames" });
  const select = page.getByRole("combobox", { name: "Observation", exact: true });
  await expect(select).toBeEnabled();
  const options = await select.locator("option").evaluateAll((nodes) => nodes.map(node => (node as HTMLOptionElement).value));
  expect(options.length).toBeGreaterThan(2);
  await select.selectOption(options[1]);
  await expect(slider).toHaveAttribute("aria-valuenow", "2");
  await slider.scrollIntoViewIfNeeded();
  await expect(slider).toBeInViewport({ ratio: 1 });
  const rect = (await slider.boundingBox())!;
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.width).toBeGreaterThan(page.viewportSize()!.width * .75);
  const y = rect.y + rect.height / 2;
  await page.mouse.move(rect.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 1, y, { steps: 6 });
  await page.mouse.up();
  await expect(select).toHaveValue(options.at(-1)!);
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(select).toHaveValue(options.at(-2)!);
  await page.keyboard.press("Home");
  await expect(select).toHaveValue(options[0]);
  const settings = page.locator(".obs-surf-controls details");
  await settings.locator("summary").click();
  await expect(settings.getByRole("slider").first()).toBeVisible();
  await settings.getByRole("slider").first().focus();
  await page.keyboard.press("Escape");
  await expect(settings).not.toHaveAttribute("open", "");
  await expect(settings.locator("summary")).toBeFocused();
  await expect(select).toHaveValue(options[0]);
});

test("older flow can be inspected during an open exchange session", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-02T16:00:00Z"));
  await page.goto("/options?tab=tape");
  const receipt = page.locator(".options-flow-freshness");
  await expect(receipt).toContainText("Market open");
  await expect(receipt).toContainText("Last session");
  await expect(receipt).not.toContainText("Market closed");
  await receipt.getByText("Feed details", { exact: true }).click();
  await expect(receipt.getByText(/Observed cycle/)).toBeVisible();
  await page.locator("#wtab-cat-structure").click();
  await expect(page.locator(".options-flow-status-row")).not.toContainText("as of");
  await expect(page.locator(".options-ia-view-row")).toHaveCount(0);
  const cards = page.locator(".options-research-pair > section");
  await expect(cards.first()).toBeVisible();
  if (page.viewportSize()!.width >= 1100) {
    const boxes = await cards.evaluateAll(nodes => nodes.slice(0,2).map(x => x.getBoundingClientRect().width));
    expect(boxes[0] + boxes[1]).toBeGreaterThan(page.viewportSize()!.width * .85);
  }
  await page.goBack();
  await expect(page.locator("#wtab-tape")).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(page.locator("#wtab-cat-structure")).toHaveAttribute("aria-selected", "true");
});

test("flow event pages keep their ranks and filters reset the page", async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "EventSource"));
  const sample = await (await page.request.get("/api/flow?f=feed")).json();
  const events = Array.from({ length: 205 }, (_, index) => ({
    ...sample.events[0], id: `qa-${index}`, premium: 1_000_000 - index, zerodte: true,
    root: index === 167 ? "QQQ" : "SPY", repeated: true,
  }));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "feed",
    route => route.fulfill({ json: { ...sample, events } }));
  await page.goto("/options?tab=largest");
  const board = page.locator('[data-options-flow-board="largest-events"]');
  const pager = board.getByRole("navigation", { name: "Event pages" });
  await pager.getByRole("button", { name: "Next" }).click();
  const row = board.locator('[data-flow-event-row="qa-100"]:visible');
  await expect(row).toContainText("101");
  await expect(row).toContainText("repeat");
  await pager.getByRole("button", { name: "Next" }).click();
  await expect(board.locator('[data-flow-event-row]:visible')).toHaveCount(5);
  await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
  await board.getByRole("textbox").fill("QQQ");
  await expect(board.locator('[data-flow-event-row]:visible')).toHaveCount(1);
  await expect(board.locator('[data-flow-event-row]:visible .options-flow-board-rank')).toHaveText(/#?1$/);
  await page.locator("#wtab-0dte").click();
  await expect(page.locator('[data-options-flow-board="0dte"] [data-flow-event-row="qa-0"]:visible')).toBeVisible();
});

test("the selected category stays inside the navigation rail after a window resize", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/options?tab=tape");
  const active = page.locator("#wtab-cat-prophet");
  await active.click();
  await expect(active).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => active.evaluate((tab) => {
    const button = tab.getBoundingClientRect(), rail = tab.closest("nav")!.getBoundingClientRect();
    return button.left >= rail.left - 1 && button.right <= rail.right + 1;
  })).toBe(true);
});
