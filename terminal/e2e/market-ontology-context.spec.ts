import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

test.setTimeout(120_000);

const CONTEXT_QUERY = "mo_from=ontology&mo_chain=context-chain&mo_path_rev=3&mo_focus=context-node&mo_asof=2026-09-23&mo_kc=2026-08-31";
const RETURN_HREF = "https://www.mastermind-x.com/ontology.html?rev=3#ox-leg-context-node";
const TRANSMISSION_QUERY = "mo_from=transmission&mo_chain=context-chain&mo_focus=leg-3&mo_path_rev=12&mo_asof=2026-10-01&mo_security=SEC:US";
const TRANSMISSION_RETURN_HREF = `https://www.mastermind-x.com/transmission.html#tx-chain-context-chain`;

function moKeys(url: URL) {
  return [...new URL(url.href).searchParams.keys()].filter((key) => key.startsWith("mo_"));
}

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement?.setAttribute("data-lang", useZh ? "zh" : "en");
    document.documentElement?.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, zh);
}

async function openAnalysis(page: Page, query: string) {
  await page.goto(`/analysis?${query}`);
  const shell = query.includes("view=theses")
    ? page.getByTestId("thesis-workspace")
    : page.locator(".analysis-shell");
  await expect(shell).toBeVisible({ timeout: 45_000 });
}

async function fillNewThesis(page: Page, title: string) {
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Thesis statement").fill("This thesis was written after arriving from MarketOntology.");
  await page.getByLabel("Catalysts").fill("Data-center demand stays strong.");
  await page.getByLabel("What would prove this wrong").fill("Data-center demand falls.");
  await page.getByLabel("Risks").fill("Customer concentration.");
  await page.getByLabel("Horizon").selectOption("quarters");
}

async function pickSymbol(page: Page, symbol: string) {
  await page.locator("button.sym-pick").click();
  const dialog = page.locator(".smodal, .msheet-search").first();
  await expect(dialog).toBeVisible();
  await dialog.locator("input[role=combobox]").fill(symbol);
  await dialog.locator(".r", { hasText: symbol }).first().click();
}

/** Create one thesis in this test's isolated fixture store; local only, never production. */
async function createFixtureThesis(page: Page, clientRequestId: string, key: string, title: string) {
  const createResponse = await page.request.post("/api/theses", { data: {
    action: "create",
    clientRequestId,
    subject: {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key, identityState: "listing_scoped", listing: { symbol: key, mic: null, securityId: null },
      companyId: null, display: `${key} · listing scoped`,
    },
    content: {
      schema: "mastermind.thesis-content/v1", title,
      statement: "This existing thesis is reopened while a MarketOntology context is on screen.",
      catalysts: [], falsifiers: [], risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
    },
  } });
  if (!createResponse.ok()) throw new Error(`The thesis could not be created (${createResponse.status()}): ${await createResponse.text()}.`);
  return ((await createResponse.json()) as { thesisId: string }).thesisId;
}

function proofShotPath(proofDir: string, testInfo: TestInfo, name: string, locale: "en" | "zh") {
  const suffix = locale === "zh" ? "-zh" : "";
  return path.join(proofDir, `${testInfo.project.name}-${name}${suffix}.png`);
}

async function captureContextProof(
  page: Page,
  proofDir: string,
  testInfo: TestInfo,
  name: string,
  locale: "en" | "zh",
) {
  const content = name.endsWith("mobile-thesis")
    ? page.getByTestId("thesis-workspace")
    : page.locator(".ci-page");
  await expect(content).toBeVisible({ timeout: 30_000 });
  if (name.endsWith("mobile-thesis")) {
    const firstInput = page.getByTestId("thesis-workspace").locator("input").first();
    await firstInput.focus();
    await expect(firstInput).toBeFocused();
  }
  await page.screenshot({ path: proofShotPath(proofDir, testInfo, name, locale), fullPage: true });
}

