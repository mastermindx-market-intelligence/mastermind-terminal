import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { expectTapTarget } from "./tapTarget";
import { canonicalTranscriptBodySha256 } from "../lib/transcriptSearch";

// E12 — two-call transcript comparison on the Analysis Transcripts page.
//
// The archive is served by route handlers from SYNTHETIC calls written here (no corpus text is
// committed). The root commit marker is recomputed from the bodies on every request, so a test can
// "correct" a call mid-session exactly the way a republished archive would: new body, new advertised
// revision. Every assertion reads identities from the DOM (`data-call-id`, `data-body-sha256`,
// `data-segment-index`) and compares them with hashes computed here, independently of the page.

const BRAIN_SCRIPT_SRC = "https://www.mastermind-x.com/mm_brain.js";
const GENERATED_AT = "2026-08-01T00:00:00Z";
const EVIDENCE_DIR = path.join(process.cwd(), "docs", "pr-crops", "e12-transcript-compare");

type Segment = { speaker: string; role: string; text: string };
type Body = {
  schema: "mastermind.tx/v1";
  ticker: "NVDA";
  id: string;
  period: string;
  date: string;
  title: string;
  segments: Segment[];
};

const OPERATOR = "Operator";
const DATES: Record<string, string> = {
  "2026Q1": "2025-05-28",
  "2026Q2": "2025-08-27",
  "2026Q4": "2026-02-25",
  "2027Q1": "2026-05-27",
};

function body(id: string, segments: Segment[]): Body {
  return {
    schema: "mastermind.tx/v1",
    ticker: "NVDA",
    id,
    period: `Q${id.slice(5)} FY${id.slice(0, 4)}`,
    date: DATES[id],
    title: `NVIDIA Earnings Call Q${id.slice(5)} FY${id.slice(0, 4)}`,
    segments,
  };
}

const DEMAND_A = "Data center demand remains extraordinary as hyperscale customers expand accelerated computing infrastructure across every region.";
const DEMAND_A_CORRECTED = "Data center demand remains extraordinary as hyperscale customers expand accelerated computing infrastructure across every major region.";

const call2026Q1 = (demand = DEMAND_A): Body => body("2026Q1", [
  { speaker: OPERATOR, role: OPERATOR, text: "Good afternoon and welcome to the first quarter conference call." },
  { speaker: "Jensen Huang", role: "CEO", text: demand },
  { speaker: "Colette Kress", role: "CFO", text: "Revenue reached $26.0 billion, up 262%." },
  { speaker: "Colette Kress", role: "CFO", text: "Thanks. We will now transition to Q&A. Operator, please poll for questions." },
  { speaker: OPERATOR, role: OPERATOR, text: "Our first question comes from Vivek Arya with Bank of America." },
  { speaker: "Vivek Arya", role: "Analyst", text: "How should we think about networking attach rates for Spectrum-X Ethernet deployments?" },
  { speaker: "Jensen Huang", role: "CEO", text: "Spectrum-X Ethernet networking attach keeps rising with every large cluster deployment we ship." },
]);

// The adjacent fiscal call. It shares the demand wording on purpose: if it were ever substituted
// for a missing 2026Q1 it would produce plausible-looking cards, which these tests must never see.
const call2026Q2 = (): Body => body("2026Q2", [
  { speaker: "Jensen Huang", role: "CEO", text: "Data center demand remains extraordinary as hyperscale customers expand accelerated computing infrastructure." },
  { speaker: "Colette Kress", role: "CFO", text: "Revenue reached $30.0 billion, up 122%." },
]);

const call2026Q4 = (): Body => body("2026Q4", [
  { speaker: OPERATOR, role: OPERATOR, text: "Good afternoon and welcome to the fourth quarter conference call." },
  { speaker: "Jensen Huang", role: "CEO", text: "Blackwell production is ramping across many system configurations this quarter." },
  { speaker: "Colette Kress", role: "CFO", text: "We will now transition to Q&A. Operator, please poll for questions." },
  { speaker: OPERATOR, role: OPERATOR, text: "Our first question comes from Joseph Moore with Morgan Stanley." },
  { speaker: "Joseph Moore", role: "Analyst", text: "How are Blackwell systems shipping into sovereign customers in Europe?" },
  { speaker: "Jensen Huang", role: "CEO", text: "Blackwell systems are shipping to sovereign customers across Europe and Asia." },
]);

