import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

test.setTimeout(120_000);

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false) {
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement?.setAttribute("data-lang", useZh ? "zh" : "en");
    document.documentElement?.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, zh);
  return storeKey;
}

async function fillNew(page: Page, zh = false, title = "NVDA operating leverage") {
  await page.getByLabel(zh ? "标题" : "Title").fill(title);
  await page.getByLabel(zh ? "论点陈述" : "Thesis statement").fill("Demand will outrun supply through the next platform cycle.");
  await page.getByLabel(zh ? "催化因素" : "Catalysts").fill("Data-center revenue compounds\nSoftware mix expands");
  await page.getByLabel(zh ? "证伪条件" : "Falsifiers").fill("Gross margin falls below 65%");
  await page.getByLabel(zh ? "风险" : "Risks").fill("Customer concentration");
  await page.getByLabel(zh ? "时间范围" : "Horizon").selectOption("quarters");
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
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to list" }).click();
    await expect(page.getByTestId("thesis-empty")).toBeVisible();
    await page.getByRole("button", { name: "New thesis" }).click();
  } else {
    await expect(page.getByTestId("thesis-empty")).toBeVisible();
  }
  await fillNew(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/analysis\?view=theses&thesis=[0-9a-f-]{36}$/);
  await expect(page.getByText("Version 1 · Current")).toBeVisible();
  const thesisUrl = page.url();
  const thesisId = new URL(thesisUrl).searchParams.get("thesis");
  expect(thesisId).toMatch(/^[0-9a-f-]{36}$/);

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

  const rail = page.getByTestId("thesis-list-pane");
  const editor = page.getByTestId("thesis-detail-pane");
  if (testInfo.project.name === "mobile") {
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(rail).toBeHidden();
    await expect(editor).toBeVisible();
    await page.getByRole("button", { name: "Back to list" }).click();
    await expect(rail).toBeVisible();
    await expect(editor).toBeHidden();
    await page.getByRole("button", { name: /NVDA operating leverage/ }).click();
    await expect(page).toHaveURL(new RegExp(`thesis=${thesisId}`));
    await expect(editor).toBeVisible();
  } else {
    const [railBox, editorBox] = await Promise.all([rail.boundingBox(), editor.boundingBox()]);
    expect(railBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(editorBox!.x + 1);
  }

  const overflow = await page.getByTestId("thesis-workspace").evaluate((root) => ({
    root: root.scrollWidth - root.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.root).toBeLessThanOrEqual(1);
  expect(overflow.document).toBeLessThanOrEqual(1);

  await page.screenshot({ path: path.join(proofDir, `${testInfo.project.name}-lineage.png`), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("malformed links make no store request; co-resident foreign and missing IDs share one response", async ({ page, baseURL }, testInfo) => {
  const storeKey = await prepare(page, testInfo, baseURL);
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

  await page.context().addCookies([{ name: "mm_e2e_wl", value: `${storeKey}::other-owner`, url: baseURL! }]);
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

test("a server-side 503 after commit retains the exact create carrier", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const requests: Array<Record<string, unknown>> = [];
  let maskFirstAcceptedResponse = true;
  await page.route("**/api/theses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    if (maskFirstAcceptedResponse) {
      maskFirstAcceptedResponse = false;
      await route.fetch();
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "thesis_store_unavailable" }) });
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

test("an unreadable accepted response retains the exact create carrier", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const requests: Array<Record<string, unknown>> = [];
  let maskFirstAcceptedResponse = true;
  await page.route("**/api/theses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    if (maskFirstAcceptedResponse) {
      maskFirstAcceptedResponse = false;
      await route.fetch();
      return route.fulfill({ status: 201, contentType: "application/json", body: "{" });
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

test("rapid list selection keeps the newest deep link and ignores a late prior response", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const create = async (title: string, requestId: string) => {
    const response = await page.request.post("/api/theses", { data: {
      action: "create", clientRequestId: requestId,
      subject: {
        schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
        key: "NVDA", identityState: "listing_scoped", listing: { symbol: "NVDA", mic: null, securityId: null },
        companyId: null, display: "NVDA · listing scoped",
      },
      content: {
        schema: "mastermind.thesis-content/v1", title, statement: `${title} statement`,
        catalysts: [], falsifiers: [], risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
      },
    } });
    return (await response.json()).thesisId as string;
  };
  const firstId = await create("First thesis", "b0000000-0000-4000-8000-000000000001");
  const secondId = await create("Second thesis", "b0000000-0000-4000-8000-000000000002");
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route(`**/api/theses?id=${firstId}`, async (route) => {
    markFirstStarted();
    await firstGate;
    await route.continue();
  });
  await page.goto("/analysis?view=theses");
  await page.getByRole("button", { name: /First thesis/ }).click();
  await firstStarted;
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Back to list" }).click();
  await page.getByRole("button", { name: /Second thesis/ }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Second thesis");
  await expect(page).toHaveURL(new RegExp(`thesis=${secondId}`));
  releaseFirst();
  await expect(page.getByLabel("Title")).toHaveValue("Second thesis");
  await expect(page).toHaveURL(new RegExp(`thesis=${secondId}`));
});

test("unavailable is not empty, and the Chinese mobile/tablet surface keeps history reachable", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, true);
  await page.context().addCookies([{ name: "mm_e2e_fault", value: "theses_read", url: baseURL! }]);
  await page.goto("/analysis?view=theses&symbol=NVDA");
  await expect(page.getByText("论点存储未响应")).toBeVisible();
  await expect(page.getByText("暂无论点")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "研究论点工作区" })).toBeVisible();
  const overflow = await page.getByTestId("thesis-workspace").evaluate((root) => ({
    root: root.scrollWidth - root.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.root).toBeLessThanOrEqual(1);
  expect(overflow.document).toBeLessThanOrEqual(1);

  await page.context().clearCookies({ name: "mm_e2e_fault" });
  await page.reload();
  await fillNew(page, true, "英伟达经营杠杆");
  await expect(page.getByLabel("时间范围").locator("option")).toHaveText(["未指定", "天", "周", "月", "季度", "年"]);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("版本 1 · 当前")).toBeVisible();
  await expect(page.getByRole("button", { name: "复制链接" })).toBeVisible();
  await expect(page.locator("[aria-label='版本历史'] article").first()).toContainText("创建");
  await expect(page.getByTestId("thesis-detail-pane")).not.toContainText("listing scoped");

  await page.goto("/analysis?view=unknown");
  await expect(page.getByRole("heading", { name: "不支持此分析视图" })).toBeVisible();
});
