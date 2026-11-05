import { expect, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Options' ordinary shell does not activate the shared-shell theme owner. This
// fixture tests a panel against that owner's EXISTING light tokens, scoped to
// the panel. It neither enables a shell flag nor claims theme-preference proof.
const source = readFileSync(path.resolve(__dirname, "../components/chrome/shared-shell/shared-shell.css"), "utf8");
const light = source.match(/:root\[data-mmx-shared-shell="1"\]\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1];
if (!light) throw new Error("Existing shared-shell light token declaration was not found");

export async function applyD08BPanelPresentation(panel: Locator, mode: "dark" | "light-tokens") {
  const page = panel.page();
  if (!await page.locator("#d08b-panel-light-token-fixture").count()) {
    const style = await page.addStyleTag({ content: `[data-d08b-light-token-fixture="true"] { ${light} background: var(--panel); }` });
    await style.evaluate(el => { (el as HTMLStyleElement).id = "d08b-panel-light-token-fixture"; });
  }
  await panel.evaluate((el, selected) => {
    if (selected === "light-tokens") el.setAttribute("data-d08b-light-token-fixture", "true");
    else el.removeAttribute("data-d08b-light-token-fixture");
  }, mode);
  const panelToken = await panel.evaluate(el => getComputedStyle(el).getPropertyValue("--panel").trim());
  if (mode === "light-tokens") expect(panelToken).toBe("#ffffff");
  else expect(panelToken).not.toBe("#ffffff");
}
