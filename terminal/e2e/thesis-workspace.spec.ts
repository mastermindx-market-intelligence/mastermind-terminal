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

async function createThesis(page: Page, title: string, requestId: string, symbol = "NVDA") {
  const response = await page.request.post("/api/theses", { data: {
    action: "create", clientRequestId: requestId,
    subject: {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key: symbol, identityState: "listing_scoped", listing: { symbol, mic: null, securityId: null },
      companyId: null, display: `${symbol} · listing scoped`,
    },
    content: {
      schema: "mastermind.thesis-content/v1", title, statement: `${title} statement`,
      catalysts: [], falsifiers: [], risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
    },
  } });
  expect(response.status()).toBe(201);
  return (await response.json()).thesisId as string;
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
  expect(await stale.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  stale.once("dialog", (dialog) => void dialog.dismiss());
  await stale.getByRole("button", { name: "New thesis" }).click();
  await expect(stale.getByLabel("Thesis statement")).toHaveValue(preserved);
  await stale.getByTestId("thesis-conflict").evaluate((element) => element.scrollIntoView({ block: "start" }));
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
  await page.getByRole("button", { name: "Inspect version 2" }).click();
  const historical = page.getByTestId("thesis-version-inspector");
  await expect(historical).toHaveAttribute("data-posture", "historical");
  await expect(historical).toContainText("Historical snapshot");
  await expect(historical).toContainText("Previous version");
  await expect(historical).toContainText("Version 1");
  await expect(historical).toContainText("Recorded by");
  await expect(historical).toContainText("You");
  await expect(historical).toContainText("Software mix expands pricing power through the next platform cycle.");
  await expect(historical).toContainText("Data-center revenue compounds");
  await page.getByRole("button", { name: "Inspect version 7" }).click();
  await expect(historical).toHaveAttribute("data-posture", "current");
  await expect(historical).toContainText("Current snapshot");
  await expect(historical).toContainText("The winning tab advances the canonical head.");

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
    await expect(page.getByText("Version 7 · Current")).toBeVisible();
    await page.getByRole("button", { name: "Inspect version 7" }).click();
    await expect(page.getByTestId("thesis-version-inspector")).toHaveAttribute("data-posture", "current");
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

  await page.locator("[aria-label='Version history']").evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(proofDir, `${testInfo.project.name}-lineage.png`), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("ordinary dirty drafts require deliberate discard and remain recoverable", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await page.goto("/analysis?view=theses&symbol=NVDA");
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to list" }).click();
    await page.getByRole("button", { name: "New thesis" }).click();
  }
  await fillNew(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Version 1 · Current")).toBeVisible();

  const dirtyStatement = "An ordinary unsaved draft must survive a cancelled discard.";
  await page.getByLabel("Thesis statement").fill(dirtyStatement);
  await expect(page.getByTestId("thesis-dirty-draft")).toContainText("Unsaved changes");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Save or discard substantive edits before changing lifecycle.", { exact: true })).toBeVisible();
  await expect(page.getByText("Version 1 · Current")).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);

  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "New thesis" }).click();
  await expect(page.getByLabel("Thesis statement")).toHaveValue(dirtyStatement);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "New thesis" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("");
  await page.getByLabel("Title").fill("Recoverable local draft");
  await page.getByLabel("Thesis statement").fill("This draft has not been sent anywhere.");

  page.once("dialog", (dialog) => void dialog.dismiss());
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to list" }).click();
  } else {
    await page.getByRole("button", { name: /NVDA operating leverage/ }).click();
  }
  await expect(page.getByLabel("Title")).toHaveValue("Recoverable local draft");

  page.once("dialog", (dialog) => void dialog.accept());
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to list" }).click();
    await expect(page.getByTestId("thesis-list-pane")).toBeVisible();
  } else {
    await page.getByRole("button", { name: /NVDA operating leverage/ }).click();
    await expect(page.getByLabel("Title")).toHaveValue("NVDA operating leverage");
  }
});

test("clean thesis routes traverse Back, Forward, and reload without identity drift", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const firstId = await createThesis(page, "History A", "d0000000-0000-4000-8000-000000000001");
  const secondId = await createThesis(page, "History B", "d0000000-0000-4000-8000-000000000002", "AAPL");
  await page.goto("/analysis?view=theses");

  await page.getByRole("button", { name: /History A/ }).click();
  await expect(page).toHaveURL(new RegExp(`thesis=${firstId}`));
  await expect(page.getByLabel("Title")).toHaveValue("History A");

  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to list" }).click();
  }
  await page.getByRole("button", { name: /History B/ }).click();
  await expect(page).toHaveURL(new RegExp(`thesis=${secondId}`));
  await expect(page.getByLabel("Title")).toHaveValue("History B");

  await page.goBack();
  if (testInfo.project.name === "mobile") {
    await expect(page).toHaveURL(/\/analysis\?view=theses$/);
    await expect(page.getByTestId("thesis-list-pane")).toBeVisible();
  } else {
    await expect(page).toHaveURL(new RegExp(`thesis=${firstId}`));
    await expect(page.getByLabel("Title")).toHaveValue("History A");
  }

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`thesis=${secondId}`));
  await expect(page.getByLabel("Title")).toHaveValue("History B");
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("History B");
});