function expectContextParams(url: URL) {
  expect(url.searchParams.get("mo_from")).toBe("ontology");
  expect(url.searchParams.get("mo_chain")).toBe("context-chain");
  expect(url.searchParams.get("mo_path_rev")).toBe("3");
  expect(url.searchParams.get("mo_focus")).toBe("context-node");
  expect(url.searchParams.get("mo_asof")).toBe("2026-09-23");
  expect(url.searchParams.get("mo_kc")).toBe("2026-08-31");
}

function expectTransmissionContextParams(url: URL) {
  expect(url.searchParams.get("mo_from")).toBe("transmission");
  expect(url.searchParams.get("mo_chain")).toBe("context-chain");
  expect(url.searchParams.get("mo_focus")).toBe("leg-3");
  expect(url.searchParams.get("mo_path_rev")).toBe("12");
  expect(url.searchParams.get("mo_asof")).toBe("2026-10-01");
  expect(url.searchParams.get("mo_security")).toBe("SEC:US");
}

function expectCapturedThesisPayloads(payloads: string[]) {
  expect(payloads.length).toBeGreaterThan(0);
  expect(payloads.join("\n")).not.toContain("mo_");
}

test("MarketOntology context carries through Analysis and Thesis workspaces without entering API payloads", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  const thesisPayloads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/theses")) {
      thesisPayloads.push(`${request.url()} ${request.postData() ?? ""}`);
    }
  });

  await openAnalysis(page, `symbol=NVDA&page=intelligence&${CONTEXT_QUERY}&mo_zzz=unknown`);
  const strip = page.getByTestId("mo-context-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Opened from WTI Live Path");
  await expect(strip).toContainText("As of September 23, 2026");
  await expect(strip).toContainText("Knowledge cutoff August 31, 2026");
  await expect(strip.getByRole("link", { name: "Back to WTI Live Path" })).toHaveAttribute("href", RETURN_HREF);
  await expect(page.locator(".ci-page")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("tab", { name: "Intelligence" }).click();
  await expect(page.locator(".ci-page")).toBeVisible();
  expectContextParams(new URL(page.url()));
  await expect(strip).toBeVisible();

  await page.getByRole("link", { name: /Your theses on NVDA/ }).click();
  await expect(page.getByTestId("thesis-workspace")).toBeVisible();
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();
  expectContextParams(new URL(page.url()));

  await page.getByRole("button", { name: "New thesis" }).click();
  await fillNewThesis(page, "Context must stay transient");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Version 1 · Current")).toBeVisible({ timeout: 30_000 });
  expectContextParams(new URL(page.url()));
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.getByLabel("Thesis statement").fill("A revised thesis still must not receive navigation context.");
  await page.getByLabel("Revision note").fill("This revision checks that transient navigation context is not copied.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Version 2 · Current")).toBeVisible({ timeout: 30_000 });
  expectContextParams(new URL(page.url()));
  await expect(thesisPayloads.join("\n")).not.toContain("mo_");

  await page.getByRole("button", { name: "New thesis" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("");
  await expect.poll(() => new URL(page.url()).searchParams.get("mo_zzz")).toBeNull();
  expectContextParams(new URL(page.url()));
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.goBack();
  await expect(page.getByText("Version 2 · Current")).toBeVisible({ timeout: 30_000 });
  expectContextParams(new URL(page.url()));
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();
  expectCapturedThesisPayloads(thesisPayloads);
});

test("same-route Analysis navigation reparses URL context", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await openAnalysis(page, `symbol=NVDA&page=intelligence&${CONTEXT_QUERY}`);
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Analysis" }).click();
  await expect(page).toHaveURL(/\/analysis$/);
  await expect(page.locator(".analysis-shell")).toBeVisible();
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
});

