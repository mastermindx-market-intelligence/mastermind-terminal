import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

test.setTimeout(120_000);

const CONTEXT_QUERY = "mo_from=ontology&mo_chain=context-chain&mo_path_rev=3&mo_focus=context-node&mo_asof=2026-09-23&mo_kc=2026-08-31";
const RETURN_HREF = "https://www.mastermind-x.com/ontology.html?rev=3#ox-leg-context-node";

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
  await expect(page.locator(".analysis-shell")).toBeVisible({ timeout: 45_000 });
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

function proofShotPath(proofDir: string, testInfo: TestInfo, name: string, locale: "en" | "zh") {
  const suffix = locale === "zh" ? "-zh" : "";
  return path.join(proofDir, `${testInfo.project.name}-${name}${suffix}.png`);
}

function expectContextParams(url: URL) {
  expect(url.searchParams.get("mo_from")).toBe("ontology");
  expect(url.searchParams.get("mo_chain")).toBe("context-chain");
  expect(url.searchParams.get("mo_path_rev")).toBe("3");
  expect(url.searchParams.get("mo_focus")).toBe("context-node");
  expect(url.searchParams.get("mo_asof")).toBe("2026-09-23");
  expect(url.searchParams.get("mo_kc")).toBe("2026-08-31");
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

  await openAnalysis(page, `symbol=NVDA&page=intelligence&${CONTEXT_QUERY}`);
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
  await page.getByRole("button", { name: "New thesis" }).click();
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

test("changing the symbol clears every MarketOntology key and removes the strip", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The MarketOntology context contract is scoped to the desktop project.");
  await prepare(page, testInfo, baseURL);
  await openAnalysis(page, `symbol=NVDA&page=intelligence&${CONTEXT_QUERY}&mo_channel=context-channel&mo_unknown=yes`);
  await expect(page.getByTestId("mo-context-strip")).toBeVisible();

  await pickSymbol(page, "MSFT");
  await expect(page.locator(".analysis-shell")).toContainText("MSFT");
  await expect(page.getByTestId("mo-context-strip")).toHaveCount(0);
  const url = new URL(page.url());
  expect([...url.searchParams.keys()].filter((key) => key.startsWith("mo_"))).toEqual([]);
  expect(url.searchParams.get("symbol")).toBe("MSFT");
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
  await page.screenshot({ path: proofShotPath(proofDir, testInfo, "desktop-analysis", "zh"), fullPage: true });
  await expect(page.locator("body")).toHaveCSS("overflow", "visible");

  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(strip).toBeVisible();
  await expect(page.locator(".analysis-shell")).toHaveCSS("overflow", "hidden");
  await page.screenshot({ path: proofShotPath(proofDir, testInfo, "tablet-analysis", "zh"), fullPage: true });
  await expect(page.locator(".analysis-shell")).toHaveCSS("overflow-x", "hidden");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(strip).toBeVisible();
  await expect(page.locator(".analysis-shell")).toHaveCSS("overflow-x", "hidden");
  await page.screenshot({ path: proofShotPath(proofDir, testInfo, "mobile-analysis", "zh"), fullPage: true });

  await page.goto(`/analysis?view=theses&symbol=NVDA&${CONTEXT_QUERY}`);
  await expect(page.getByTestId("thesis-workspace")).toBeVisible({ timeout: 45_000 });
  const thesisStrip = page.getByTestId("mo-context-strip");
  await expect(thesisStrip).toBeVisible();
  await expect(thesisStrip).toContainText("返回 WTI 实时路径");
  await expect(page.locator("html")).toHaveCSS("overflow-x", "hidden");
  await page.screenshot({ path: proofShotPath(proofDir, testInfo, "mobile-thesis", "zh"), fullPage: true });
});

for (const [name, query] of [
  ["duplicate", "symbol=NVDA&page=intelligence&mo_from=ontology&mo_chain=one&mo_chain=two"],
  ["impossible date", `symbol=NVDA&page=intelligence&mo_from=ontology&mo_chain=context-chain&mo_asof=2026-02-30`],
  ["wrong source", "symbol=NVDA&page=intelligence&mo_from=transmission&mo_chain=context-chain"],
] as const) {
  test(`malformed ${name} context opens company research without a strip`, async ({ page, baseURL }, testInfo) => {
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
  await page.goto(`/analysis?view=theses&thesis=${thesisId}&${CONTEXT_QUERY}`);
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
