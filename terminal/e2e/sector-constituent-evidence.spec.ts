import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { sectorFixture } from "./fixtures/sector-company-v3";

/**
 * Sector fund constituent → the company's existing private evidence.
 *
 * The sector feeds come from the repository's own browser-only historical fixture, and the
 * private chain is answered by a synthetic owner fixture in this file. Nothing here is a
 * production claim: the private payloads are closed synthetic records, the account is the
 * existing Playwright fixture identity, and no authentication decision is bypassed — the
 * private route is intercepted at the network boundary exactly as the sector feeds are.
 */
test.setTimeout(90000);

const RECEIPT_SCHEMA = "company_intelligence.current_issuer_identity/v1";
const CONTEXT_SCHEMA = "company_intelligence.private_company_context/v1";
const SELECTIONS_SCHEMA = "company_intelligence.private_issuer_selections/v1";
const PRODUCT_SCHEMA = "company_intelligence.private_product_integration/v2";
const FACT_SCHEMA = "company_intelligence.product_integration_fact/v1";
const EDITION_SCHEMA = "company_intelligence.issuer_disclosure_edition/v1";
const GENERATION = "gen-2026-10-11";

/** The holdings this synthetic owner answers for. */
const OWNED_SYMBOLS = ["MU", "NVDA"] as const;

const SECTOR_URL = "/discover?tab=sectors&sector=xlk&group=semiconductors";

function canonicalJson(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort()
      .map(key => JSON.stringify(key) + ":" + canonicalJson(record[key]));
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(value);
}

// The owner side of the synthetic fixture. The browser never constructs an issuer id, an
// issuer-name mapping or a fact id: it sends the exact listed ticker and reads what the
// owner answers.
function ownerIssuer(symbol: string): string {
  return "ISS:US-XNAS-E2E" + createHash("sha256").update(symbol).digest("hex").slice(0, 8).toUpperCase();
}
function ownerFactId(symbol: string): string {
  return "integration:" + createHash("sha256").update(symbol).digest("hex").slice(0, 64);
}
function receiptBody(issuerId: string): Record<string, unknown> {
  return {
    schema: RECEIPT_SCHEMA, identity_mode: "current", issuer_id: issuerId, evidenced_cik: "0000000001",
    source_commit: "b".repeat(40),
    sources: {
      security_master: { sha256: "1".repeat(64), byte_length: 512 },
      vendor_aliases: { sha256: "2".repeat(64), byte_length: 512 },
      issuer_master: { sha256: "3".repeat(64), byte_length: 512 },
    },
    evidence_source: "sec_company_tickers", evidence_snapshot: "2026-10-10",
  };
}
function receiptReference(issuerId: string): { sha256: string; byte_length: number } {
  const bytes = Buffer.from(canonicalJson(receiptBody(issuerId)), "utf8");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), byte_length: bytes.length };
}
function contextFixture(symbol: string): Record<string, unknown> {
  const issuerId = ownerIssuer(symbol);
  const reference = receiptReference(issuerId);
  return {
    schema: CONTEXT_SCHEMA, identity_mode: "current",
    query: { namespace: "store", symbol },
    security_id: "SEC:US-XNAS-" + symbol,
    issuer_binding: {
      issuer_id: issuerId, evidenced_cik: "0000000001",
      identity_snapshot_reference: { schema: RECEIPT_SCHEMA, sha256: reference.sha256, byte_length: reference.byte_length },
    },
    identity_receipt: receiptBody(issuerId),
  };
}
function selectionsFixture(symbol: string): Record<string, unknown> {
  const context = contextFixture(symbol);
  return {
    schema: SELECTIONS_SCHEMA, generation: GENERATION, identity_mode: "current",
    issuer_role: "subject_disclosing_company",
    issuer_binding: JSON.parse(JSON.stringify(context.issuer_binding)) as unknown,
    selections: symbol === "MU" ? [{
      fact_id: ownerFactId(symbol),
      fact_reference: { schema: FACT_SCHEMA, sha256: "a".repeat(64), byte_length: 512 },
      edition_reference: { schema: EDITION_SCHEMA, sha256: "e".repeat(64), byte_length: 480 },
      kind: "product_integration", lifecycle: "planned",
    }] : [],
  };
}
function factFixture(symbol: string): Record<string, unknown> {
  return {
    schema: PRODUCT_SCHEMA,
    fact: {
      fact_id: ownerFactId(symbol), kind: "product_integration", lifecycle: "planned",
      subject_id: ownerIssuer(symbol), revision: 3,
      product: "24GB 8H HBM3E", platform: "NVIDIA H200",
    },
    reference: { schema: FACT_SCHEMA, sha256: "a".repeat(64), byte_length: 512 },
    edition: { schema: EDITION_SCHEMA, sha256: "e".repeat(64), byte_length: 480 },
    source_timing: {
      published_date: "2024-02-26", published_at: null, publication_precision: "date",
      known_at: "2024-02-26T09:05:30.123456+08:00",
    },
    generation: GENERATION, authority: "context_only",
  };
}