test("symbol_switch_clears_every_mo_key_for_transmission_origin", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await openAnalysis(page, `symbol=NVDA&page=intelligence&${TRANSMISSION_QUERY}&mo_channel=context-channel&mo_unknown=yes`);
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();
  await expect(page.getByTestId("mo-context-strip")).toContainText("Opened from Transmission");
  await expect(page.getByTestId("mo-context-strip").getByRole("link", { name: "Back to Transmission" })).toHaveAttribute("href", TRANSMISSION_RETURN_HREF);

  await pickSymbol(page, "MSFT");
  await expect(page.locator(".analysis-shell")).toContainText("MSFT");
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
  const url = new URL(page.url());
  expect([...url.searchParams.keys()].filter((key) => key.startsWith("mo_"))).toEqual([]);
  expect(url.searchParams.get("symbol")).toBe("MSFT");
});

test("opening a thesis on another company clears the MarketOntology context", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  const createResponse = await page.request.post("/api/theses", { data: {
    action: "create",
    clientRequestId: "a1000000-0000-4000-8000-00000000b3b4",
    subject: {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key: "MSFT", identityState: "listing_scoped", listing: { symbol: "MSFT", mic: null, securityId: null },
      companyId: null, display: "MSFT · listing scoped",
    },
    content: {
      schema: "mastermind.thesis-content/v1", title: "A different company",
      statement: "This thesis belongs to another company.", catalysts: [], falsifiers: [],
      risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
    },
  } });
  if (!createResponse.ok()) throw new Error(`The thesis could not be created (${createResponse.status()}): ${await createResponse.text()}.`);

  await page.goto(`/analysis?view=theses&symbol=NVDA&${CONTEXT_QUERY}`);
  await expect(page.getByTestId("thesis-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.getByRole("button", { name: "New thesis" }).click();
  await page.getByLabel("Subject").fill("MSFT");
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
  expect([...new URL(page.url()).searchParams.keys()].filter((key) => key.startsWith("mo_"))).toEqual([]);
  await page.goto(`/analysis?view=theses&symbol=NVDA&${CONTEXT_QUERY}`);
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.getByRole("button", { name: "A different company" }).click();
  await expect(page.getByRole("heading", { name: "MSFT · Listing-scoped identity" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("thesis-workspace")).toContainText("MSFT");
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
  expect([...new URL(page.url()).searchParams.keys()].filter((key) => key.startsWith("mo_"))).toEqual([]);
});

test("returning from a company thesis to the list clears the MarketOntology context", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAnalysis(page, `view=theses&symbol=NVDA&${CONTEXT_QUERY}&mo_zzz=unknown`);
  await expect(page.getByTestId("thesis-workspace")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.getByRole("button", { name: "Back to list" }).click();
  await expect(page.getByTestId("thesis-workspace")).toHaveAttribute("data-mobile-pane", "list");
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
  await expect.poll(() => moKeys(new URL(page.url()))).toEqual([]);
});

test("starting a new thesis on another company clears the MarketOntology context", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await openAnalysis(page, `view=theses&symbol=NVDA&${CONTEXT_QUERY}&mo_zzz=unknown`);
  await expect(page.getByTestId("thesis-workspace")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Analysis" }).click();
  await expect(page.locator(".analysis-shell")).toBeVisible();
  await pickSymbol(page, "MSFT");
  await page.getByRole("link", { name: "Your theses on MSFT" }).click();
  await expect(page.getByTestId("thesis-workspace")).toBeVisible({ timeout: 45_000 });
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("");
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
  await expect.poll(() => moKeys(new URL(page.url()))).toEqual([]);
  expect(new URL(page.url()).searchParams.get("symbol")).toBe("MSFT");
});

test("a Thesis deep link without a company drops every MarketOntology key", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await openAnalysis(page, `view=theses&${CONTEXT_QUERY}&mo_zzz=unknown`);
  await expect(page.getByTestId("thesis-workspace")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
  await expect.poll(() => moKeys(new URL(page.url()))).toEqual([]);
});

test("a same-company new thesis keeps the MarketOntology context but clears unknown keys", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await openAnalysis(page, `view=theses&symbol=NVDA&${CONTEXT_QUERY}&mo_zzz=unknown`);
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.getByRole("button", { name: "New thesis" }).click();
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get("mo_zzz")).toBeNull();
  expectContextParams(url);
});

test("the context strip remains usable across the responsive contract", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The contract proof cycles all three viewports in one desktop run.");
  await prepare(page, testInfo, baseURL, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAnalysis(page, `symbol=NVDA&page=intelligence&${CONTEXT_QUERY}`);
  const strip = page.getByTestId("mo-context-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("来自 WTI 实时路径");
  await expect(strip).toContainText("截至 2026年9月23日");
  await expect(strip).toContainText("知识截止 2026年8月31日");
  const proofDir = path.join(process.cwd(), "e2e/proof/mo-context-strip");
  mkdirSync(proofDir, { recursive: true });
  await captureContextProof(page, proofDir, testInfo, "desktop-analysis", "zh");
  await expect(page.locator("body")).toHaveCSS("overflow", "visible");

  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(strip).toBeVisible();
  await expect(page.locator(".analysis-shell")).toHaveCSS("overflow", "hidden");
  await captureContextProof(page, proofDir, testInfo, "tablet-analysis", "zh");
  await expect(page.locator(".analysis-shell")).toHaveCSS("overflow-x", "hidden");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(strip).toBeVisible();
  await expect(page.locator(".analysis-shell")).toHaveCSS("overflow-x", "hidden");
  await captureContextProof(page, proofDir, testInfo, "mobile-analysis", "zh");

  await page.goto(`/analysis?view=theses&symbol=NVDA&${CONTEXT_QUERY}`);
  await expect(page.getByTestId("thesis-workspace")).toBeVisible({ timeout: 45_000 });
  const thesisStrip = page.getByTestId("mo-context-strip");
  await expect(thesisStrip).toBeVisible();
  await expect(thesisStrip).toContainText("返回 WTI 实时路径");
  await expect(page.locator("html")).toHaveCSS("overflow-x", "hidden");
  await captureContextProof(page, proofDir, testInfo, "mobile-thesis", "zh");
});

test("the transmission context strip has proof captures", async ({ page, baseURL, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAnalysis(page, `symbol=NVDA&page=intelligence&${TRANSMISSION_QUERY}`);
  const desktopStrip = page.getByTestId("mo-context-strip");
  await expect(desktopStrip).toBeVisible();
  await expect(desktopStrip.getByRole("link")).toHaveAttribute("href", TRANSMISSION_RETURN_HREF);
  await expect(desktopStrip).toContainText("Opened from Transmission");
  const proofDir = path.join(process.cwd(), "e2e/proof/mo-context-strip");
  mkdirSync(proofDir, { recursive: true });
  await captureContextProof(page, proofDir, testInfo, "desktop-analysis-transmission", "en");

  const mobilePage = await browser.newPage();
  try {
    await prepare(mobilePage, testInfo, baseURL, true);
    await mobilePage.setViewportSize({ width: 390, height: 844 });
    await openAnalysis(mobilePage, `symbol=NVDA&page=intelligence&${TRANSMISSION_QUERY}`);
    const mobileStrip = mobilePage.getByTestId("mo-context-strip");
    await expect(mobileStrip).toBeVisible();
    await expect(mobileStrip.getByRole("link")).toHaveAttribute("href", TRANSMISSION_RETURN_HREF);
    await expect(mobileStrip).toContainText("来自传导");
    await captureContextProof(mobilePage, proofDir, testInfo, "mobile-analysis-transmission", "zh");
  } finally {
    await mobilePage.close();
  }
});

for (const [name, query] of [
  ["duplicate", "symbol=NVDA&page=intelligence&mo_from=ontology&mo_chain=one&mo_chain=two"],
  ["impossible date", `symbol=NVDA&page=intelligence&mo_from=ontology&mo_chain=context-chain&mo_asof=2026-02-30`],
  ["invalid from value", "symbol=NVDA&page=intelligence&mo_from=Transmission&mo_chain=context-chain"],
] as const) {
  test(`invalid_from_values_still_void: malformed ${name} context opens company research without a strip`, async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
    await prepare(page, testInfo, baseURL);
    await openAnalysis(page, query);
    await expect(page.locator(".analysis-context-bar")).toBeVisible();
    await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
  });
}

test("a refreshed Thesis deep link reconstructs the strip and return link", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  const createResponse = await page.request.post("/api/theses", { data: {
    action: "create",
    clientRequestId: "a1000000-0000-4000-8000-00000000b1b2",
    subject: {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key: "NVDA", identityState: "listing_scoped", listing: { symbol: "NVDA", mic: null, securityId: null },
      companyId: null, display: "NVDA · listing scoped",
    },
    content: {
      schema: "mastermind.thesis-content/v1", title: "Refreshed deep link",
      statement: "This thesis is opened directly with valid context.", catalysts: [], falsifiers: [],
      risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
    },
  } });
  if (!createResponse.ok()) throw new Error(`The thesis could not be created (${createResponse.status()}): ${await createResponse.text()}.`);
  const thesisId = ((await createResponse.json()) as { thesisId: string }).thesisId;
  await page.goto(`/analysis?view=theses&symbol=NVDA&thesis=${thesisId}&${CONTEXT_QUERY}`);
  await expect(page.getByText("Version 1 · Current")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();
  await expect(page.getByTestId("mo-context-strip").getByRole("link", { name: "Back to WTI Live Path" })).toHaveAttribute("href", RETURN_HREF);
});

test("leaving Analysis and returning without context shows no persisted strip", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await openAnalysis(page, `symbol=NVDA&page=intelligence&${CONTEXT_QUERY}`);
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await page.getByRole("button", { name: "Back to chart" }).click();
  await expect(page).toHaveURL(/\/terminal\?symbol=NVDA/);
  await page.goto("/analysis?symbol=NVDA");
  await expect(page.locator(".analysis-shell")).toBeVisible();
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
});

test("reopening an existing thesis of the same company keeps the Transmission context", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  const apiPayloads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiPayloads.push(`${request.url()} ${request.postData() ?? ""}`);
    }
  });
  await createFixtureThesis(page, "a1000000-0000-4000-8000-00000000c0de", "NVDA", "Same-company reopen thesis");
  await createFixtureThesis(page, "a1000000-0000-4000-8000-00000000c1de", "MSFT", "Another company reopen thesis");

  await page.goto(`/analysis?view=theses&symbol=NVDA&${TRANSMISSION_QUERY}`);
  await expect(page.getByTestId("thesis-workspace")).toBeVisible({ timeout: 45_000 });
  const strip = page.getByTestId("mo-context-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByRole("link", { name: "Back to Transmission" })).toHaveAttribute("href", TRANSMISSION_RETURN_HREF);

  // Reopen an EXISTING thesis of the SAME company from the list: the transient context
  // and its return link must survive (this used to strip every mo_* key unconditionally).
  await page.getByRole("button", { name: "Same-company reopen thesis" }).click();
  await expect(page.getByText("Version 1 · Current")).toBeVisible({ timeout: 30_000 });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Opened from Transmission");
  await expect(strip.getByRole("link", { name: "Back to Transmission" })).toHaveAttribute("href", TRANSMISSION_RETURN_HREF);
  expectTransmissionContextParams(new URL(page.url()));

  // Another company's thesis clears it — no flash, no stale strip, no keys in the URL.
  await page.getByRole("button", { name: "Another company reopen thesis" }).click();
  await expect(page.getByText("MSFT · Listing-scoped identity")).toBeVisible({ timeout: 30_000 });
  await expect(strip).toHaveCount(0);
  expect([...new URL(page.url()).searchParams.keys()].filter((key) => key.startsWith("mo_"))).toEqual([]);

  // Browser Back returns to the confirmed same-company entry, context still honest.
  await page.goBack();
  await expect(page.getByText("Version 1 · Current")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();
  expectTransmissionContextParams(new URL(page.url()));
  expectCapturedThesisPayloads(apiPayloads);
});

