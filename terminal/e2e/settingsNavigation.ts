import { expect, type Page } from "@playwright/test";

// The same thirteen settings destinations have two accessible presentations:
// a vertical tablist on desktop/tablet, and one native picker at <=640px.
// Exercise the control the operator can actually see; do not click hidden tabs.
export async function selectSettingsSection(page: Page, id: string, label: string): Promise<void> {
  const dialog = page.locator(".acs-overlay.open .acs-card");
  await expect(dialog).toBeVisible();
  const picker = dialog.locator(".acs-section-select");
  if (await picker.isVisible()) {
    await expect(picker.locator(`option[value="${id}"]`)).toHaveText(label);
    await picker.selectOption(id);
    await expect(picker).toHaveValue(id);
  } else {
    const tab = dialog.getByRole("tab", { name: label, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }
  await expect(dialog.locator(".acs-sect")).toHaveAttribute("data-section", id);
}

export async function expectSettingsNavigation(
  page: Page,
  destinations: ReadonlyArray<{ id: string; label: string }>,
  selected: string,
): Promise<void> {
  const dialog = page.locator(".acs-overlay.open .acs-card");
  await expect(dialog).toBeVisible();
  const picker = dialog.locator(".acs-section-select");
  if (await picker.isVisible()) {
    await expect(picker.locator("option")).toHaveCount(13);
    for (const { id, label } of destinations) {
      await expect(picker.locator(`option[value="${id}"]`)).toHaveText(label);
    }
    await expect(picker).toHaveValue(selected);
  } else {
    await expect(dialog.getByRole("tab")).toHaveCount(13);
    for (const { id, label } of destinations) {
      const tab = dialog.getByRole("tab", { name: label, exact: true });
      await expect(tab).toBeVisible();
      await expect(tab).toHaveAttribute("id", `acs-tab-${id}`);
    }
    await expect(dialog.locator(`#acs-tab-${selected}`)).toHaveAttribute("aria-selected", "true");
  }
}