async function prepare(page: Page, baseURL: string | undefined, language: "en" | "zh", theme: "dark" | "light", reads: string[]): Promise<void> {
  // The same origin the Playwright config builds for this run.
  const origin = baseURL ?? `http://127.0.0.1:${process.env.TERMINAL_E2E_PORT || 3108}`;
  await page.addInitScript(lang => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement?.setAttribute("data-lang", lang);
  }, language);
  // The existing Playwright fixture identity. This is the repository's own account seam;
  // nothing about the private route's authentication or entitlement is changed here.
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: origin }]);
  await page.route("**/api/sector-intelligence?**", route => sectorFixture(route));
  await page.route("**/api/company-intelligence/private/**", async (route: Route) => {
    const url = new URL(route.request().url());
    reads.push(url.pathname + url.search);
    if (url.pathname.endsWith("/company-context")) {
      const symbol = url.searchParams.get("symbol") ?? "";
      if (!(OWNED_SYMBOLS as readonly string[]).includes(symbol)) return route.fulfill({ status: 404, json: { error: "source_unavailable" } });
      return route.fulfill({ status: 200, json: contextFixture(symbol) });
    }
    if (url.pathname.includes("/issuers/")) {
      const issuerId = decodeURIComponent(url.pathname.split("/issuers/")[1].split("/")[0]);
      const symbol = OWNED_SYMBOLS.find(candidate => ownerIssuer(candidate) === issuerId);
      if (!symbol) return route.fulfill({ status: 404, json: { error: "source_unavailable" } });
      return route.fulfill({ status: 200, json: selectionsFixture(symbol) });
    }
    const factId = decodeURIComponent(url.pathname.split("/product-integrations/")[1] ?? "");
    const symbol = OWNED_SYMBOLS.find(candidate => ownerFactId(candidate) === factId);
    if (symbol !== "MU") return route.fulfill({ status: 404, json: { error: "source_unavailable" } });
    return route.fulfill({ status: 200, json: factFixture(symbol) });
  });
  await page.goto(`${SECTOR_URL}&sectorTheme=${theme}`);
}

