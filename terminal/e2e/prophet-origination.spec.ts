/**
 * Prophet reconstruction disclosure — the real surface, not a server-rendered string.
 *
 * The macro builder marks a plan it rebuilt after an outage with `origination_note`,
 * a finished EN/ZH chip plus an optional receipt. This spec proves the Terminal draws
 * the row's own words, draws NOTHING on a live plan, and keeps the chip subordinate to
 * the plan it annotates — at all three house viewports, in both languages.
 *
 * Copy is never asserted against a literal written here: every expected string is read
 * out of the fixture, which is itself a transcript of the producer's output. A test
 * that hard-coded the wording would just be a second place for it to drift.
 *
 * Run with PROPHET_EVIDENCE=1 to also write the PR crops to
 * docs/pr-crops/prophet-origination-disclosure/.
 */

import { expect, test, type Locator, type Page } from "./fixtures";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface OriginationNote {
  en: string;
  zh: string;
  tip_en?: string;
  tip_zh?: string;
  date_en?: string;
  date_zh?: string;
}

interface FixturePlan {
  id: string;
  asset: string;
  origination_note?: OriginationNote;
}

const FIXTURE_FILE = path.join(process.cwd(), "test-fixtures", "prophet_reconstructed_fixture.json");
const CROP_DIR = path.join(process.cwd(), "..", "docs", "pr-crops", "prophet-origination-disclosure");
const EVIDENCE = process.env.PROPHET_EVIDENCE === "1";

let fixture: { plans: FixturePlan[] };

test.beforeAll(async () => {
  fixture = JSON.parse(await readFile(FIXTURE_FILE, "utf8")) as { plans: FixturePlan[] };
  if (EVIDENCE) mkdirSync(CROP_DIR, { recursive: true });
});

function planFor(asset: string): FixturePlan {
  const plan = fixture.plans.find((p) => p.asset === asset);
  if (!plan) throw new Error(`fixture is missing the ${asset} row`);
  return plan;
}

/** The card for one ticker in the signal stream. */
function card(page: Page, asset: string): Locator {
  return page.locator(".obs-prophet-signal").filter({ hasText: asset }).first();
}

/** The CENTER column — the detail panel for whichever plan is selected. */
function panel(page: Page): Locator {
  return page.locator(".obs-prophet-analysis");
}

/**
 * A colour-token guard has to compare like with like.
 *
 * `getComputedStyle(el).color` is always a resolved `rgb(…)`, while
 * `getPropertyValue("--down")` hands back whatever the stylesheet literally wrote —
 * here a hex (globals.css:15,22). `"rgb(239, 68, 68)" !== "#ef4444"` is true for every
 * element on the page, so the earlier version of this guard could not fail even on an
 * element literally coloured `var(--down)`. It passed for two revisions saying nothing.
 *
 * Resolving the token through a throwaway element inside the SAME SUBTREE fixes both
 * halves: the comparison is rgb-to-rgb, and the value is whatever that subtree's theme
 * currently resolves to — so the east-flip (`html[data-updown="east"]`, which swaps
 * --up/--down at globals.css:117,124) is honoured instead of hard-coded.
 */
async function directionalInks(scope: Locator): Promise<{ up: string; down: string; warn: string }> {
  return scope.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.display = "none";
    el.appendChild(probe);
    const resolve = (token: string) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const inks = { up: resolve("--up"), down: resolve("--down"), warn: resolve("--warn") };
    probe.remove();
    return inks;
  });
}

/** Fails with a readable message instead of a TypeError when the box is missing. */
async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  expect(box, `${what} has no bounding box — it is not laid out`).not.toBeNull();
  return box!;
}

/**
 * The RENDERED colour of one pixel, decoded from a 1×1 screenshot.
 *
 * Contrast has to be measured against what the eye receives, and the eye receives
 * composited pixels. Walking `getComputedStyle().backgroundColor` up the tree cannot
 * see this panel's backdrop at all: every layer here is a `linear-gradient` /
 * `radial-gradient`, which lives in `background-image` and reports `backgroundColor:
 * rgba(0,0,0,0)`. A DOM-composited estimate therefore reads the near-black page canvas
 * (#0a0b0e) and scores everything ~8% too generously — enough to let a token that
 * genuinely fails AA pass the guard, which is how the first version of this check
 * survived a deliberate mutation.
 *
 * Decoding is `node:zlib` only — no image dependency. A 1×1 clip is one scanline of
 * one pixel, so every PNG filter type degrades to "no predictor" (the Sub/Paeth left
 * neighbour and the Up/Average upper neighbour are all outside the image, i.e. zero).
 */