const call2027Q1 = (): Body => body("2027Q1", [
  { speaker: OPERATOR, role: OPERATOR, text: "Good afternoon and welcome to the conference call for the first quarter." },
  { speaker: "Colette Kress", role: "CFO", text: "Revenue reached $44.1 billion, up 69%." },
  { speaker: "Jensen Huang", role: "CEO", text: "Hyperscale customers keep expanding accelerated computing infrastructure, and data center demand remains extraordinary in every region." },
  { speaker: "Colette Kress", role: "CFO", text: "We will now transition to Q&A. Operator, please poll for questions." },
  { speaker: OPERATOR, role: OPERATOR, text: "Our first question comes from Joseph Moore with Morgan Stanley." },
  { speaker: "Joseph Moore", role: "Analyst", text: "Can you describe sovereign customer pipelines for Blackwell systems in Europe?" },
  { speaker: "Jensen Huang", role: "CEO", text: "Sovereign pipelines for Blackwell systems in Europe are broadening across many governments." },
]);

interface Archive {
  bodies: Map<string, Body>;
  /** Advertised revision overrides (a stale or mis-published commit marker). */
  advertise: Map<string, string>;
  /** Every transcript body the page requested, by call ID. */
  requested: string[];
}

function newArchive(): Archive {
  return {
    bodies: new Map([call2027Q1(), call2026Q4(), call2026Q2(), call2026Q1()].map((value) => [value.id, value])),
    advertise: new Map(),
    requested: [],
  };
}

async function sha(value: Body): Promise<string> {
  const hash = await canonicalTranscriptBodySha256(value);
  if (!hash) throw new Error("WebCrypto SHA-256 unavailable in the test runner");
  return hash;
}

async function rootFor(archive: Archive) {
  const ids = [...archive.bodies.keys()].sort();
  const revisions: Record<string, string> = {};
  const dates: Record<string, string> = {};
  for (const id of ids) {
    revisions[`NVDA/${id}`] = archive.advertise.get(id) ?? await sha(archive.bodies.get(id)!);
    dates[`NVDA/${id}`] = DATES[id];
  }
  return { schema: "mastermind.tx-index/v1", generated_at: GENERATED_AT, body_count: ids.length, symbols: { NVDA: ids }, revisions, dates };
}

function tickerIndexFor(archive: Archive) {
  const calls = [...archive.bodies.values()].map((value) => {
    const qa = value.segments.findIndex((segment) => segment.text.startsWith("Our first question"));
    return {
      id: value.id,
      period: value.period,
      date: value.date,
      title: value.title,
      url: `/data/tx/NVDA/${value.id}.json.gz`,
      segment_count: value.segments.length,
      speaker_count: new Set(value.segments.map((segment) => segment.speaker)).size,
      speakers: [...new Set(value.segments.map((segment) => segment.speaker))],
      qa_start: qa >= 0 ? qa : null,
      has_qa: qa >= 0,
      source: "DefeatBeta",
    };
  });
  return { schema: "mastermind.tx-symbol-index/v1", ticker: "NVDA", generated_at: GENERATED_AT, calls };
}

async function routeArchive(page: Page, archive: Archive) {
  await page.route(BRAIN_SCRIPT_SRC, (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route((url) => url.pathname === "/data/tx/index.json", async (route) => {
    await route.fulfill({ json: await rootFor(archive), headers: { "cache-control": "no-store" } });
  });
  await page.route((url) => url.pathname === "/data/tx/NVDA/index.json", async (route) => {
    await route.fulfill({ json: tickerIndexFor(archive), headers: { "cache-control": "no-store" } });
  });
  await page.route((url) => /^\/data\/tx\/NVDA\/\d{4}Q[1-4]\.json\.gz$/.test(url.pathname), async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!.replace(".json.gz", "");
    archive.requested.push(id);
    const value = archive.bodies.get(id);
    if (!value) {
      await route.fulfill({ status: 404, body: "missing" });
      return;
    }
    await route.fulfill({ body: gzipSync(JSON.stringify(value)), headers: { "content-type": "application/gzip", "cache-control": "no-store" } });
  });
}

/** A clipboard that records what the page copies (the browser's real one needs a permission). */
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied.push(value);
        },
        readText: async () => copied[copied.length - 1] ?? "",
      },
    });
  });
}