async function noOverflow(page: Page): Promise<void> {
  const root = page.getByTestId("sector-intelligence");
  expect(await root.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function captureEvidence(page: Page, info: TestInfo, name: string): Promise<void> {
  const directory = process.env.PSL_RECEIPT_DIR;
  if (!directory) return;
  const section = page.getByTestId("sector-constituent-evidence");
  const viewport = page.viewportSize();
  // A desktop element taller than the nested viewport cannot be captured as one
  // intact region. Keep the same desktop width and record a taller capture only.
  const tallerDesktop = viewport !== null && viewport.width >= 1000;
  if (tallerDesktop) await page.setViewportSize({ ...viewport, height: 1600 });
  try {
    await section.evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await expect(section.getByRole("heading", { level: 2 }).first()).toBeInViewport();
    const bytes = await section.screenshot({ path: `${directory}/${info.project.name}-member-${name}.png`, animations: "disabled" });
    await info.attach(`sector-member-${info.project.name}-${name}`, { body: bytes, contentType: "image/png" });
    await info.attach(`sector-member-${info.project.name}-${name}-viewport`, {
      body: JSON.stringify({ viewport: page.viewportSize(), region: await section.boundingBox() }), contentType: "application/json",
    });
  } finally {
    if (tallerDesktop) await page.setViewportSize(viewport);
  }
}

test("a listed holding opens its existing company evidence and closes back to the same sector", async ({ page, baseURL }, info) => {
  const reads: string[] = [];
  await prepare(page, baseURL, "en", "dark", reads);
  const root = page.getByTestId("sector-intelligence");
  const section = root.getByTestId("sector-constituent-evidence");
  await expect(section).toBeVisible();
  await expect(section).toContainText("XLK");
  await expect(section.getByRole("heading", { name: "Constituent company evidence", exact: true })).toBeVisible();

  // Nothing private is read before the reader opens the evidence explicitly.
  expect(reads).toEqual([]);
  await expect(section).not.toContainText("Private company context");

  const picker = section.getByLabel("Listed holding", { exact: true });
  await expect(picker).toBeVisible();
  const options = await picker.locator("option").allTextContents();
  expect(options.some(option => option.startsWith("MU · #17"))).toBe(true);
  expect(options.some(option => option.startsWith("NVDA · #1"))).toBe(true);
  await picker.selectOption("MU");

  const membership = section.getByTestId("sector-constituent-membership");
  await expect(membership).toContainText("#17");
  await expect(membership).toContainText("1.51%");
  await expect(membership).toContainText("2026-10-15");
  await expect(membership).not.toContainText("2024-02-26");
  await expect(section.getByRole("link", { name: /Open company research/ })).toHaveAttribute("href", "/analysis?symbol=MU&page=overview");

  expect(reads).toEqual([]);
  await section.getByRole("button", { name: "Open company evidence", exact: true }).click();
  await expect(section.getByTestId("sector-constituent-evidence-panel")).toContainText("Company query: MU");
  await expect(section.getByTestId("sector-constituent-evidence-panel")).toContainText("24GB 8H HBM3E");
  await expect(section.getByTestId("sector-constituent-evidence-panel")).toContainText("2024-02-26");
  expect(reads[0]).toContain("company-context?symbol=MU");
  await captureEvidence(page, info, "mu-en-dark");

  await section.getByRole("button", { name: "Close company evidence", exact: true }).click();
  await expect(section.getByTestId("sector-constituent-evidence-panel")).not.toContainText("24GB 8H HBM3E");
  await expect(section).toContainText("XLK");
  await noOverflow(page);
});

test("the Chinese light board reads the same membership record and opens the same evidence", async ({ page, baseURL }, info) => {
  const reads: string[] = [];
  await prepare(page, baseURL, "zh", "light", reads);
  const root = page.getByTestId("sector-intelligence");
  await expect(root).toHaveAttribute("data-sector-theme", "light");
  const section = root.getByTestId("sector-constituent-evidence");
  await expect(section.getByRole("heading", { name: "成分股公司证据", exact: true })).toBeVisible();
  await section.getByLabel("已列出的持仓", { exact: true }).selectOption("MU");
  await expect(section.getByTestId("sector-constituent-membership")).toContainText("#17");
  await section.getByRole("button", { name: "打开公司证据", exact: true }).click();
  await expect(section.getByTestId("sector-constituent-evidence-panel")).toContainText("公司查询: MU");
  await expect(section.locator('[data-presentation="light"]')).toBeVisible();
  await expect(section.getByTestId("sector-constituent-evidence-panel")).toContainText("24GB 8H HBM3E");
  expect(reads[0]).toContain("company-context?symbol=MU");
  await captureEvidence(page, info, "mu-zh-light");
  await noOverflow(page);
});

test("the object company does not acquire the disclosing company's planned fact", async ({ page, baseURL }) => {
  const reads: string[] = [];
  await prepare(page, baseURL, "en", "dark", reads);
  const section = page.getByTestId("sector-constituent-evidence");
  await section.getByLabel("Listed holding", { exact: true }).selectOption("NVDA");
  expect(reads).toEqual([]);
  await section.getByRole("button", { name: "Open company evidence", exact: true }).click();
  const panel = section.getByTestId("sector-constituent-evidence-panel");
  await expect(panel).toContainText("No product integrations in the current selection.");
  await expect(panel).not.toContainText("24GB 8H HBM3E");
  // Next development StrictMode can abort and reissue the initial context read.
  // Only the exact selected context and its empty issuer selection may be read;
  // an empty selection must never request any product-integration fact.
  expect([...new Set(reads)]).toEqual([
    "/api/company-intelligence/private/company-context?symbol=NVDA",
    `/api/company-intelligence/private/issuers/${encodeURIComponent(ownerIssuer("NVDA"))}/product-integrations`,
  ]);
});

test("the constituent surface keeps a narrow screen free of horizontal overflow", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const reads: string[] = [];
  await prepare(page, baseURL, "en", "dark", reads);
  const section = page.getByTestId("sector-constituent-evidence");
  await expect(section).toBeVisible();
  await section.getByLabel("Listed holding", { exact: true }).selectOption("MU");
  await section.getByRole("button", { name: "Open company evidence", exact: true }).click();
  await expect(section.getByTestId("sector-constituent-evidence-panel")).toContainText("24GB 8H HBM3E");
  await noOverflow(page);
});