test("the natural saved-thesis path retains context through reload and history at all three sizes", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "This case cycles the six language and viewport cells.");
  await prepare(page, testInfo, baseURL);
  await createFixtureThesis(page, "a1000000-0000-4000-8000-00000000c2de", "NVDA", "Responsive reopen thesis");
  const proofDir = path.join(process.cwd(), "e2e/proof/mo-context-strip");
  mkdirSync(proofDir, { recursive: true });

  const verify = async (workspace: Page, locale: "en" | "zh", width: number, height: number) => {
    await workspace.setViewportSize({ width, height });
    await workspace.goto(`/analysis?view=theses&symbol=NVDA&${TRANSMISSION_QUERY}`);
    const strip = workspace.getByTestId("mo-context-strip");
    await expect(strip).toBeVisible({ timeout: 45_000 });
    if (width === 390) {
      await workspace.getByRole("button", { name: locale === "zh" ? "打开已保存的论点" : "Open saved theses" }).click();
      await expect(workspace.getByTestId("thesis-workspace")).toHaveAttribute("data-mobile-pane", "list");
      await expect(strip).toBeVisible();
    }
    await workspace.getByRole("button", { name: "Responsive reopen thesis" }).click();
    const currentVersion = locale === "zh" ? "版本 1 · 当前" : "Version 1 · Current";
    await expect(workspace.getByText(currentVersion)).toBeVisible({ timeout: 30_000 });
    await expect(strip).toBeVisible();
    expect(new URL(workspace.url()).searchParams.get("symbol")).toBe("NVDA");
    expectTransmissionContextParams(new URL(workspace.url()));
    // Reload the actual selected URL; do not manufacture a symbol-bearing deep link.
    await workspace.reload();
    await expect(workspace.getByText(currentVersion)).toBeVisible({ timeout: 30_000 });
    await expect(strip).toBeVisible();
    await workspace.goBack();
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await expect(workspace.getByText(currentVersion)).toHaveCount(0);
    await expect(workspace.getByRole("textbox", { name: locale === "zh" ? "标的" : "Subject", exact: true })).toHaveValue("NVDA");
    await workspace.goForward();
    await expect(workspace.getByText(currentVersion)).toBeVisible({ timeout: 30_000 });
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("link", { name: locale === "zh" ? "返回传导" : "Back to Transmission" }))
      .toHaveAttribute("href", TRANSMISSION_RETURN_HREF);
    expectTransmissionContextParams(new URL(workspace.url()));
    expect(await workspace.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await workspace.screenshot({ path: proofShotPath(proofDir, testInfo, `reopen-thesis-${width}`, locale), fullPage: true });
  };

  for (const [width, height] of [[1440, 900], [820, 1180], [390, 844]]) await verify(page, "en", width, height);
  const zhPage = await browser.newPage();
  try {
    await prepare(zhPage, testInfo, baseURL, true);
    for (const [width, height] of [[1440, 900], [820, 1180], [390, 844]]) await verify(zhPage, "zh", width, height);
  } finally {
    await zhPage.close();
  }
});


test("rapid Back and Forward during a lazy mount settles on the current thesis URL", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The remount race is independent of viewport.");
  await prepare(page, testInfo, baseURL);
  await createFixtureThesis(page, "a1000000-0000-4000-8000-00000000c3de", "NVDA", "Rapid history thesis");
  await page.goto(`/analysis?view=theses&symbol=NVDA&${TRANSMISSION_QUERY}`);
  await page.getByRole("button", { name: "Rapid history thesis" }).click();
  await expect(page.getByText("Version 1 · Current")).toBeVisible();
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();
  const selectedUrl = page.url();
  await page.reload();
  await expect(page.getByText("Version 1 · Current")).toBeVisible();
  await page.goBack();
  // Deliberately reverse before the new workspace finishes its lazy mount.
  await page.goForward();
  await expect(page).toHaveURL(selectedUrl);
  await expect(page.getByText("Version 1 · Current")).toBeVisible();
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();
});