function decodeSinglePixel(png: Buffer): [number, number, number] {
  let pos = 8; // skip the PNG signature
  let bitDepth = 8, colorType = 6;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += len + 12;
  }
  expect(bitDepth, "unexpected PNG bit depth").toBe(8);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  expect(channels, `unexpected PNG colour type ${colorType}`).toBeGreaterThan(0);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = (require("node:zlib") as typeof import("node:zlib")).inflateSync(Buffer.concat(idat));
  // byte 0 of the scanline is the filter type; with one pixel every predictor is 0.
  return [raw[1], raw[2], raw[3]];
}

async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return decodeSinglePixel(shot);
}

function contrastRatio(fg: number[], bg: number[]): number {
  const lum = (c: number[]) => {
    const a = c.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Select a plan and wait for the panel to actually be showing it. */
async function openPlan(page: Page, asset: string): Promise<void> {
  await card(page, asset).click();
  await expect(panel(page).getByText(asset, { exact: true }).first()).toBeVisible();
}

async function openProphet(page: Page, lang: "en" | "zh"): Promise<void> {
  // Predicate rather than a glob: the `?` in `/api/flow?f=…` is ambiguous in URL globs.
  await page.route(
    (url) => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
    async (route) => { await route.fulfill({ json: fixture }); },
  );
  await page.goto("/options?tab=prophet");
  await expect(card(page, "UBER")).toBeVisible({ timeout: 20_000 });
  if (lang === "zh") {
    // The house switch: LangProvider re-reads the attribute on every `mm:lang`.
    await page.evaluate(() => {
      window.localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      window.dispatchEvent(new CustomEvent("mm:lang"));
    });
  }
}

for (const lang of ["en", "zh"] as const) {
  test(`Prophet marks a reconstructed plan with the row's own ${lang} disclosure`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await openProphet(page, lang);

    const rebuilt = planFor("UBER");
    const note = rebuilt.origination_note!;
    const chipCopy = lang === "zh" ? note.zh : note.en;
    const tipCopy = (lang === "zh" ? note.tip_zh : note.tip_en)!;

    const rebuiltCard = card(page, "UBER");
    const chip = rebuiltCard.locator(".obs-tag", { hasText: chipCopy });
    await expect(chip).toHaveCount(1);
    await expect(chip).toBeVisible();

    // The control: a live plan is untouched. Absence is the whole safety property.
    const liveCard = card(page, "NVDA");
    await expect(liveCard).toBeVisible();
    await expect(liveCard.locator(".obs-tag", { hasText: chipCopy })).toHaveCount(0);

    // The internal name of the event never reaches a reader, in either tier.
    await expect(page.locator("body")).not.toContainText("outage_backfill");

    // SUBORDINATE, MEASURED. The chip must read quieter than the direction badge it
    // sits under — smaller and lighter, and wearing the neutral token rather than a
    // directional or warning one. "Quiet" is a claim; these are the numbers behind it.
    const tone = await chip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fontSize: parseFloat(cs.fontSize), fontWeight: Number(cs.fontWeight), color: cs.color };
    });
    const badge = await rebuiltCard.locator(".obs-tag").first().evaluate((el) => ({
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      fontWeight: Number(getComputedStyle(el).fontWeight),
    }));
    const inks = await directionalInks(rebuiltCard);
    expect(tone.fontSize).toBeLessThan(badge.fontSize);
    expect(tone.fontWeight).toBeLessThan(badge.fontWeight);
    expect(tone.color).not.toBe(inks.down);
    expect(tone.color).not.toBe(inks.warn);
    // The guard can actually fire: the resolver returns the same shape it compares.
    expect(inks.down).toMatch(/^rgba?\(/);

    // Tier 2 — the receipt, through the house tooltip primitive.
    await chip.hover();
    const tip = page.locator('[role="tooltip"]');
    await expect(tip).toContainText(tipCopy, { timeout: 5_000 });

    if (EVIDENCE) {
      // The chip is captured at every viewport (the house 3-viewport rule); the
      // receipt and the two control cases are the same pixels at every width, so
      // desktop carries them once rather than three near-identical times.
      const stem = `${testInfo.project.name}-${lang}`;
      const isDesktop = testInfo.project.name === "desktop";
      if (isDesktop) {
        const cardBox = await rebuiltCard.boundingBox();
        const tipBox = await tip.boundingBox();
        if (cardBox && tipBox) {
          const left = Math.max(0, Math.min(cardBox.x, tipBox.x) - 12);
          const top = Math.max(0, Math.min(cardBox.y, tipBox.y) - 12);
          const right = Math.max(cardBox.x + cardBox.width, tipBox.x + tipBox.width) + 12;
          const bottom = Math.max(cardBox.y + cardBox.height, tipBox.y + tipBox.height) + 12;
          await page.screenshot({
            path: path.join(CROP_DIR, `${stem}-receipt.png`),
            clip: { x: left, y: top, width: right - left, height: bottom - top },
          });
        }
      }
      await page.mouse.move(0, 0);
      await expect(tip).toHaveCount(0);
      await rebuiltCard.screenshot({ path: path.join(CROP_DIR, `${stem}-chip.png`) });
      if (isDesktop) {
        await liveCard.screenshot({ path: path.join(CROP_DIR, `${stem}-control-live-plan.png`) });
        await card(page, "PLTR").screenshot({ path: path.join(CROP_DIR, `${stem}-no-receipt.png`) });
      }
    }
  });
}