test("dirty browser Back requires a decision and a cancelled traversal preserves the draft", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const thesisId = await createThesis(page, "Dirty history", "e0000000-0000-4000-8000-000000000001");
  await page.goto("/analysis?view=theses");
  await page.getByRole("button", { name: /Dirty history/ }).click();
  await expect(page).toHaveURL(new RegExp(`thesis=${thesisId}`));
  const draft = "Browser Back must never erase this losing draft.";
  await page.getByLabel("Thesis statement").fill(draft);

  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`thesis=${thesisId}`));
  await expect(page.getByLabel("Thesis statement")).toHaveValue(draft);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(/\/analysis\?view=theses$/);
  if (testInfo.project.name === "mobile") {
    await expect(page.getByTestId("thesis-list-pane")).toBeVisible();
  } else {
    await expect(page.getByTestId("thesis-detail-pane")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("");
    await expect(page.getByText("Version 1 · Current")).toHaveCount(0);
  }
});

test("a Chinese direct link keeps the same finite list/detail history journey", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, true);
  const firstId = await createThesis(page, "历史甲", "f0000000-0000-4000-8000-000000000001");
  const secondId = await createThesis(page, "历史乙", "f0000000-0000-4000-8000-000000000002", "AAPL");
  await page.goto(`/analysis?view=theses&thesis=${firstId}`);
  await expect(page.getByLabel("标题")).toHaveValue("历史甲");

  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "返回列表" }).click();
  }
  await page.getByRole("button", { name: /历史乙/ }).click();
  await expect(page).toHaveURL(new RegExp(`thesis=${secondId}`));
  await expect(page.getByLabel("标题")).toHaveValue("历史乙");

  await page.goBack();
  if (testInfo.project.name === "mobile") {
    await expect(page).toHaveURL(/\/analysis\?view=theses$/);
    await expect(page.getByTestId("thesis-list-pane")).toBeVisible();
  } else {
    await expect(page).toHaveURL(new RegExp(`thesis=${firstId}`));
    await expect(page.getByLabel("标题")).toHaveValue("历史甲");
  }
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`thesis=${secondId}`));
  await page.reload();
  await expect(page.getByLabel("标题")).toHaveValue("历史乙");
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
      await route.fetch({ maxRetries: 1 });
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
      await route.fetch({ maxRetries: 1 });
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

test("an ambiguous accepted write locks New, list selection, and mobile Back until exact retry", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const existing = await page.request.post("/api/theses", { data: {
    action: "create", clientRequestId: "c0000000-0000-4000-8000-000000000001",
    subject: {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key: "AAPL", identityState: "listing_scoped", listing: { symbol: "AAPL", mic: null, securityId: null },
      companyId: null, display: "AAPL · listing scoped",
    },
    content: {
      schema: "mastermind.thesis-content/v1", title: "Existing thesis", statement: "Existing statement",
      catalysts: [], falsifiers: [], risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
    },
  } });
  expect(existing.status()).toBe(201);

  const requests: Array<Record<string, unknown>> = [];
  let maskFirstAcceptedResponse = true;
  await page.route("**/api/theses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    if (maskFirstAcceptedResponse) {
      maskFirstAcceptedResponse = false;
      await route.fetch({ maxRetries: 1 });
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "thesis_store_unavailable" }) });
    }
    return route.continue();
  });

  await page.goto("/analysis?view=theses&symbol=NVDA");
  await fillNew(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("response was interrupted")).toBeVisible();
  await expect(page.getByRole("button", { name: "New thesis" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Existing thesis/, includeHidden: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Back to list", includeHidden: true })).toBeDisabled();
  await expect(page.getByLabel("Title")).toHaveValue("NVDA operating leverage");

  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("mm.thesis.pending.v1:"))))
    .toBe(true);
  await page.goto("/analysis?view=theses");
  await page.reload();
  await expect(page.getByText("response was interrupted")).toBeVisible();
  await expect(page.getByRole("button", { name: "New thesis" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await expect(page.getByTestId("thesis-detail-pane")).toBeVisible();
    await expect(page.getByTestId("thesis-list-pane")).toBeHidden();
  }

  await page.getByRole("button", { name: "Retry same request" }).click();
  await expect(page.getByText("Version 1 · Current")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  await expect(page.locator("[aria-label='Version history'] article")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "New thesis" })).toBeEnabled();
});

