import { expect, test } from "@playwright/test";

// Fixture seam (FLOW_FIXTURE=1): SPY term lists eight expiries, the smile only two.
// One shared expiry selection must stay exact across the context strip, the term
// selector and the smile: never a nearest-expiry smile in place of a missing one.
test("Volatility keeps one exact expiry across term, context and smile", async ({ page }) => {
  await page.goto("/options?tab=volatility");

  const context = page.getByTestId("vol-expiry-context");
  const termSelect = page.getByTestId("term-expiry-select");
  const smileCard = page.locator(".fin-card").filter({ hasText: "Smile / skew" }).first();
  const chip = (exp: string) => smileCard.getByRole("button", { name: exp, exact: true });

  await expect(context).toContainText("2026-07-11", { timeout: 20_000 });
  await expect(context).toContainText("smile supplied", { timeout: 20_000 });
  await expect(termSelect).toHaveValue("2026-07-11", { timeout: 20_000 });
  await expect(chip("2026-07-11")).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });

  // A term-only expiry: the smile must say it is missing, not show 2026-07-18.
  await termSelect.selectOption("2026-08-08", { timeout: 20_000 });
  await expect(context).toContainText("2026-08-08", { timeout: 20_000 });
  await expect(context).toContainText("32 days", { timeout: 20_000 });
  await expect(context).toContainText("reported ATM IV 16.2%", { timeout: 20_000 });
  await expect(context).toContainText("smile unavailable for this expiry", { timeout: 20_000 });
  await expect(smileCard).toContainText("No smile for the selected expiry", { timeout: 20_000 });
  await expect(smileCard.locator('svg[role="img"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(chip("2026-07-11")).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
  await expect(chip("2026-07-18")).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });

  // The smile chip drives the same shared selection back into the term selector.
  await chip("2026-07-18").click({ timeout: 20_000 });
  await expect(termSelect).toHaveValue("2026-07-18", { timeout: 20_000 });
  await expect(context).toContainText("11 days", { timeout: 20_000 });
  await expect(context).toContainText("smile supplied", { timeout: 20_000 });
  await expect(smileCard.locator('svg[role="img"]')).toHaveCount(1, { timeout: 20_000 });

  const doc = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
});
