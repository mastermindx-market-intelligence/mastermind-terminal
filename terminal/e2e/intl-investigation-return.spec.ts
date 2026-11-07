import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import path from "node:path";

// Extend the incumbent real Next/AppShell harness. No Link/router/parent is
// replaced: only HTTP transport goes to that harness's own Next server, while
// the browser keeps the already-admitted Beta/www origins. In particular, no
// localhost3100 listener or bridge-origin amendment is needed or permitted.
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Incumbent Shared Shell beta fixture opt-in required");
if (process.env.MMX_SHARED_SHELL === "1" && !process.env.CI && process.env.TERMINAL_VISUAL_EVIDENCE_OPERATION === undefined) {
  throw new Error("Use the incumbent fresh-owned server harness; never reuse an unrelated local Next server.");
}
import { SHELL, LEGACY, installRealNextLegacyTransport } from "./fixtures/real-next-legacy-transport";
import { readRetainedLegacyFixture } from "./fixtures/retained-legacy-fixture";
const BUNDLE_SHA = "f96e0c877c37d0abf3e2a6afbcb08dfa38005e2d98cc37e6623fbf913bc6de02";
const RAW_JINJA_SHA = "4f807836970e39dbfe429368e23079aff6a21ceed39d9f2f724259cb9e612f8a";
const HTML_SHA = "07606d80b209c4e79381ed96d8390f93590c57cab3899a26d1dd5daeda9bdfcf";
const ASSET_SHA: Record<string, string> = {
  "intl_workspace.js": "43fe67c4be946c4c7de6b1afc080f5970ff58c4e428a157182f3ad0399f5a879",
  "intl_workspace_state.js": "b02a808380c1a1d2c798f1b827707fa07d23679e15bf01753cffaada55f00fd1",
  "intl_workspace_entry.js": "3b476b4ce04b91f0a8854c4a3e5b2e26f672cfa21c67445d8ce765edc62a8b1b",
  "shared_shell_bridge.js": "071ef7202d8886228342c00f0e7a3026eaba1d0103c4dcf1e6d204a7da77451b",
  "shared_shell.css": "b1918ccaa2294f18c0fd5bca123e38267251c7e9d9a7c4fce1f296ef9e4c3c1e",
};
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");

test("Macro/Risk Return executes real Next Link and restores Intl in the same AppShell", async ({ page, context, baseURL }, info) => {
  // Repository checkout supplies the exact historical source closure. Only the
  // incumbent normal SharedShell capability block was added to retained Jinja.
  const retained = readRetainedLegacyFixture(path.join(__dirname, "fixtures/intl-return-page/fixture.json.gz"), BUNDLE_SHA);
  expect(retained.provenance.macro_source).toBe("7a2ffcb8dec91f701ebaf0d04990b2be6a7b8abb");
  expect(digest(retained.rawJinja)).toBe(RAW_JINJA_SHA);
  expect(digest(retained.html)).toBe(HTML_SHA);
  for (const [name, sha] of Object.entries(ASSET_SHA)) expect(digest(retained.assets.get("/" + name)!), name).toBe(sha);
  const observations = await installRealNextLegacyTransport({ page, context, baseURL: baseURL!, canonicalChildPath: "/intl.html", html: retained.html, assets: retained.assets });
  const states: unknown[] = [];

  try {
    for (const selected of [
      { view: "macro", market: "GB", pins: ["GB", "EZ"], horizon: "3m", basis: "local" },
      { view: "risk", market: "EZ", pins: ["GB", "EZ"], horizon: "1m", basis: "usd_unhedged" },
    ]) {
      const query = `view=${selected.view}&market=${selected.market}&pins=${selected.pins.join(",")}&horizon=${selected.horizon}&basis=${selected.basis}&return_basis=price&group=`;
      const canonical = "/intl.html?" + query, back = LEGACY + canonical;
      const entry = new URL("/analysis", SHELL);
      entry.searchParams.set("view", "investigations"); entry.searchParams.set("intl_return", back);
      await page.goto(entry.href, { waitUntil: "domcontentloaded" });
      const shell = page.locator('[data-shared-shell="beta"]');
      await expect(shell).toBeVisible();
      const link = page.getByRole("link", { name: "Return to International Markets", exact: true });
      await expect(link).toHaveAttribute("href", canonical);
      await page.evaluate(() => { (window as Window & { __s28NextDocument?: string }).__s28NextDocument = "real-next-return"; });
      await link.click(); // Real next/link and router; no evaluate navigation substitute.
      await expect(page).toHaveURL(SHELL + canonical);
      expect(await page.evaluate(() => (window as Window & { __s28NextDocument?: string }).__s28NextDocument)).toBe("real-next-return");
      await expect(shell).toBeVisible();
      await expect(page.locator('[data-shared-shell-phase="ready"]')).toBeVisible();
      const frame = page.frameLocator("iframe[data-shared-shell-frame]");
      const workspace = frame.locator('[data-im-workspace][data-im-enhanced="true"]');
      await expect(workspace).toBeVisible();
      const state = await workspace.evaluate(root => {
        const api = (window as Window & { IntlWorkspace?: { mountIntlWorkspace: (root: Element, config: unknown) => { getState: () => unknown } } }).IntlWorkspace;
        if (!api) throw new Error("Actual Intl controller unavailable");
        // Existing mount returns its existing handle; no second controller or
        // copied reducer supplies this state.
        return api.mountIntlWorkspace(root, JSON.parse(root.querySelector("[data-im-config]")!.textContent!)).getState();
      });
      expect(state).toMatchObject({ view: selected.view, selected_market: selected.market, compare_markets: selected.pins, horizon: selected.horizon, currency_basis: selected.basis, return_basis: "price" });
      await expect(frame.locator(`[data-im-panel][data-view="${selected.view}"][data-horizon="${selected.horizon}"][data-basis="${selected.basis}"]`)).toBeVisible();
      states.push({ canonical, state });
      await page.screenshot({ path: info.outputPath(`intl-return-${selected.view}.png`) });
    }
    expect(observations.baselines).toEqual([]);
    expect(observations.mutations).toEqual([]);
    expect(observations.pageErrors).toEqual([]);
  } finally {
    await info.attach("real-next-intl-return", { body: JSON.stringify({ basis: "Real Next/AppShell/Link; pinned real-Jinja Macro fixture; controlled HTTP/read fixtures only, no live auth/feed/OPEN", observations, states }, null, 2), contentType: "application/json" });
  }
});
