import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

test.setTimeout(120_000);

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement?.setAttribute("data-lang", useZh ? "zh" : "en");
    document.documentElement?.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, zh);
}

async function fillNew(page: Page) {
  await page.getByLabel("Title").fill("NVDA operating leverage");
  await page.getByLabel("Thesis statement").fill("Demand will outrun supply through the next platform cycle.");
  await page.getByLabel("Catalysts").fill("Data-center revenue compounds\nSoftware mix expands");
  await page.getByLabel("Falsifiers").fill("Gross margin falls below 65%");
  await page.getByLabel("Risks").fill("Customer concentration");
  await page.getByLabel("Horizon").selectOption("quarters");
}

test("create → deep link → reload → revise → conflict → archive/invalidate/reopen keeps immutable history", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const proofDir = path.join(process.cwd(), "e2e/proof/f11-theses");
  const browserErrors: string[] = [];
  mkdirSync(proofDir, { recursive: true });
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/analysis?view=theses&symbol=NVDA");
  await expect(page.getByTestId("thesis-workspace")).toBeVisible();
  await expect(page.getByTestId("thesis-empty")).toBeVisible();
  await fillNew(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/analysis\?view=theses&thesis=[0-9a-f-]{36}$/);
  await expect(page.getByText("Version 1 · Current")).toBeVisible();
  const thesisUrl = page.url();

  await page.reload();
  await expect(page.getByLabel("Thesis statement")).toHaveValue("Demand will outrun supply through the next platform cycle.");
  await page.getByLabel("Thesis statement").fill("Software mix expands pricing power through the next platform cycle.");
  await page.getByLabel("Revision note").fill("Refined the operating leverage mechanism.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Version 2 · Current")).toBeVisible();

  const stale = await page.context().newPage();
  await stale.goto(thesisUrl);
  await expect(stale.getByText("Version 2 · Current")).toBeVisible();
  const preserved = "This stale draft must remain exactly intact.";
  await stale.getByLabel("Thesis statement").fill(preserved);

  await page.getByLabel("Thesis statement").fill("The winning tab advances the canonical head.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Version 3 · Current")).toBeVisible();

  await stale.getByRole("button", { name: "Save", exact: true }).click();
  await expect(stale.getByTestId("thesis-conflict")).toContainText("newer version");
  await expect(stale.getByTestId("thesis-conflict")).toContainText("Version 3");
  await expect(stale.getByLabel("Thesis statement")).toHaveValue(preserved);
  await stale.screenshot({ path: path.join(proofDir, `${testInfo.project.name}-conflict.png`), fullPage: true });
  await stale.close();

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Version 4 · Current")).toBeVisible();
  await expect(page.getByLabel("Title")).toBeDisabled();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.getByText("Version 5 · Current")).toBeVisible();

  await page.getByLabel("Revision note").fill("The falsifier was observed in audited results.");
  await page.getByRole("button", { name: "Invalidate", exact: true }).click();
  await expect(page.getByText("Version 6 · Current")).toBeVisible();
  await page.getByLabel("Revision note").fill("New audited evidence resolves that falsifier.");
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.getByText("Version 7 · Current")).toBeVisible();
  await expect(page.locator("[aria-label='Version history'] article")).toHaveCount(7);

  const overflow = await page.getByTestId("thesis-workspace").evaluate((root) => ({
    root: root.scrollWidth - root.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.root).toBeLessThanOrEqual(1);
  expect(overflow.document).toBeLessThanOrEqual(1);

  await page.screenshot({ path: path.join(proofDir, `${testInfo.project.name}-lineage.png`), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("malformed links make no store request; foreign and missing IDs share one response", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const thesisRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/theses")) thesisRequests.push(request.url()); });
  await page.goto("/analysis?view=theses&thesis=not-a-uuid");
  await expect(page.getByTestId("thesis-invalid-link")).toBeVisible();
  expect(thesisRequests).toEqual([]);

  const created = await page.request.post("/api/theses", { data: {
    action: "create",
    clientRequestId: "a0000000-0000-4000-8000-000000000001",
    subject: {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key: "NVDA", identityState: "listing_scoped", listing: { symbol: "NVDA", mic: null, securityId: null },
      companyId: null, display: "NVDA · listing scoped",
    },
    content: {
      schema: "mastermind.thesis-content/v1", title: "Private thesis", statement: "Private statement",
      catalysts: [], falsifiers: [], risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
    },
  } });
  expect(created.status()).toBe(201);
  const { thesisId } = await created.json();

  await page.context().addCookies([{ name: "mm_e2e_wl", value: `${testInfo.project.name}-other-owner`, url: baseURL! }]);
  const foreign = await page.request.get(`/api/theses?id=${thesisId}`);
  const missing = await page.request.get("/api/theses?id=a0000000-0000-4000-8000-000000000099");
  expect(foreign.status()).toBe(404);
  expect(missing.status()).toBe(404);
  expect(await foreign.json()).toEqual(await missing.json());

  const mutation = {
    action: "revise",
    expectedVersion: 1,
    clientRequestId: "a0000000-0000-4000-8000-000000000002",
    subject: {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key: "NVDA", identityState: "listing_scoped", listing: { symbol: "NVDA", mic: null, securityId: null },
      companyId: null, display: "NVDA · listing scoped",
    },
    content: {
      schema: "mastermind.thesis-content/v1", title: "Private thesis", statement: "Cross-account mutation",
      catalysts: [], falsifiers: [], risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
    },
  };
  const foreignMutation = await page.request.post("/api/theses", { data: { ...mutation, id: thesisId } });
  const missingMutation = await page.request.post("/api/theses", { data: {
    ...mutation, id: "a0000000-0000-4000-8000-000000000099", clientRequestId: "a0000000-0000-4000-8000-000000000003",
  } });
  expect(foreignMutation.status()).toBe(404);
  expect(missingMutation.status()).toBe(404);
  expect(await foreignMutation.json()).toEqual(await missingMutation.json());
});

test("an ambiguous create retries the exact request and replays one version", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const requests: Array<Record<string, unknown>> = [];
  let interruptFirst = true;
  await page.route("**/api/theses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    if (interruptFirst) {
      interruptFirst = false;
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });

  await page.goto("/analysis?view=theses&symbol=NVDA");
  await fillNew(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("response was interrupted")).toBeVisible();
  await page.getByRole("button", { name: "Retry same request" }).click();
  await expect(page.getByText("Version 1 · Current")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  await expect(page.locator("[aria-label='Version history'] article")).toHaveCount(1);
});

test("unavailable is not empty, and the Chinese mobile/tablet surface keeps history reachable", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, true);
  await page.context().addCookies([{ name: "mm_e2e_fault", value: "theses_read", url: baseURL! }]);
  await page.goto("/analysis?view=theses&symbol=NVDA");
  await expect(page.getByText("论点存储未响应")).toBeVisible();
  await expect(page.getByText("暂无论点")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "研究论点" })).toBeVisible();
  const overflow = await page.getByTestId("thesis-workspace").evaluate((root) => ({
    root: root.scrollWidth - root.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.root).toBeLessThanOrEqual(1);
  expect(overflow.document).toBeLessThanOrEqual(1);
});
