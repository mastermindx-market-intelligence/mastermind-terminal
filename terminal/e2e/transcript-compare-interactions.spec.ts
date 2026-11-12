import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { canonicalTranscriptBodySha256 } from "../lib/transcriptSearch";

// Synthetic source bodies exercise the existing revision-verified consumer.
// These are UI fixtures, not real transcript text or market evidence.
const ids = ["2027Q1", "2026Q4", "2026Q1"];
const bodies = ids.map((id, index) => ({
  schema: "mastermind.tx/v1" as const, ticker: "NVDA", id,
  period: `Q${id.slice(5)} FY${id.slice(0, 4)}`,
  date: ["2026-05-27", "2026-02-25", "2025-05-28"][index],
  title: `Synthetic comparison call ${id}`,
  segments: [
    { speaker: "Fixture executive", role: "CEO", text: "Demand in this synthetic call reflects an example customer planning cycle across multiple regions." },
    { speaker: "Fixture executive", role: "CEO", text: "Capacity in this synthetic call reflects an example production schedule with measured delivery windows." },
    { speaker: "Fixture finance lead", role: "CFO", text: "This fixture describes a planning discussion without representing an actual company's financial results." },
  ],
}));
const generatedAt = "2026-08-01T00:00:00Z";

declare global {
  interface Window {
    __compareClipboard: Array<{ value: string; resolve: () => void; reject: () => void }>;
    __compareDigest: { hold: boolean; pending: Array<() => void> };
  }
}

async function setup(page: Page, lang: "en" | "zh" = "en") {
  const theme = lang === "zh" && process.env.MMX_SHARED_SHELL === "1" ? "light" : "dark";
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
    window.__compareClipboard = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: (value: string) => new Promise<void>((resolve, reject) => {
        window.__compareClipboard.push({ value, resolve, reject: () => reject(new DOMException("Fixture refusal", "NotAllowedError")) });
      }),
    } });
    window.__compareDigest = { hold: false, pending: [] };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args: Parameters<SubtleCrypto["digest"]>) => {
      const result = await digest(...args);
      if (!window.__compareDigest.hold) return result;
      return new Promise<ArrayBuffer>(resolve => window.__compareDigest.pending.push(() => resolve(result)));
    };
  }, { lang, theme });
  const revisions: Record<string, string> = {};
  for (const body of bodies) {
    const hash = await canonicalTranscriptBodySha256(body);
    if (!hash) throw new Error("Fixture WebCrypto unavailable");
    revisions[`NVDA/${body.id}`] = hash;
  }
  await page.route("https://www.mastermind-x.com/mm_brain.js", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(url => url.pathname === "/data/tx/index.json", r => r.fulfill({ json: {
    schema: "mastermind.tx-index/v1", generated_at: generatedAt, body_count: 3,
    symbols: { NVDA: ids }, revisions, dates: Object.fromEntries(bodies.map(body => [`NVDA/${body.id}`, body.date])),
  } }));
  await page.route(url => url.pathname === "/data/tx/NVDA/index.json", r => r.fulfill({ json: {
    schema: "mastermind.tx-symbol-index/v1", ticker: "NVDA", generated_at: generatedAt,
    calls: bodies.map(body => ({
      id: body.id, period: body.period, date: body.date, title: body.title,
      url: `/data/tx/NVDA/${body.id}.json.gz`, segment_count: 3, speaker_count: 2,
      speakers: ["Fixture executive", "Fixture finance lead"], qa_start: null, has_qa: false, source: "DefeatBeta",
    })),
  } }));
  await page.route(url => /^\/data\/tx\/NVDA\/\d{4}Q[1-4]\.json\.gz$/.test(url.pathname), r => {
    const body = bodies.find(body => r.request().url().includes(body.id));
    return body ? r.fulfill({ body: gzipSync(JSON.stringify(body)), contentType: "application/gzip" }) : r.fulfill({ status: 404 });
  });
  await page.goto("/analysis?symbol=NVDA&page=transcripts");
  const entry = page.getByTestId("transcript-compare-entry");
  await expect(entry).toBeVisible();
  await entry.getByRole("button").click();
  const panel = page.getByTestId("transcript-compare");
  await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(3);
  await expect(panel.locator('article[data-span-id]:not([data-span-id=""])')).toHaveCount(6);
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  return panel;
}