// ── The detail panel ──────────────────────────────────────────────────────────
//
// The card marks the pick for a reader who is scanning. The panel is where that reader
// stops and reads, so the disclosure stops being a chip with the receipt behind a hover
// and becomes a dated line with the receipt in the open — and it moves ABOVE the trade
// geometry, because the rail, the phase and the phase-keyed brief are all timed from
// the origination date. This spec proves both the copy and that ordering on the real
// surface, at every house viewport.

for (const lang of ["en", "zh"] as const) {
  test(`Prophet's detail panel discloses the reconstruction in ${lang}, above the geometry`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await openProphet(page, lang);
    await openPlan(page, "UBER");

    const note = planFor("UBER").origination_note!;
    const clause = lang === "zh" ? note.zh : note.en;
    const stamp = (lang === "zh" ? note.date_zh : note.date_en)!;
    const receipt = (lang === "zh" ? note.tip_zh : note.tip_en)!;

    // The disclosure is TWO blocks: the dated clause under the header, the receipt
    // closing the panel. The split is not cosmetic — see the fold guard below.
    const dated = panel(page).locator(".obs-prophet-origination");
    const receiptEl = panel(page).locator(".obs-prophet-origination-receipt");
    await expect(dated).toHaveCount(1);
    await expect(dated).toBeVisible();
    await expect(dated).toContainText(clause);
    await expect(dated).toContainText(stamp);
    // Tier 2 in the open: the receipt is READ here, not hovered for. A reader who has
    // opened the plan has already asked the question the card's tooltip answers.
    await expect(receiptEl).toHaveCount(1);
    await expect(receiptEl).toContainText(receipt);
    await expect(page.locator("body")).not.toContainText("outage_backfill");

    // The other language never leaks into this one — including the two fields this
    // change added, which are the likeliest to mis-route.
    const other = lang === "zh" ? note.en : note.zh;
    const otherStamp = (lang === "zh" ? note.date_en : note.date_zh)!;
    const otherReceipt = (lang === "zh" ? note.tip_en : note.tip_zh)!;
    for (const leak of [other, otherStamp, otherReceipt]) {
      await expect(panel(page)).not.toContainText(leak);
    }

    // PLACEMENT, MEASURED. The clause and its date precede the numbers they govern;
    // the receipt, which governs nothing, closes the panel after them.
    const noteBox = await boxOf(dated, "dated clause");
    const railBox = await boxOf(panel(page).locator('[data-testid="geometry-rail"]'), "geometry rail");
    const tickerBox = await boxOf(panel(page).getByText("UBER", { exact: true }).first(), "panel ticker");
    const receiptBox = await boxOf(receiptEl, "receipt");
    expect(noteBox.y).toBeGreaterThan(tickerBox.y);
    expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(railBox.y);
    expect(receiptBox.y).toBeGreaterThan(railBox.y + railBox.height);

    // QUIET, MEASURED — but never at the cost of legibility. Both blocks are the
    // smallest type on the surface and neither may wear a directional or warning ink.
    const lines = panel(page).locator(
      ".obs-prophet-origination span, .obs-prophet-origination-receipt",
    );
    const tone = await lines.evaluateAll((els) =>
      els.map((n) => {
        const cs = getComputedStyle(n);
        return {
          size: parseFloat(cs.fontSize),
          color: cs.color,
          rgb: (cs.color.match(/[\d.]+/g) || []).map(Number),
        };
      }),
    );
    const inks = await directionalInks(panel(page));
    const tickerSize = await panel(page)
      .getByText("UBER", { exact: true })
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(tone.length).toBe(3); // clause + stamp + receipt
    for (const line of tone) {
      expect(line.size).toBeLessThan(tickerSize / 2);
      expect(line.color).not.toBe(inks.down);
      expect(line.color).not.toBe(inks.warn);
    }
    expect(inks.down).toMatch(/^rgba?\(/); // the guard is capable of firing

    // CONTRAST, EVERY LINE, AGAINST REAL PIXELS. This is a compliance disclosure, so
    // it clears the 4.5:1 AA floor — the quiet register does not get to win here.
    // Sampled inside each block's top padding, which is backdrop and never a glyph.
    for (const [el, label] of [[dated, "dated clause"], [receiptEl, "receipt"]] as const) {
      // The receipt closes the panel, so it starts below the fold and a clip at its
      // coordinates would be outside the screenshot entirely.
      await el.scrollIntoViewIfNeeded();
      const box = await boxOf(el, label);
      // +3px is inside the block's 10px top padding — backdrop, never a glyph.
      const sample = { x: Math.round(box.x + 3), y: Math.round(box.y + 3) };
      const vp = page.viewportSize()!;
      expect(sample.y, `${label} sample point is off-screen`).toBeGreaterThanOrEqual(0);
      expect(sample.y).toBeLessThan(vp.height);
      const backdrop = await pixelAt(page, sample.x, sample.y);
      for (const line of tone) {
        expect(
          contrastRatio(line.rgb, backdrop),
          `${label}: ${line.color} on rgb(${backdrop}) at ${line.size}px`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    await panel(page).evaluate((el) => { el.scrollTop = 0; });

    // THE FOLD. The desktop centre column is height-locked, so the disclosure spends
    // pixels the stance block needs. This is the regression guard: WHAT TO DO NOW —
    // the block that answers "so what do I do" — must survive on the first screen of a
    // reconstructed plan. Putting the receipt in the header zone left it 24px of 130.
    if (testInfo.project.name === "desktop") {
      const fold = await panel(page).evaluate((el) => {
        const pane = el.getBoundingClientRect();
        const stance = el.querySelector(".obs-prophet-section-primary");
        if (!stance) return null;
        const r = stance.getBoundingClientRect();
        return {
          visible: Math.round(Math.max(0, Math.min(r.bottom, pane.bottom) - Math.max(r.top, pane.top))),
          height: Math.round(r.height),
        };
      });
      expect(fold, "the panel has no stance block to protect").not.toBeNull();
      expect(fold!.visible).toBeGreaterThanOrEqual(80);
      // And the header block stays a one-liner — prose here is what caused the drop.
      expect(noteBox.height).toBeLessThanOrEqual(48);
    }

    // The control: selecting a live plan leaves the panel exactly as it always was.
    await openPlan(page, "NVDA");
    await expect(panel(page).locator(".obs-prophet-origination")).toHaveCount(0);
    await expect(panel(page).locator(".obs-prophet-origination-receipt")).toHaveCount(0);
    await expect(panel(page)).not.toContainText(clause);

    if (EVIDENCE) {
      const stem = `${testInfo.project.name}-${lang}`;
      await panel(page).screenshot({ path: path.join(CROP_DIR, `${stem}-panel-control-live-plan.png`) });
      await openPlan(page, "UBER");
      await panel(page).screenshot({ path: path.join(CROP_DIR, `${stem}-panel.png`) });
      // The receipt closes the panel, so it is below the fold — an element screenshot
      // scrolls to it on its own, which a page clip cannot.
      await receiptEl.screenshot({ path: path.join(CROP_DIR, `${stem}-panel-receipt.png`) });
      // ...and once more in context, so the closing rule can be read against the
      // opening one. An isolated paragraph cannot show that the two blocks bracket.
      await panel(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await panel(page).screenshot({ path: path.join(CROP_DIR, `${stem}-panel-foot.png`) });

      // The header-plus-clause crop is a page CLIP, so the region has to be fully on
      // screen first — at 390px the centre column is stacked below the stream, and a
      // clip that runs off any edge silently ships a cut-off disclosure as evidence,
      // which is worse than no evidence. Verify the geometry BEFORE the file lands.
      // `scrollIntoViewIfNeeded` aligns the NEAREST edge, so on a pane taller than the
      // viewport (390px, where the columns stack) it parks the panel's top ABOVE zero
      // and the header falls out of the clip. Align the top explicitly instead.
      await panel(page).evaluate((el) => {
        el.scrollTop = 0;
        el.scrollIntoView({ block: "start", inline: "nearest" });
      });
      const box = await boxOf(dated, "dated clause (evidence)");
      const head = await boxOf(panel(page).locator("> div").first(), "panel header (evidence)");
      const vp = page.viewportSize()!;
      const clip = {
        x: Math.max(0, head.x - 8),
        y: Math.max(0, head.y - 8),
        width: Math.max(head.width, box.width) + 16,
        height: box.y + box.height + 8 - Math.max(0, head.y - 8),
      };
      // scrollIntoViewIfNeeded can leave the header above the viewport (negative y) or
      // the note below its bottom; both clamp the clip and truncate the crop.
      expect(head.y, "panel header scrolled above the viewport").toBeGreaterThanOrEqual(0);
      expect(box.y + box.height + 8).toBeLessThanOrEqual(vp.height);
      expect(clip.x + clip.width).toBeLessThanOrEqual(vp.width);
      expect(clip.height).toBeGreaterThan(0);
      await page.screenshot({ path: path.join(CROP_DIR, `${stem}-panel-disclosure.png`), clip });

      if (testInfo.project.name === "desktop") {
        await openPlan(page, "PLTR");
        await panel(page).locator(".obs-prophet-origination")
          .screenshot({ path: path.join(CROP_DIR, `${stem}-panel-no-receipt.png`) });
      }
    }
  });
}

test("the panel's disclosure shows the clause alone when the row has no receipt", async ({ page }) => {
  test.setTimeout(60_000);
  await openProphet(page, "en");
  await openPlan(page, "PLTR");

  // Fail-soft, exactly as the producer is: an undatable row ships the clause and
  // nothing else. No stamp, no receipt paragraph, and no empty shell standing in.
  const undated = planFor("PLTR").origination_note!;
  const clauseEl = panel(page).locator(".obs-prophet-origination");
  await expect(clauseEl).toHaveCount(1);
  await expect(clauseEl).toHaveText(undated.en);
  await expect(clauseEl.locator("span")).toHaveCount(1);
  await expect(panel(page).locator(".obs-prophet-origination-receipt")).toHaveCount(0);

  // The dated row is the contrast — clause plus stamp up top, receipt at the foot.
  await openPlan(page, "UBER");
  const dated = planFor("UBER").origination_note!;
  await expect(clauseEl).toContainText(dated.date_en!);
  await expect(clauseEl.locator("span")).toHaveCount(2);
  await expect(panel(page).locator(".obs-prophet-origination-receipt")).toHaveCount(1);
});

test("a reconstructed plan with no receipt shows the chip and promises no hover", async ({ page }) => {
  test.setTimeout(60_000);
  await openProphet(page, "en");

  // Fail-soft, matching the producer: an undatable row ships the chip alone. A hover
  // affordance over nothing to hover is a promise the card cannot keep — so this chip
  // keeps the card's own `pointer` (the whole card is selectable) and never claims
  // `help`, which is this repo's "there is a receipt here" tell.
  const undated = planFor("PLTR");
  const chip = card(page, "PLTR").locator(".obs-tag", { hasText: undated.origination_note!.en });
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveCSS("cursor", "pointer");

  const dated = card(page, "UBER").locator(".obs-tag", { hasText: planFor("UBER").origination_note!.en });
  await expect(dated).toHaveCSS("cursor", "help");
});
