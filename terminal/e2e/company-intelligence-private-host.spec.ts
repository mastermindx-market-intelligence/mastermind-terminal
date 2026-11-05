import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  privateHostFixtures, privateContextPath, privateSelectionsPath, privateFactPath,
  privateError, ISSUER, GENERATION, FACT_HASH, EDITION_HASH, OBSERVED_AT,
} from "./fixtures/companyIntelligencePrivateHost";

const PRIVATE_PREFIX = "/api/company-intelligence/private/";
const HOSTS = {
  chart: "/terminal?symbol=NVDA&pane=intelligence",
  dossier: "/terminal?symbol=NVDA&shell=app&dossier=1&pane=intelligence",
  analysis: "/analysis?symbol=NVDA&page=intelligence",
} as const;
type Host = keyof typeof HOSTS;
type Scenario = "ready" | "metadata" | "empty";
const privatePanel = (page: Page) => page.locator(".fin-body section[data-presentation]");
const product = (ordinal: number) => "Host verification product " + ordinal;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function installFixtures(page: Page, scenario: Scenario = "ready") {
  const fx = privateHostFixtures(scenario === "empty" ? 0 : 2);
  const reads: string[] = [];
  const unexpected: string[] = [];
  const held = new Map<string, ReturnType<typeof deferred>>();
  // Install before every navigation. No private request may pass to the live BFF.
  await page.route("**/api/company-intelligence/private/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const key = url.pathname + url.search;
    reads.push(key);
    if (held.has(key)) await held.get(key)!.promise;
    const headers = { "cache-control": "private, no-store" };
    if (key === privateContextPath) return route.fulfill({ headers, json: fx.context });
    if (key === privateSelectionsPath) {
      return scenario === "metadata"
        ? route.fulfill({ status: 503, headers, json: privateError("PRIVATE_SOURCE_UNAVAILABLE") })
        : route.fulfill({ headers, json: fx.selections });
    }
    const id = fx.ids.find(candidate => privateFactPath(candidate) === key);
    if (id) return route.fulfill({ headers, json: fx.facts.get(id) });
    unexpected.push(key);
    await route.abort("blockedbyclient");
  });
  // A failed public source must not suppress this independently qualified private view.
  await page.route("**/api/company-intelligence/NVDA**", route => route.fulfill({
    status: 503, json: { ok: false, state: "error", error: { code: "source_unavailable", retryable: false } },
  }));
  await page.route("https://www.mastermind-x.com/mm_brain.js", route =>
    route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/api/event-workspace/**", route => route.fulfill({
    status: 404, json: { ok: false, state: "error", available: false, error: { code: "not_found", retryable: false } },
  }));
  return { fx, reads, unexpected, held };
}

async function initialize(page: Page, testInfo: TestInfo, lang: "en" | "zh" = "en") {
  page.setDefaultTimeout(20_000);
  const origin = String(testInfo.project.use.baseURL ?? "http://127.0.0.1:" + (process.env.TERMINAL_E2E_PORT || 3108));
  await page.context().addCookies([
    { name: "mm_e2e_rs30", value: "1", url: origin },
    { name: "mm_e2e_wl", value: "private-host-" + testInfo.testId, url: origin },
  ]);
  await page.addInitScript(language => {
    localStorage.setItem("mm.lang", language);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
  }, lang);
}

async function openHost(page: Page, host: Host) {
  await page.goto(HOSTS[host]);
  // The measured first tablet host mount took 5.23s; use the fixture action budget.
  await expect(page.locator('[data-fin-family="intelligence"]')).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  await expect(privatePanel(page)).toHaveCount(1);
}

async function expectReady(page: Page, ordinal = 1) {
  const panel = privatePanel(page);
  await expect(panel.getByText(product(ordinal), { exact: true })).toBeVisible();
  await expect(panel.getByText("Example compute platform", { exact: true })).toBeVisible();
  await expect(panel).toContainText("2024-02-26");
  await expect(panel).not.toContainText("2024-02-26T00:00:00");
  await expect(panel.locator("details")).not.toHaveAttribute("open", "");
  await expect(panel.getByText(OBSERVED_AT, { exact: true })).not.toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, host: Host, lang: string, theme: string, reads: string[]) {
  if (process.env.PRIVATE_HOST_CROPS !== "1") return;
  const dir = path.resolve("docs/pr-crops/company-intelligence-private-host");
  mkdirSync(dir, { recursive: true });
  const viewport = page.viewportSize()!;
  const stem = host + "-" + viewport.width + "-" + lang + "-" + theme;
  const png = path.join(dir, stem + ".png");
  await privatePanel(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: png, fullPage: false, animations: "disabled" });
  const sources = [
    "components/TerminalShell.tsx", "components/fin/MegaPane.tsx",
    "components/workspaces/AnalysisWorkspace.tsx", "components/fin/CompanyIntelligencePrivate.tsx",
    "components/fin/CompanyIntelligencePrivatePanel.tsx", "lib/usePrivateCompanyIntelligence.ts",
    "lib/companyIntelligencePrivate.ts", "e2e/company-intelligence-private-host.spec.ts",
    "e2e/fixtures/companyIntelligencePrivateHost.ts",
  ];
  const hashes = Object.fromEntries(sources.map(file => [
    "terminal/" + file, createHash("sha256").update(readFileSync(file)).digest("hex"),
  ]));
  writeFileSync(path.join(dir, stem + ".json"), JSON.stringify({
    proof: "Actual Terminal host integration, browser-fixture data; private BFF authority separately covered by unit suites.",
    capturedAtHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    host, route: HOSTS[host], viewport, lang,
    theme: theme === "light" ? "controlled html data-theme=light variant; not a saved-preference journey" : "actual dark host",
    privatePresentation: await privatePanel(page).getAttribute("data-presentation"),
    capturedAt: new Date().toISOString(), sourceHashes: hashes, privateReads: reads,
    png: path.basename(png), sha256: createHash("sha256").update(readFileSync(png)).digest("hex"),
    productionApiAcceptance: false, liveEntitlementAcceptance: false,
  }, null, 2) + "\n");
  await testInfo.attach(stem, { path: png, contentType: "image/png" });
}

for (const lang of ["en", "zh"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test("private hosts retain source references " + lang + " " + theme, async ({ page }, testInfo) => {
      await initialize(page, testInfo, lang);
      const wire = await installFixtures(page);
      for (const host of Object.keys(HOSTS) as Host[]) {
        const start = wire.reads.length;
        await openHost(page, host);
        await expectReady(page);
        expect(new URL(page.url()).searchParams.get(host === "analysis" ? "page" : "pane")).toBe("intelligence");
        await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
        // Terminal starts dark. This supplementary variant exercises the existing CSS
        // attribute surface; it does not claim a light-preference or light-panel mount.
        if (theme === "light") await page.evaluate(() =>
          document.documentElement.setAttribute("data-theme", "light"));
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const panel = privatePanel(page);
        await panel.locator("summary").click();
        await expect(panel).toContainText(OBSERVED_AT);
        await expect(panel).toContainText(ISSUER);
        await expect(panel).toContainText(wire.fx.identityReference.sha256);
        await expect(panel).toContainText(FACT_HASH);
        await expect(panel).toContainText(EDITION_HASH);
        await expect(panel).toContainText(GENERATION);
        const widths = await page.evaluate(() => ({
          client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
        }));
        expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
        const reads = wire.reads.slice(start);
        expect(reads).toContain(privateContextPath);
        expect(reads).toContain(privateSelectionsPath);
        expect(reads).toContain(privateFactPath(wire.fx.ids[0]));
        expect(wire.unexpected).toEqual([]);
        await capture(page, testInfo, host, lang, theme, reads);
      }
    });
  }
}

for (const scenario of ["metadata", "empty"] as const) {
  test("private host keeps " + scenario + " distinct from ready", async ({ page }, testInfo) => {
    await initialize(page, testInfo);
    const wire = await installFixtures(page, scenario);
    await openHost(page, "analysis");
    await expect(privatePanel(page).getByRole("status")).toHaveText(scenario === "metadata"
      ? "Company identity is available; private disclosures are unavailable."
      : "No product integrations in the current selection.");
    await expect(privatePanel(page).locator("details")).toHaveCount(0);
    await expect(privatePanel(page)).not.toContainText(product(1));
    expect(wire.reads.some(key => key.startsWith(PRIVATE_PREFIX + "product-integrations/"))).toBe(false);
    expect(wire.unexpected).toEqual([]);
  });
}

test("changing a selected fact clears old fields before the new fact settles", async ({ page }, testInfo) => {
  await initialize(page, testInfo);
  const wire = await installFixtures(page);
  await openHost(page, "analysis");
  await expectReady(page);
  await privatePanel(page).locator("summary").click();
  const gate = deferred();
  wire.held.set(privateFactPath(wire.fx.ids[1]), gate);
  await privatePanel(page).locator("select").selectOption(wire.fx.ids[1]);
  await expect(privatePanel(page)).not.toContainText(product(1));
  await expect(privatePanel(page).locator("details")).toHaveCount(0);
  gate.resolve();
  await expectReady(page, 2);
  expect(wire.unexpected).toEqual([]);
});

test("leaving Intelligence discards a late fact and reopening starts fresh", async ({ page }, testInfo) => {
  await initialize(page, testInfo);
  const wire = await installFixtures(page);
  const gate = deferred();
  const factPath = privateFactPath(wire.fx.ids[0]);
  wire.held.set(factPath, gate);
  await openHost(page, "analysis");
  await expect.poll(() => wire.reads.includes(factPath)).toBe(true);
  // Actual navigation unmounts the private host; no direct React/test seam.
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(privatePanel(page)).toHaveCount(0);
  wire.held.delete(factPath);
  gate.resolve();
  await expect(privatePanel(page)).toHaveCount(0);
  const readsBeforeReopen = wire.reads.length;
  await openHost(page, "analysis");
  await expectReady(page);
  expect(wire.reads.slice(readsBeforeReopen)).toContain(privateContextPath);
  expect(wire.unexpected).toEqual([]);
});

test("same-email fixture accounts receive separate private chains", async ({ page }, testInfo) => {
  await initialize(page, testInfo);
  const wire = await installFixtures(page);
  await openHost(page, "chart");
  await expectReady(page);
  expect(new URL(page.url()).searchParams.get("pane")).toBe("intelligence");
  const previousReads = wire.reads.length;
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "mm_e2e_wl", value: "different-private-owner-" + testInfo.testId, url: origin }]);
  const gate = deferred();
  wire.held.set(privateContextPath, gate);
  await page.reload();
  await expect(page.locator('[data-fin-family="intelligence"]')).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  await expect(privatePanel(page)).not.toContainText(product(1));
  await expect.poll(() => wire.reads.length).toBeGreaterThan(previousReads);
  gate.resolve();
  await expectReady(page);
  expect(wire.reads.slice(previousReads)).toContain(privateContextPath);
  expect(wire.unexpected).toEqual([]);
});
