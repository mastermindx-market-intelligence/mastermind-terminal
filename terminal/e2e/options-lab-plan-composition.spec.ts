import { expect, test } from "@playwright/test";
import { fixtureAuthSetup, signFixtureAccessToken, createFixtureSession } from "./fixtures/investigation-auth";

// Actual admitted Lab -> existing shortlist -> native draft composition.
// Signed local SDK identity and HTTP fixtures are not production admission.
test("admitted Lab round trip preserves pins, requires native New/Add and retires the old account", async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  const auth = await fixtureAuthSetup(page, baseURL!);
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  const effects: string[] = [], valuations: string[] = [];
  await page.route("**/api/flow?*", route => {
    const f = new URL(route.request().url()).searchParams.get("f");
    if (f === "matrix:SPY") return route.fulfill({ json: { schema: "options_structure.matrix/v1", root: "SPY", session: "2026-10-05",
      cells: [{ strike: 785, expiry: "2026-10-09", call_vol: 243000, call_oi: 110000, put_vol: 0, put_oi: null }] } });
    if (f === "oi") return route.fulfill({ json: { schema: "options_hub.oi_movers/v1", asof: "2026-10-23T20:00:00Z",
      movers: [{ root: "SPY", exp: "2026-10-30", right: "C", strike: 765, mid: 3, oi: 10, d_oi: 5 }] } });
    return route.fallback();
  });
  await page.route("**/api/investigations{,?*}", route => {
    if (route.request().method() !== "GET") effects.push(route.request().method() + " investigations");
    return route.fulfill({ json: { status: "listed", items: [] } });
  });
  await page.route("**/api/options/plan/expiry", route => {
    valuations.push(route.request().method());
    return route.fulfill({ status: 500, json: {} });
  });
  page.on("request", request => {
    if (request.method() !== "GET" && /\/api\/(?:layouts|alerts|watchlist|theses|brain\/command|__e2e__\/supabase\/auth)/.test(new URL(request.url()).pathname)) effects.push(request.method() + " " + new URL(request.url()).pathname);
  });
  await page.goto("/options?tab=gex&view=research&keep=iw2");
  const lab = page.getByRole("region", { name: "3D Research Lab", exact: true });
  await expect(lab.getByRole("button", { name: "785 Call · 2026-10-09", exact: true })).toBeVisible({ timeout: 30_000 });
  await lab.getByRole("button", { name: "785 Call · 2026-10-09", exact: true }).click();
  await lab.getByRole("button", { name: "Scenario lab", exact: true }).click();
  const navigate = lab.getByRole("button", { name: "Choose exact contracts for Plan", exact: true });
  await navigate.click();
  await expect(lab).toBeHidden();
  expect(new URL(page.url()).searchParams.get("keep")).toBe("iw2");
  const ready = page.getByRole("button", { name: "Open saved research", exact: true });
  await expect(ready).toBeEnabled();
  // IW2 keeps its native saved-research entry mounted even with no pins.
  // Navigation must not manufacture a working Plan or a selected contract.
  await expect(page.getByTestId("shortlist-plan-path").getByTestId("options-plan-draft")).toHaveCount(0);
  await expect(page.locator("[data-contract-shortlist] li[data-pin-key]")).toHaveCount(0);
  await page.locator("table.scr [data-contract-pin]").click();
  const open = page.getByTestId("shortlist-plan-path").getByRole("button", { name: "Plan from pinned contracts", exact: true });
  await open.click();
  const draft = page.getByTestId("shortlist-plan-path").getByTestId("options-plan-draft");
  await expect(draft).toContainText("765");
  await expect(draft).not.toContainText("785");
  await draft.getByLabel("Your assumed quantity — contracts", { exact: true }).fill("2");
  await draft.getByLabel("Your entry assumption — premium per unit", { exact: true }).fill("1.25");
  await page.getByRole("tablist", { name: "Options categories", exact: true }).getByRole("tab", { name: "Exposure", exact: true }).click();
  await expect(lab).toBeVisible();
  await navigate.click();
  await expect(draft).toHaveCount(0);
  await expect(open).toBeEnabled();
  await open.click();
  await expect(draft.getByLabel("Your assumed quantity — contracts", { exact: true })).toHaveValue("");
  await expect(draft.getByLabel("Your entry assumption — premium per unit", { exact: true })).toHaveValue("");
  await draft.getByRole("combobox", { name: "Your assumed side", exact: true }).selectOption("buy");
  await draft.getByLabel("Your assumed quantity — contracts", { exact: true }).fill("1");
  await draft.getByLabel("Your entry assumption — premium per unit", { exact: true }).fill("2");
  await draft.getByRole("combobox", { name: "Assumed premium denomination", exact: true }).selectOption("USD");
  await ready.click();
  const add = page.getByRole("button", { name: "Add Plan inputs to new research", exact: true });
  await expect(add).toBeDisabled();
  await page.getByRole("button", { name: "Start new research", exact: true }).click();
  await add.click();
  await expect(page.getByText("Plan inputs copied into this research draft", { exact: false })).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved composed Plan");
  expect(effects).toEqual([]); expect(valuations).toEqual([]);
  await page.screenshot({ path: info.outputPath("explicit-native-new-add.png") });
  const session = createFixtureSession(signFixtureAccessToken({ sub: "e2e00000-0000-4000-8000-000000000002" }));
  await page.evaluate(({ storageKey, session }) => {
    const channel = new BroadcastChannel(storageKey); channel.postMessage({ event: "SIGNED_IN", session }); channel.close();
  }, { storageKey: auth.storageKey, session });
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-contract-shortlist] li[data-pin-key]")).toHaveCount(0);
  await expect(draft).toHaveCount(0);
  await expect(ready).toBeEnabled();
  expect(effects).toEqual([]); expect(valuations).toEqual([]);
});