async function settle(page: Page, index: number, ok: boolean) {
  await page.evaluate(({ index, ok }) => {
    const attempt = window.__compareClipboard[index];
    if (ok) attempt.resolve(); else attempt.reject();
  }, { index, ok });
  // Let the browser deliver the real promise continuation and render it.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function copyCount(page: Page) { return page.evaluate(() => window.__compareClipboard.length); }
async function copiedValue(page: Page, index: number) { return page.evaluate(i => window.__compareClipboard[i].value, index); }

for (const lang of ["en", "zh"] as const) {
  test(`${lang} keyboard clear returns to the topic and keeps filtering usable`, async ({ page }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const panel = await setup(page, lang);
    const topic = panel.getByRole("textbox", { name: lang === "zh" ? "话题" : "Topic", exact: true });
    const clear = panel.getByRole("button", { name: lang === "zh" ? "清除话题" : "Clear topic", exact: true });
    await topic.scrollIntoViewIfNeeded();
    await topic.fill("Demand");
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();
    const rect = await clear.boundingBox();
    await expect.poll(() => clear.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === el || el.contains(hit);
    })).toBe(true);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    console.info("comparison clear target", JSON.stringify(rect));
    await page.screenshot({ path: info.outputPath(`${lang}-clear-focused.png`) });
    await page.keyboard.press("Enter");
    await expect(topic).toBeFocused();
    await expect(topic).toHaveValue("");
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(3);
    await page.keyboard.type("Capacity");
    await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(1);
    await expect(panel.locator('article[data-compare-side="b"]')).toContainText("Capacity");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect(topic).toBeFocused();
    await expect(topic).toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${lang}-clear-return.png`) });
  });
}

test("copy feedback belongs to the latest attempt and current comparison", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
  let panel = await setup(page);
  const link = panel.locator("footer button").nth(0);
  await link.click();
  await link.click();
  await expect.poll(() => copyCount(page)).toBe(2);
  const url = new URL(await copiedValue(page, 1));
  expect(url.pathname).toBe("/analysis");
  expect(url.searchParams.get("page")).toBe("transcripts");
  const shaA = await canonicalTranscriptBodySha256(bodies.find(body => body.id === "2026Q1")!);
  const shaB = await canonicalTranscriptBodySha256(bodies.find(body => body.id === "2027Q1")!);
  expect(url.searchParams.get("txc")).toBe(`NVDA_2026Q1.${shaA!.slice(0, 12)}_2027Q1.${shaB!.slice(0, 12)}`);
  expect(url.searchParams.has("tx")).toBe(false);
  expect(url.searchParams.has("pane")).toBe(false);
  await settle(page, 1, true);
  await expect(link).toHaveText("Copied");
  await settle(page, 0, false);
  await expect(link).toHaveText("Copied");

  // Committed A -> B -> A must not revive a pending result from the first A.
  await link.click();
  await expect.poll(() => copyCount(page)).toBe(3);
  const topic = panel.getByRole("textbox", { name: "Topic", exact: true });
  await topic.fill("Demand");
  await topic.fill("");
  await settle(page, 2, true);
  await expect(link).toHaveText("Copy comparison link");

  // Changing either selected call also invalidates in-flight feedback.
  await link.click();
  await expect.poll(() => copyCount(page)).toBe(4);
  await panel.getByRole("combobox", { name: "Call A", exact: true }).selectOption("2026Q4");
  await settle(page, 3, true);
  await expect(link).toHaveText("Copy comparison link");
  await expect(panel.locator('article[data-compare-side="a"]')).toHaveCount(3);

  await link.click();
  await expect.poll(() => copyCount(page)).toBe(5);
  await panel.getByRole("button", { name: "Close comparison", exact: true }).click();
  await page.getByTestId("transcript-compare-entry").getByRole("button").click();
  panel = page.getByTestId("transcript-compare");
  await expect(panel.locator('article[data-compare-side="b"]')).toHaveCount(3);
  await settle(page, 4, true);
  const reopenedLink = panel.locator("footer button").nth(0);
  await expect(reopenedLink).toHaveText("Copy comparison link");

  // A current failure remains honest and retryable; success keeps its existing lifetime.
  await reopenedLink.click();
  await expect.poll(() => copyCount(page)).toBe(6);
  await settle(page, 5, false);
  await expect(reopenedLink).toHaveText("Copy failed");
  await page.clock.install();
  await reopenedLink.click();
  await expect.poll(() => copyCount(page)).toBe(7);
  await settle(page, 6, true);
  await expect(reopenedLink).toHaveText("Copied");
  await page.screenshot({ path: info.outputPath("copy-feedback-current.png") });
  await page.clock.fastForward(1800);
  await expect(reopenedLink).toHaveText("Copy comparison link");
});

test("receipt preparation cannot supersede a later copy intent", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
  const panel = await setup(page);
  const link = panel.locator("footer button").nth(0);
  const receipt = panel.locator("footer button").nth(1);
  await page.evaluate(() => { window.__compareDigest.hold = true; });
  await receipt.click();
  await expect.poll(() => page.evaluate(() => window.__compareDigest.pending.length)).toBeGreaterThan(0);
  await link.click();
  await expect.poll(() => copyCount(page)).toBe(1);
  await settle(page, 0, true);
  await expect(link).toHaveText("Copied");
  await page.evaluate(() => {
    window.__compareDigest.hold = false;
    window.__compareDigest.pending.splice(0).forEach(resolve => resolve());
  });
  // Flush subsequent hashing continuations; any late stale write must become observable.
  await expect.poll(async () => page.evaluate(() => window.__compareDigest.pending.length)).toBe(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await copyCount(page)).toBe(1);
  await expect(link).toHaveText("Copied");

  await receipt.click();
  await expect.poll(() => copyCount(page)).toBe(2);
  const payload = JSON.parse(await copiedValue(page, 1));
  expect(payload.schema).toBe("mastermind.tx-compare/v1");
  expect(JSON.stringify(payload)).not.toContain("synthetic call");
  expect(JSON.stringify(payload)).not.toContain("production schedule");
  await settle(page, 1, true);
  await expect(receipt).toHaveText("Copied");
  await expect(link).toHaveText("Copy comparison link");
});