test("a clean pending lifecycle carrier blocks shell navigation and unload until byte-exact retry", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const thesisId = await createThesis(page, "Clean pending archive", "c1000000-0000-4000-8000-000000000001");
  const requests: Array<Record<string, unknown>> = [];
  let maskFirstAcceptedResponse = true;
  await page.route("**/api/theses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    if (maskFirstAcceptedResponse) {
      maskFirstAcceptedResponse = false;
      await route.fetch({ maxRetries: 1 });
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "thesis_store_unavailable" }) });
    }
    return route.continue();
  });

  await page.goto(`/analysis?view=theses&thesis=${thesisId}`);
  await expect(page.getByTestId("thesis-dirty-draft")).toHaveCount(0);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("response was interrupted")).toBeVisible();
  await expect(page.getByTestId("thesis-dirty-draft")).toHaveCount(0);

  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) {
    await menu.click();
    await page.locator(".m-drawer a[href='/terminal']").click();
  } else {
    await page.locator(".appnav a[aria-label='Chart']").click();
  }
  await expect(page).toHaveURL(new RegExp(`thesis=${thesisId}`));
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
  await page.getByRole("button", { name: "Retry same request" }).click();
  await expect(page.getByText("Version 2 · Current")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({ action: "archive", id: thesisId, expectedVersion: 1 });
});

test.describe("timezone-safe effective-at editing", () => {
  test.use({ timezoneId: "America/New_York" });

  test("round-trips DST and standard instants and rejects ambiguous or nonexistent wall clocks", async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL);
    const dst = "2026-07-15T16:34:56.789Z";
    const standard = "2026-01-15T17:34:56.789Z";
    const dstId = await createThesis(page, "DST instant", "c2000000-0000-4000-8000-000000000001");
    const standardId = await createThesis(page, "Standard instant", "c2000000-0000-4000-8000-000000000002");
    const patchEffectiveAt = async (id: string, effectiveAt: string, requestId: string) => {
      const detail = await page.request.get(`/api/theses?id=${id}`);
      const thesis = (await detail.json()).thesis;
      const response = await page.request.post("/api/theses", { data: {
        action: "revise", id, expectedVersion: 1, clientRequestId: requestId,
        subject: thesis.subject, content: { ...thesis.current.content, effectiveAt },
      } });
      expect(response.status()).toBe(200);
    };
    await patchEffectiveAt(dstId, dst, "c2000000-0000-4000-8000-000000000003");
    await patchEffectiveAt(standardId, standard, "c2000000-0000-4000-8000-000000000004");

    const writes: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/theses")) writes.push(request.postDataJSON());
    });
    await page.goto(`/analysis?view=theses&thesis=${dstId}`);
    await expect(page.getByLabel("Effective as of (optional)")).toHaveValue("2026-07-15T12:34:56.789");
    await page.getByLabel("Title").fill("DST instant revised");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Version 3 · Current")).toBeVisible();
    expect((writes.at(-1)?.content as Record<string, unknown>).effectiveAt).toBe(dst);

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Version 4 · Current")).toBeVisible();
    expect((writes.at(-1)?.content as Record<string, unknown>).effectiveAt).toBe(dst);

    await page.goto(`/analysis?view=theses&thesis=${standardId}`);
    await expect(page.getByLabel("Effective as of (optional)")).toHaveValue("2026-01-15T12:34:56.789");

    await page.goto("/analysis?view=theses&symbol=NVDA");
    await fillNew(page, false, "Rejected wall clock");
    const writesBeforeInvalid = writes.length;
    await page.getByLabel("Effective as of (optional)").fill("2026-03-08T02:30");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Check the required fields. Nothing was saved.")).toBeVisible();
    expect(writes).toHaveLength(writesBeforeInvalid);
    await page.getByLabel("Effective as of (optional)").fill("2026-11-01T01:30");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(writes).toHaveLength(writesBeforeInvalid);
  });
});

test("browser storage refusal preserves the draft and sends no mutation", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (this === window.sessionStorage && key.startsWith("mm.thesis.pending.v1:")) {
        throw new DOMException("storage denied", "SecurityError");
      }
      return original.call(this, key, value);
    };
  });
  const mutations: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/theses")) {
      mutations.push(request.postDataJSON());
    }
  });

  await page.goto("/analysis?view=theses&symbol=NVDA");
  await fillNew(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("browser could not safely preserve the request")).toBeVisible();
  await expect(page.getByLabel("Thesis statement")).toHaveValue("Demand will outrun supply through the next platform cycle.");
  expect(mutations).toEqual([]);
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
      await route.fetch({ maxRetries: 1 });
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
