import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { isolateWatchlistStore } from "./watchlistStore";

// Real browser -> real Next route/client -> existing in-memory fixture database.
// No claims about live accounts, canonical security resolution, SQL/RLS or the
// not-yet-integrated Theme Atlas renderer are made by these tests.
const endpoint = "/api/thesis-saved-views";
const contract = "mastermind.saved_view.v2";
test.setTimeout(90_000);

async function open(page: Page, info: TestInfo, baseURL: string | undefined, lang: "en" | "zh") {
  await isolateWatchlistStore(page, info, baseURL);
  await page.addInitScript((value) => localStorage.setItem("mm.lang", value), lang);
  await page.goto("/analysis?view=theses");
  await expect(page.getByTestId("rms-saved-views-empty")).toBeVisible();
}
async function draft(page: Page, name: string) {
  await page.locator('[data-builtin="stale_30"]').click();
  await page.getByTestId("rms-save-view").click();
  const input = page.locator('form input[maxlength="80"]');
  await expect(input).toBeVisible();
  await input.fill(name);
  return input.locator("..").getByRole("button", { name: /^(Save|保存)$/ });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
async function screen(page: Page, info: TestInfo, name: string) {
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(name + ".png"), fullPage: true });
}

for (const lang of ["en", "zh"] as const) {
  test(`saved view ${lang}: native browser save, duplicate-click guard, reload`, async ({ page, baseURL }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page, info, baseURL, lang);
    let creates = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === endpoint && request.method() === "PUT"
          && request.postDataJSON()?.action === "create") creates++;
    });
    const name = lang === "zh" ? "待复查的研究" : "Research to revisit";
    const submit = await draft(page, name);
    const answer = page.waitForResponse(response => new URL(response.url()).pathname === endpoint
      && response.request().method() === "PUT");
    // Two actual DOM click events before the first response, not two mocked callbacks.
    await submit.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    const response = await answer;
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.contract).toBe(contract);
    expect(body.receipt.requestId).toBe(body.view.id);
    expect(body.receipt.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(body.view.definition).toEqual({ version: 1, kind: "thesis_filter", filter: { lifecycle: "active", staleDays: 30 } });
    const saved = page.locator(`[data-saved-view="${body.view.id}"]`);
    await expect(saved).toContainText(name);
    expect(creates).toBe(1);
    await screen(page, info, `saved-${lang}`);
    await page.reload();
    await expect(saved).toContainText(name);
    const list = await page.request.get(`${endpoint}?contract=${contract}`);
    expect((await list.json()).views).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test(`saved view ${lang}: committed response lost, check original without resubmission`, async ({ page, baseURL }, info) => {
    await open(page, info, baseURL, lang);
    let committedId = "";
    let creates = 0;
    let checkedOriginal = false;
    await page.route(`**${endpoint}*`, async route => {
      const request = route.request();
      if (request.method() === "PUT" && request.postDataJSON()?.action === "create") {
        creates++;
        const response = await route.fetch(); // The real route commits before the reply is lost.
        expect(response.status()).toBe(201);
        committedId = (await response.json()).view.id;
        await route.abort("failed");
      } else {
        if (request.method() === "GET" && new URL(request.url()).searchParams.get("id") === committedId && committedId) checkedOriginal = true;
        await route.continue();
      }
    });
    const name = lang === "zh" ? "保留原始请求" : "Keep the original request";
    await (await draft(page, name)).click();
    const check = page.getByTestId("rms-saved-view-check");
    await expect(check).toBeVisible();
    // A committed-but-unconfirmed save cannot coexist with a claim that no views exist.
    await expect(page.getByTestId("rms-saved-views-empty")).toBeHidden();
    expect(committedId).not.toBe("");
    await screen(page, info, `unknown-${lang}`);
    await check.click();
    await expect(page.locator(`[data-saved-view="${committedId}"]`)).toContainText(name);
    expect(checkedOriginal).toBe(true);
    expect(creates).toBe(1);
    await screen(page, info, `recovered-${lang}`);
    await page.reload();
    await expect(page.locator(`[data-saved-view="${committedId}"]`)).toContainText(name);
    expect((await (await page.request.get(`${endpoint}?contract=${contract}`)).json()).views).toHaveLength(1);
    expect(creates).toBe(1);
  });

  test(`saved view ${lang}: fixed and live definitions round-trip over actual HTTP`, async ({ page, baseURL }, info) => {
    await open(page, info, baseURL, lang);
    const fixedId = randomUUID();
    const liveId = randomUUID();
    const fixed = { version: 1, kind: "heatmap_fixed", securityOwner: "data_os.security_master",
      securityKeys: ["TEST_ONLY:MU"], universe: { owner: "test.fixture", key: "memory" }, membershipVersion: "TEST_ONLY:v1" };
    const live = { version: 1, kind: "heatmap_live", universe: { owner: "test.fixture", key: "memory" },
      membershipPolicy: "current_on_open", sessionPolicy: "latest_eligible_close",
      metric: { id: "price_return_pct", window: "1D" }, condition: { operator: "gt", value: 2 } };
    const make = (id: string, definition: object) => ({ action: "create", contract, id, name: "Illustrative Memory", definition });
    for (const [id, definition] of [[fixedId, fixed], [liveId, live]] as const) {
      const created = await page.request.put(endpoint, { data: make(id, definition) });
      expect(created.status()).toBe(201);
      expect((await created.json()).view.definition).toEqual(definition);
      const lookup = await page.request.get(`${endpoint}?id=${id}`);
      expect((await lookup.json()).view.definition).toEqual(definition);
      const repeated = await page.request.put(endpoint, { data: make(id, definition) });
      expect(repeated.status()).toBe(200);
      expect((await repeated.json()).replayed).toBe(true);
    }
    const wrong = await page.request.put(endpoint, { data: make(fixedId, live) });
    expect(wrong.status()).toBe(409);
    expect((await wrong.json()).error).toBe("request_conflict");
    // The legacy thesis view must not consume heatmap definitions as thesis filters.
    expect((await (await page.request.get(endpoint)).json()).views).toEqual([]);
    expect((await (await page.request.get(`${endpoint}?contract=${contract}`)).json()).views).toHaveLength(2);
    expect((await page.request.put(endpoint, { data: { action: "delete", contract, id: fixedId } })).status()).toBe(200);
    expect((await (await page.request.get(`${endpoint}?id=${fixedId}`)).json()).state).toBe("deleted");
    const retired = await page.request.put(endpoint, { data: make(fixedId, fixed) });
    expect(retired.status()).toBe(410);
    expect((await retired.json()).error).toBe("request_retired");
    await noOverflow(page);
  });
}