async function lastCopied(page: Page): Promise<string> {
  return page.evaluate(() => {
    const copied = (window as unknown as { __copied: string[] }).__copied;
    return copied[copied.length - 1] ?? "";
  });
}

async function openTranscripts(page: Page, query = "") {
  await page.goto(`/analysis?symbol=NVDA&page=transcripts${query}`);
  await expect(page.locator(".fin-transcripts")).toBeVisible({ timeout: 30_000 });
}

async function openCompare(page: Page, label = "Compare two calls") {
  const entry = page.getByTestId("transcript-compare-entry");
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await entry.getByRole("button", { name: label }).click();
  const panel = page.getByTestId("transcript-compare");
  await expect(panel).toBeVisible();
  return panel;
}

async function expectNoDocumentOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 640;

/** On phones only one column is on screen; pick it through the tab control the user would use. */
async function showSide(page: Page, panel: Locator, side: "a" | "b") {
  if (!isPhone(page)) return;
  await panel.getByRole("tablist", { name: "Choose which call to read" }).getByRole("tab").nth(side === "a" ? 0 : 1).click();
  await expect(panel.locator(`[data-compare-column="${side}"]`)).toBeVisible();
}

async function cardIdentities(panel: Locator, side: "a" | "b") {
  return panel.locator(`article[data-compare-side="${side}"]`).evaluateAll((cards) => cards.map((card) => ({
    call: card.getAttribute("data-call-id"),
    sha: card.getAttribute("data-body-sha256"),
    segment: Number(card.getAttribute("data-segment-index")),
    span: card.getAttribute("data-span-id"),
  })));
}

test.describe("E12 two-call transcript comparison", () => {
  let archive: Archive;

  test.beforeEach(async ({ page }) => {
    archive = newArchive();
    await routeArchive(page, archive);
    await stubClipboard(page);
  });

  test("binds each column to its exact call and revision, side by side on wide screens and switchable on phones", async ({ page }) => {
    await openTranscripts(page);
    const panel = await openCompare(page);
    await expect(panel.getByRole("heading", { name: "Two calls, side by side" })).toBeFocused();
    await expect(panel.getByLabel("Call A")).toHaveValue("2026Q1");
    await expect(panel.getByLabel("Call B")).toHaveValue("2027Q1");

    const shaA = await sha(call2026Q1());
    const shaB = await sha(call2027Q1());
    await expect(panel.locator('article[data-compare-side="a"]')).toHaveCount(7);
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(7);
    await expect.poll(async () => (await cardIdentities(panel, "a")).every((card) => card.span?.startsWith("txs1_"))).toBe(true);
    const a = await cardIdentities(panel, "a");
    const b = await cardIdentities(panel, "b");
    expect(a.map((card) => card.segment)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(a.map((card) => `${card.call}|${card.sha}`))).toEqual(new Set([`2026Q1|${shaA}`]));
    expect(new Set(b.map((card) => `${card.call}|${card.sha}`))).toEqual(new Set([`2027Q1|${shaB}`]));
    expect(new Set([...a, ...b].map((card) => card.span)).size).toBe(14);
    // The adjacent fiscal call is never read, let alone shown.
    await expect(panel.locator('article[data-call-id="2026Q2"]')).toHaveCount(0);
    expect(archive.requested).not.toContain("2026Q2");

    for (const side of ["a", "b"] as const) {
      const column = panel.locator(`[data-compare-column="${side}"]`);
      await expect(column).toContainText("Raw source text · not translated");
      await expect(column).toContainText(`Revision ${(side === "a" ? shaA : shaB).slice(0, 12)}`);
    }
    await expect(panel).toContainText("DefeatBeta transcript corpus as normalized and indexed by Mastermind");
    await expect(panel).toContainText("never transcript text");

    const columnA = panel.locator('[data-compare-column="a"]');
    const columnB = panel.locator('[data-compare-column="b"]');
    const tabs = panel.getByRole("tablist", { name: "Choose which call to read" });
    if (isPhone(page)) {
      await expect(tabs).toBeVisible();
      await expect(columnB).toBeVisible();
      await expect(columnA).toBeHidden();
      const tabA = tabs.getByRole("tab", { name: "A · Q1 FY2026" });
      const tabB = tabs.getByRole("tab", { name: "B · Q1 FY2027" });
      await expect(tabB).toHaveAttribute("aria-selected", "true");
      await expectTapTarget(tabA, { height: 40 });
      await tabA.click();
      await expect(columnA).toBeVisible();
      await expect(columnB).toBeHidden();
      await expect(tabA).toHaveAttribute("aria-selected", "true");
      await tabA.focus();
      await page.keyboard.press("ArrowRight");
      await expect(tabB).toBeFocused();
      await expect(columnB).toBeVisible();
      await expect(columnA).toBeHidden();
      await page.keyboard.press("Home");
      await expect(tabA).toBeFocused();
      await expect(columnA).toBeVisible();
      await expectTapTarget(columnA.getByRole("button", { name: /^Open segment 1 of Q1 FY2026/ }), { height: 40 });
    } else {
      await expect(tabs).toBeHidden();
      await expect(columnA).toBeVisible();
      await expect(columnB).toBeVisible();
      const boxA = (await columnA.boundingBox())!;
      const boxB = (await columnB.boundingBox())!;
      expect(boxA.x + boxA.width).toBeLessThanOrEqual(boxB.x + 1);
      expect(Math.abs(boxA.y - boxB.y)).toBeLessThan(2);
    }
    await expectNoDocumentOverflow(page);
  });

  test("keyboard topic search filters both calls literally and jumps to the exact source segment", async ({ page }) => {
    await openTranscripts(page);
    const panel = await openCompare(page);
    const topic = panel.getByRole("textbox", { name: "Topic" });
    await topic.focus();
    await page.keyboard.type("data center demand");

    await expect(panel.locator('article[data-compare-side="a"]')).toHaveCount(1);
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(1);
    await expect(panel.locator('article[data-compare-side="a"]')).toHaveAttribute("data-segment-index", "1");
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveAttribute("data-segment-index", "2");
    await expect(panel.locator('article[data-compare-side="a"] mark')).toHaveText("Data center demand");
    await expect(panel.locator('article[data-compare-side="b"] mark')).toHaveText("data center demand");
    await expect(panel.locator('[data-compare-column="b"]')).toContainText("1 of 7 passages");

    // Exact speaker filter: a speaker absent from one call leaves that column empty and says so.
    await topic.fill("");
    await panel.getByRole("combobox", { name: "Speaker" }).selectOption("Joseph Moore");
    await expect(panel.locator('[data-compare-column="a"] [data-compare-state="speaker-absent"]')).toContainText("Joseph Moore has no turn in Q1 FY2026");
    await expect(panel.locator('article[data-compare-side="a"]')).toHaveCount(0);
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(1);
    await panel.getByRole("combobox", { name: "Speaker" }).selectOption("");

    // Section filter uses the verified Q&A boundary of each call.
    await panel.getByRole("group", { name: "Section" }).getByRole("button", { name: "Q&A" }).click();
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(3);
    expect(await panel.locator('article[data-compare-side="b"] [data-passage-section]').evaluateAll((chips) => chips.map((chip) => chip.getAttribute("data-passage-section")))).toEqual(["qa", "qa", "qa"]);
    await panel.getByRole("group", { name: "Section" }).getByRole("button", { name: "All" }).click();

    await topic.focus();
    await page.keyboard.type("data center demand");
    const open = panel.getByRole("button", { name: "Open segment 3 of Q1 FY2027 in the source transcript" });
    await open.focus();
    await page.keyboard.press("Enter");
    const drawer = page.locator(".fin-tx-drawer");
    await expect(drawer).toBeVisible();
    await expect(page.locator('.fin-tx-seg[data-segment="3"]')).toBeFocused();
    await expect(page.locator('.fin-tx-seg[data-segment="3"]')).toContainText("data center demand remains extraordinary in every region");
    await expect(drawer.locator(".fin-tx-error")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("tx")).toBe("2027Q1");
    await page.getByRole("button", { name: "Close transcript" }).click();
    await expect(drawer).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("shared wording pairs passages on words only, and re-verification catches a corrected source", async ({ page }) => {
    await openTranscripts(page);
    const panel = await openCompare(page);
    await panel.getByRole("group", { name: "View" }).getByRole("button", { name: "Shared wording" }).click();
    const align = panel.locator('[data-compare-view="align"]');
    await expect(align).toBeVisible();
    await expect(align.getByRole("note")).toContainText("Pairs below only share words. A pair does not show that a statement changed, that the same person said it, or why. Numbers are left out of the matching.");

    const pairs = align.locator("li[data-pair-score]");
    await expect(pairs.first()).toBeVisible();
    const pairIdentities = await pairs.evaluateAll((items) => items.map((item) => item.querySelectorAll("article")).map((cards) => [
      `${cards[0].getAttribute("data-call-id")}:${cards[0].getAttribute("data-segment-index")}`,
      `${cards[1].getAttribute("data-call-id")}:${cards[1].getAttribute("data-segment-index")}`,
    ].join(" ↔ ")));
    expect(pairIdentities).toContain("2026Q1:1 ↔ 2027Q1:2");
    // The two revenue lines share only figures and stock words; they are never presented as a pair.
    expect(pairIdentities).not.toContain("2026Q1:2 ↔ 2027Q1:1");
    const terms = await align.locator('[aria-label="Shared words"] > span').allTextContents();
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.filter((term) => /\d/.test(term))).toEqual([]);
    // The demand pair shares 11 content words; the chips show 8 and the rest are counted, not hidden.
    const demandPair = pairs.filter({ has: page.locator('article[data-call-id="2026Q1"][data-segment-index="1"]') });
    await expect(demandPair).toContainText("11 shared words");
    await expect(demandPair.locator('[aria-label="Shared words"] > span')).toHaveCount(8);
    await expect(demandPair.getByLabel("3 more shared words")).toHaveText("+3");

    // Copy the link and the receipt BEFORE the archive changes.
    await panel.getByRole("button", { name: "Copy comparison link" }).click();
    const link = await lastCopied(page);
    expect(new URL(link).searchParams.get("txcm")).toBe("align");
    await panel.getByRole("button", { name: "Copy comparison receipt" }).click();
    const receiptText = await lastCopied(page);
    const receipt = JSON.parse(receiptText);
    expect(receipt.schema).toBe("mastermind.tx-compare/v1");
    expect(receipt.alignment.method).toBe("lexical-content-jaccard/v1");
    for (const value of [...call2026Q1().segments, ...call2027Q1().segments]) {
      expect(receiptText).not.toContain(value.text);
    }
    expect(receiptText).not.toContain("extraordinary");

    const verify = panel.locator("[data-compare-verify]");
    await panel.getByRole("button", { name: "Re-verify references" }).click();
    await expect(verify).toHaveAttribute("data-compare-verify", "verified");
    await expect(verify).toContainText("All 14 passage references re-resolved to the identical source text.");
    await expect(verify).toContainText(`${pairIdentities.length} shared-wording pairs recomputed with the same scores.`);

    // The archive republishes a corrected 2026Q1: a new body AND a new advertised revision.
    const oldSha = await sha(call2026Q1());
    archive.bodies.set("2026Q1", call2026Q1(DEMAND_A_CORRECTED));
    const newSha = await sha(call2026Q1(DEMAND_A_CORRECTED));
    await panel.getByRole("button", { name: "Re-verify references" }).click();
    await expect(verify).toHaveAttribute("data-compare-verify", "failed");
    await expect(verify).toContainText("The comparison could not be reconstructed");
    await expect(verify).toContainText(`A · Q1 FY2026 was corrected (revision ${oldSha.slice(0, 12)} → ${newSha.slice(0, 12)}); its offsets no longer apply.`);

    // Opening the old link re-resolves explicitly against the corrected revision and says so.
    await page.goto(link);
    const reopened = page.getByTestId("transcript-compare");
    await expect(reopened).toBeVisible({ timeout: 30_000 });
    await expect(reopened.locator('[data-compare-state="link-corrected"]')).toContainText(`(revision ${oldSha.slice(0, 12)} → ${newSha.slice(0, 12)})`);
    await expect.poll(async () => new Set((await reopened.locator('article[data-compare-side="a"]').evaluateAll((cards) => cards.map((card) => card.getAttribute("data-body-sha256")))))).toEqual(new Set([newSha]));
  });

  test("an absent, stale or foreign call is reported in place and never substituted", async ({ page }) => {
    // A link to a call the archive does not hold.
    await openTranscripts(page, "&txc=NVDA_2025Q1_2027Q1");
    let panel = page.getByTestId("transcript-compare");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByLabel("Call A")).toHaveValue("2025Q1");
    await expect(panel.getByLabel("Call A").locator("option:checked")).toHaveText("2025Q1 · not in archive list");
    await showSide(page, panel, "a");
    await expect(panel.locator('[data-compare-column="a"] [data-compare-state="not-covered"]')).toContainText("2025Q1 is not in the verified archive");
    await expect(panel.locator('[data-compare-column="a"]')).toContainText("No other call is shown in its place.");
    await expect(panel.locator('[data-compare-column="a"]')).not.toContainText("Raw source text");
    await expect(panel.locator('article[data-compare-side="a"]')).toHaveCount(0);
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(7);
    expect([...new Set(archive.requested)]).toEqual(["2027Q1"]);
    await expect(panel.getByRole("button", { name: "Copy comparison receipt" })).toBeDisabled();

    // A commit marker that advertises a different revision than the served body.
    archive.advertise.set("2026Q1", "f".repeat(64));
    await openTranscripts(page);
    panel = await openCompare(page);
    await showSide(page, panel, "a");
    await expect(panel.locator('[data-compare-column="a"] [data-compare-state="stale"]')).toContainText("Q1 FY2026 did not pass revision checks");
    await expect(panel.locator('[data-compare-column="a"]')).toContainText("The document differs from the revision the archive advertises.");
    await expect(panel.locator('article[data-compare-side="a"]')).toHaveCount(0);
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(7);
    await expect(panel).toContainText("A receipt needs both calls loaded and verified.");
    archive.advertise.clear();

    // Another company's link is not applied to this one.
    await openTranscripts(page, "&txc=AMD_2026Q1_2027Q1");
    panel = page.getByTestId("transcript-compare");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText("This comparison link names AMD, not NVDA. It was not applied.");
    expect(new URL(page.url()).searchParams.get("txc")).toBeNull();

    // A self-comparison link is malformed: nothing opens on its behalf.
    await openTranscripts(page, "&txc=NVDA_2027Q1_2027Q1");
    await expect(page.getByTestId("transcript-compare-entry")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("transcript-compare")).toHaveCount(0);
  });

  test("a copied comparison link restores the exact calls and filters and carries no transcript text", async ({ page }) => {
    await openTranscripts(page);
    const panel = await openCompare(page);
    await panel.getByLabel("Call A").selectOption("2026Q4");
    await panel.getByRole("textbox", { name: "Topic" }).fill("Blackwell");
    await panel.getByRole("group", { name: "Section" }).getByRole("button", { name: "Q&A" }).click();
    await expect(panel.locator('article[data-compare-side="a"]')).toHaveCount(2);
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(2);
    await panel.getByRole("button", { name: "Copy comparison link" }).click();
    const link = new URL(await lastCopied(page));
    const sha4 = (await sha(call2026Q4())).slice(0, 12);
    const sha1 = (await sha(call2027Q1())).slice(0, 12);
    expect(link.pathname).toBe("/analysis");
    expect(link.searchParams.get("page")).toBe("transcripts");
    expect(link.searchParams.get("txc")).toBe(`NVDA_2026Q4.${sha4}_2027Q1.${sha1}`);
    expect(link.searchParams.get("txcq")).toBe("Blackwell");
    expect(link.searchParams.get("txcsec")).toBe("qa");
    expect(link.searchParams.has("tx")).toBe(false);
    expect(link.searchParams.has("pane")).toBe(false);
    for (const value of [...call2026Q4().segments, ...call2027Q1().segments]) {
      expect(decodeURIComponent(link.toString())).not.toContain(value.text);
    }

    await page.goto(link.toString());
    const reopened = page.getByTestId("transcript-compare");
    await expect(reopened).toBeVisible({ timeout: 30_000 });
    await expect(reopened.getByLabel("Call A")).toHaveValue("2026Q4");
    await expect(reopened.getByLabel("Call B")).toHaveValue("2027Q1");
    await expect(reopened.getByRole("textbox", { name: "Topic" })).toHaveValue("Blackwell");
    await expect(reopened.getByRole("group", { name: "Section" }).getByRole("button", { name: "Q&A" })).toHaveAttribute("aria-pressed", "true");
    await expect(reopened.locator('article[data-compare-side="a"]')).toHaveCount(2);
    await expect(reopened.locator('[data-compare-state="link-corrected"]')).toHaveCount(0);

    await reopened.getByRole("button", { name: "Close comparison" }).click();
    await expect(page.getByTestId("transcript-compare")).toHaveCount(0);
    const entryButton = page.getByTestId("transcript-compare-entry").getByRole("button", { name: "Compare two calls" });
    await expect(entryButton).toBeFocused();
    const after = new URL(page.url()).searchParams;
    expect(["txc", "txcq", "txcs", "txcsec", "txcm"].filter((key) => after.has(key))).toEqual([]);
  });

  test("the comparison reads in Chinese while transcript text stays labeled as untranslated source", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
    await openTranscripts(page);
    const panel = await openCompare(page, "对比两次电话会");
    await expect(panel.getByRole("heading", { name: "两次电话会并排对比" })).toBeFocused();
    await expect(panel.locator('[data-compare-column="b"]')).toContainText("原文 · 未翻译");
    await expect(panel).toContainText("正文来自 DefeatBeta 电话会语料库");
    await expect(panel.getByRole("button", { name: "复制对比链接" })).toBeVisible();
    // The quoted passages remain the English source text, never a machine translation.
    await expect(panel.locator('article[data-compare-side="b"]').nth(2)).toContainText("data center demand remains extraordinary");
    const chrome = await panel.evaluate((element) => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("article, option").forEach((node) => node.remove());
      return clone.textContent ?? "";
    });
    for (const english of ["Compare two calls", "Side by side", "Shared wording", "Raw source text", "Copy comparison", "Re-verify"]) {
      expect(chrome).not.toContain(english);
    }
    await panel.getByRole("group", { name: "视图" }).getByRole("button", { name: "相同措辞" }).click();
    await expect(panel.locator('[data-compare-view="align"]').getByRole("note")).toContainText("以下配对仅表示用词相同");
    await expectNoDocumentOverflow(page);
  });

  test("E12 evidence capture", async ({ page }, testInfo) => {
    test.skip(!process.env.E12_CAPTURE, "set E12_CAPTURE=1 to refresh the PR evidence crops");
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const viewport = testInfo.project.name;
    // Frame the part that carries the evidence just below the sticky workspace header.
    const capture = async (target: Locator, name: string) => {
      await page.mouse.move(0, 0);
      await target.evaluate((element, margin) => {
        (element as HTMLElement).style.scrollMarginTop = `${margin}px`;
        element.scrollIntoView({ block: "start", behavior: "instant" });
      }, isPhone(page) ? 176 : 122);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `${viewport}-${name}.png`), animations: "disabled" });
    };
    const sideFrame = (panel: Locator) => (isPhone(page)
      ? panel.getByRole("tablist")
      : panel.locator('[data-compare-view="side"]'));

    // An absent call stays absent: column A says so instead of borrowing the adjacent quarter.
    await openTranscripts(page, "&txc=NVDA_2025Q1_2027Q1");
    const absent = page.getByTestId("transcript-compare");
    await expect(absent).toBeVisible({ timeout: 20_000 });
    await showSide(page, absent, "a");
    await expect(absent.locator('[data-compare-state="not-covered"]')).toBeVisible();
    await capture(sideFrame(absent), "en-absent");

    for (const lang of ["en", "zh"] as const) {
      await page.addInitScript((value) => window.localStorage.setItem("mm.lang", value), lang);
      await openTranscripts(page);
      const panel = await openCompare(page, lang === "zh" ? "对比两次电话会" : "Compare two calls");
      await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(7);
      await expect.poll(async () => (await cardIdentities(panel, "b")).every((card) => card.span)).toBe(true);
      await capture(isPhone(page) ? sideFrame(panel) : panel, `${lang}-side`);

      await panel.getByRole("group", { name: lang === "zh" ? "视图" : "View" }).getByRole("button", { name: lang === "zh" ? "相同措辞" : "Shared wording" }).click();
      const align = panel.locator('[data-compare-view="align"]');
      await expect(align.locator("li[data-pair-score]").first()).toBeVisible();
      await capture(align, `${lang}-align`);
    }
  });
});
