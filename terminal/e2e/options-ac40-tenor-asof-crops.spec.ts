import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import volFixture from "./fixtures/options-r1-w3b-vol.json";
import movesFixture from "./fixtures/options-r1-w3-moves.json";
// AC40 Option B crop packet: regenerates the options-ac40-tenor-asof crops on synthetic
// sources. Opt-in only (OPTIONS_AC40_CROPS=1); the behavioural gate is the vitest suite
// lib/__tests__/volCompareTenorAsofClock.test.tsx — this packet is review evidence, not a gate.
//   dark  (default Terminal shell, 1440/820/390 → docs/pr-crops/options-ac40-tenor-asof):
//     OPTIONS_AC40_CROPS=1 npx playwright test e2e/options-ac40-tenor-asof-crops.spec.ts --project=desktop --workers=1
//   light (Shared Shell beta, 1440/820/390 → docs/pr-crops/options-ac40-tenor-asof-light):
//     MMX_SHARED_SHELL=1 OPTIONS_AC40_THEME=light OPTIONS_AC40_CROPS=1 npx playwright test e2e/options-ac40-tenor-asof-crops.spec.ts --project=desktop --workers=1
// Run each theme on its own fresh TERMINAL_E2E_PORT: a reused dev server keeps the shell flag it
// was started with, and the presentation assertion below fails rather than mislabel a crop.
// OPTIONS_AC40_ONLY_WIDTHS=820 (comma list) makes this spec, e2e/options-ac40-tenor-asof-crops.spec.ts,
// capture only those widths and merge them into the existing EVIDENCE.yml — crop bytes are not stable
// run to run, so a missing width is added without recapturing the others. The merge refuses unless
// head, sources and layout files are byte-identical to the packet's, every listed crop still matches
// its recorded sha256 and the packet lists no crop this spec does not produce. Every one of those
// checks runs in beforeAll, before any PNG or EVIDENCE.yml is written, so a refusal leaves the folder
// untouched. EVIDENCE.yml is then written only when every planned capture test in this run passed:
// a failure, skip, interruption or --grep subset leaves it byte-unchanged and says why.
//
// The W3B comparison panel (VolView mount, the same mocks as options-r1-w3-crops) in the three
// AC40 acceptance states, per language and viewport. The read is the 2026-10-21 fixture, whose
// every term row has dte = exp − asof (the producer law in macro engine/options_hub.py), so a
// supplied row and an interpolated row are dated on one clock (14D supplied = 4 Nov, 21D
// interpolated = asof + 21 = 11 Nov):
//   (a) old-read-on-today — the read viewed on 2026-10-28, with its 7D expiry withheld so 7D is
//       interpolated: the row is dated 28 Oct (asof + 7), equal to the viewer's ET today, and
//       says it is not ahead of today and names the 21 Oct read;
//   (b) today-read        — the same read viewed on its own day: every interpolated date is
//       after today and unlabeled, identical to the viewer-clock output;
//   (c) asof-missing      — the read without `asof`: interpolated rows show no date, and the
//       reason ("clock not stated by source").
// The fixtures are synthetic test data, not market data or a claim about any source.
const THEME: "dark" | "light" = process.env.OPTIONS_AC40_THEME === "light" ? "light" : "dark";
const OUT = path.resolve(__dirname, THEME === "light"
  ? "../docs/pr-crops/options-ac40-tenor-asof-light"
  : "../docs/pr-crops/options-ac40-tenor-asof");
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/vol/VolComparePanel.tsx",
  "terminal/components/vol/VolView.tsx",
  "terminal/components/vol/volShared.tsx",
  "terminal/components/vol/volStrings.ts",
  "terminal/lib/volTenorComparison.ts",
];
const SOURCE_FILES = [
  "terminal/e2e/fixtures/options-r1-w3b-vol.json",
  "terminal/e2e/fixtures/options-r1-w3-moves.json",
];
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 820: { width: 820, height: 1180 }, 390: { width: 390, height: 844 } } as const;
type Width = keyof typeof VIEWPORTS;
const ALL_WIDTHS: Width[] = [1440, 820, 390];
const ONLY = (process.env.OPTIONS_AC40_ONLY_WIDTHS ?? "").split(",").filter(Boolean).map(Number);
if (ONLY.some((w) => !(ALL_WIDTHS as number[]).includes(w))) throw new Error(`OPTIONS_AC40_ONLY_WIDTHS: widths must be among ${ALL_WIDTHS.join(",")}`);
const WIDTHS: Width[] = ONLY.length ? ALL_WIDTHS.filter((w) => ONLY.includes(w)) : ALL_WIDTHS;
type Lang = "en" | "zh";
type Presentation = { htmlTheme: string | null; sharedShell: string | null };
const PRESENTATION: Presentation = THEME === "light"
  ? { htmlTheme: "light", sharedShell: "1" }
  : { htmlTheme: "dark", sharedShell: null };
const crops: ({ file: string; viewport: string; lang: Lang; state: string; clock: string } & Presentation)[] = [];

// The read without its supplied 7D expiry: 7D is then interpolated between 2D and 10D.
const withoutSeven = { ...volFixture, term: volFixture.term.filter((row) => row.dte !== 7) };
const withoutAsof: Omit<typeof withoutSeven, "asof"> & { asof?: string } = { ...withoutSeven };
delete withoutAsof.asof;

const STATES = {
  "old-read-on-today": { clock: "2026-10-28T15:00:00Z", payload: withoutSeven },
  "today-read": { clock: "2026-10-21T15:00:00Z", payload: withoutSeven },
  "asof-missing": { clock: "2026-10-22T15:00:00Z", payload: withoutAsof },
} as const;
type State = keyof typeof STATES;

// An expiry cell is its date line alone, or the date line plus a separate qualifier element.
type Expiry = string | { date: string; note: string };
type Expect = { seven: Expiry; fourteen: string; twentyOne: Expiry; absent?: string };
const EXPECT: Record<State, Record<Lang, Expect>> = {
  "old-read-on-today": {
    en: { seven: { date: "28 Oct", note: "not ahead of today · from the 21 Oct read" }, fourteen: "4 Nov", twentyOne: "11 Nov" },
    zh: { seven: { date: "10月28日", note: "不晚于今日 · 来自10月21日的读数" }, fourteen: "11月4日", twentyOne: "11月11日" },
  },
  "today-read": {
    en: { seven: "28 Oct", fourteen: "4 Nov", twentyOne: "11 Nov", absent: "not ahead of today" },
    zh: { seven: "10月28日", fourteen: "11月4日", twentyOne: "11月11日", absent: "不晚于今日" },
  },
  "asof-missing": {
    en: { seven: { date: "—", note: "clock not stated by source" }, fourteen: "4 Nov", twentyOne: { date: "—", note: "clock not stated by source" } },
    zh: { seven: { date: "—", note: "来源未说明时钟" }, fourteen: "11月4日", twentyOne: { date: "—", note: "来源未说明时钟" } },
  },
};

// Every crop this spec produces, in EVIDENCE.yml order.
const ORDER = (Object.keys(STATES) as State[]).flatMap(state => (["en", "zh"] as Lang[])
  .flatMap(lang => ALL_WIDTHS.map(width => `${state}-${width}${lang === "zh" ? "-zh" : ""}.png`)));
const ROOT = path.resolve(__dirname, "../..");
const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(ROOT, file))).digest("hex");
const cropSha = (file: string) => createHash("sha256").update(readFileSync(path.join(OUT, file))).digest("hex");

function evidenceHeader(): string[] {
  // CAPTURE_HEAD names the commit an uncommitted working tree is built on; git is the fallback.
  const pinned = process.env.CAPTURE_HEAD ?? "";
  const head = /^[0-9a-f]{40}$/.test(pinned) ? pinned : execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
  const command = THEME === "light"
    ? "MMX_SHARED_SHELL=1 OPTIONS_AC40_THEME=light OPTIONS_AC40_CROPS=1 npx playwright test e2e/options-ac40-tenor-asof-crops.spec.ts --project=desktop --workers=1"
    : "OPTIONS_AC40_CROPS=1 npx playwright test e2e/options-ac40-tenor-asof-crops.spec.ts --project=desktop --workers=1";
  return [
    `capturedAtHead: ${head}`,
    `capturedAtHeadSource: ${head === pinned ? "CAPTURE_HEAD (the commit the captured working tree is built on)" : "git rev-parse HEAD"}`,
    `command: "${command}"`,
    THEME === "light"
      ? `theme: light — Shared Shell beta only (MMX_SHARED_SHELL=1, localStorage mmx.shell.theme=light).`
      : `theme: dark — the default Terminal shell (no MMX_SHARED_SHELL; <html data-theme="dark">).`,
    `sources: synthetic (e2e/fixtures/options-r1-w3b-vol.json less its 7D row, and less asof for asof-missing; e2e/fixtures/options-r1-w3-moves.json; mocked /data/AAPL.fund.json); not provider evidence.`,
    "sourceFiles:", ...SOURCE_FILES.flatMap(file => [`  - path: ${file}`, `    sha256: ${sha(file)}`]),
    "layoutFiles:", ...LAYOUT_FILES.flatMap(file => [`  - path: ${file}`, `    sha256: ${sha(file)}`]),
  ];
}

// The width-only merge's refusals, all read-only: the packet's head/sources/layout must equal this
// tree's, every listed crop must still match its recorded sha256, and no listed crop may be one this
// spec does not produce. Returns the packet's crop blocks keyed by file.
function packetBlocks(header: string[]): Map<string, string[]> {
  const prior = readFileSync(path.join(OUT, "EVIDENCE.yml"), "utf8").split("\n");
  const at = prior.indexOf("crops:");
  if (at < 0 || prior.slice(0, at).join("\n") !== header.join("\n")) {
    throw new Error("OPTIONS_AC40_ONLY_WIDTHS: EVIDENCE.yml head, sources or layout differ from this tree — run the full packet");
  }
  const blocks = new Map<string, string[]>();
  for (const line of prior.slice(at + 1)) {
    if (line.startsWith("  - file: ")) blocks.set(line.slice("  - file: ".length), [line]);
    else if (line) [...blocks.values()].at(-1)?.push(line);
  }
  const unknown = [...blocks.keys()].filter(file => !ORDER.includes(file));
  if (unknown.length) throw new Error(`EVIDENCE.yml lists crops this spec does not produce: ${unknown.join(", ")}`);
  for (const [file, lines] of blocks) {
    if (!lines.includes(`    sha256: ${cropSha(file)}`)) throw new Error(`${file}: crop on disk differs from its EVIDENCE.yml sha256`);
  }
  return blocks;
}

test.describe(`Options AC40 tenor-asof crop packet (${THEME})`, () => {
  test.skip(!process.env.OPTIONS_AC40_CROPS, "Set OPTIONS_AC40_CROPS=1 to regenerate the options-ac40-tenor-asof crops");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  // Set only when every pre-write check passed; afterAll writes nothing without it.
  let plan: { header: string[]; kept: Map<string, string[]> | null } | null = null;
  // The capture tests this run must pass before EVIDENCE.yml is written: every state × language,
  // each capturing the widths in effect (all three, or the OPTIONS_AC40_ONLY_WIDTHS subset).
  const PLANNED_TESTS = (Object.keys(STATES) as State[]).length * 2;
  const PLANNED_CROPS = PLANNED_TESTS * WIDTHS.length;
  const passed = new Set<string>();
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus && testInfo.status === "passed") passed.add(testInfo.testId);
  });
  test.beforeAll(() => {
    const header = evidenceHeader();
    const kept = ONLY.length ? packetBlocks(header) : null;
    mkdirSync(OUT, { recursive: true });
    plan = { header, kept };
  });

  const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // The term table must fit its panel at the 1440 and 820 crops: its horizontal scroll container
  // has no overflow, and the LEVEL header (the last column) has its whole text inside both the
  // scroll container and the panel. Checked immediately before each such crop is written.
  async function assertTermTableFits(target: ReturnType<Page["getByTestId"]>, file: string) {
    const fit = await target.evaluate((panel) => {
      const table = panel.querySelector("table");
      const scroller = table?.parentElement ?? null;
      const level = table?.querySelector("thead th:last-child") ?? null;
      if (!table || !scroller || !level) return null;
      const range = document.createRange();
      range.selectNodeContents(level);
      const text = range.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const frame = panel.getBoundingClientRect();
      return {
        scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
        levelText: (level.textContent ?? "").trim(), levelScrollWidth: level.scrollWidth, levelClientWidth: level.clientWidth,
        textLeft: text.left, textRight: text.right,
        visibleLeft: Math.max(box.left, frame.left), visibleRight: Math.min(box.right, frame.right),
      };
    });
    expect(fit, `${file}: term table, its scroll container or its LEVEL header is missing`).not.toBeNull();
    if (!fit) return;
    expect(fit.scrollWidth, `${file}: term table scroll container overflows (scrollWidth ${fit.scrollWidth} > clientWidth ${fit.clientWidth})`)
      .toBeLessThanOrEqual(fit.clientWidth);
    expect(fit.levelScrollWidth, `${file}: LEVEL header "${fit.levelText}" overflows its cell`).toBeLessThanOrEqual(fit.levelClientWidth);
    expect(fit.textLeft, `${file}: LEVEL header "${fit.levelText}" starts outside the visible table`).toBeGreaterThanOrEqual(fit.visibleLeft - 0.5);
    expect(fit.textRight, `${file}: LEVEL header "${fit.levelText}" is cut at the right edge`).toBeLessThanOrEqual(fit.visibleRight + 0.5);
  }
  async function capture(page: Page, state: State, width: Width, lang: Lang, target: ReturnType<Page["getByTestId"]>) {
    let height: number = VIEWPORTS[width].height;
    await page.setViewportSize(VIEWPORTS[width]);
    await settle(page);
    const file = `${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
    // Same convention as options-r1-w3-crops: rest the scroll ancestors at their top and grow
    // the viewport height until the whole panel fits, so the sticky chrome never paints over it.
    let box: { y: number; height: number } | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await target.evaluate((el) => {
        for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) if (n.scrollTop > 0) n.scrollTop = 0;
        window.scrollTo(0, 0);
      });
      await settle(page);
      box = await target.boundingBox();
      if (!box) throw new Error(`${file}: target has no bounding box`);
      const needed = Math.ceil(box.y + box.height + 72);
      if (needed <= height) break;
      height = Math.min(6000, needed);
      await page.setViewportSize({ width: VIEWPORTS[width].width, height }); await settle(page);
    }
    if (box && box.y + box.height > height) { await target.scrollIntoViewIfNeeded(); await settle(page); }
    if (width === 1440 || width === 820) await assertTermTableFits(target, file);
    await target.screenshot({ path: path.join(OUT, file) });
    crops.push({ file, viewport: `${VIEWPORTS[width].width}x${height}`, lang, state, clock: STATES[state].clock, ...PRESENTATION });
  }

  for (const state of Object.keys(STATES) as State[]) {
    for (const lang of ["en", "zh"] as Lang[]) {
      test(`volatility compare panel · ${state} / ${lang}`, async ({ page }) => {
        const { clock, payload } = STATES[state];
        await page.emulateMedia({ colorScheme: THEME });
        await page.addInitScript(([locale, theme]) => {
          localStorage.setItem("mm.lang", locale);
          if (theme === "light") localStorage.setItem("mmx.shell.theme", "light");
        }, [lang, THEME] as const);
        await page.clock.setFixedTime(new Date(clock));
        await page.route("**/api/flow?*", async (route) => {
          const f = new URL(route.request().url()).searchParams.get("f");
          if (f === "vol:AAPL") await route.fulfill({ json: payload });
          else if (f === "moves:AAPL") await route.fulfill({ json: movesFixture });
          else if (f === "agg:AAPL") await route.fulfill({ json: {} });
          else if (f === "vol:SPY") await route.fulfill({ status: 404, json: {} });
          else await route.fallback();
        });
        await page.route("**/data/AAPL.fund.json", route => route.fulfill({
          json: { earnings: { next_date: "2026-10-30", next_period: "Q4 2026" } },
        }));
        await page.goto("/options?tab=volatility");
        const ticker = page.getByRole("combobox", { name: lang === "zh" ? "代码" : "Ticker", exact: true });
        await ticker.fill("AAPL");
        await ticker.press("Enter");
        const panel = page.getByTestId("vol-compare");
        await expect(panel).toBeVisible();
        // The crop is labeled with the theme it was actually rendered in, never the one requested.
        await expect.poll(() => page.evaluate(() => ({
          htmlTheme: document.documentElement.dataset.theme ?? null,
          sharedShell: document.documentElement.dataset.mmxSharedShell ?? null,
        }))).toEqual(PRESENTATION);
        // The 7D row's expiry cell is the state this crop exists to show; 14D (supplied) and 21D
        // (interpolated) prove both bases are dated on the one asof clock.
        const table = panel.locator("table").first();
        const cell = (tenor: string) => table.locator("tbody tr")
          .filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${tenor}$`) }) })
          .locator("td").nth(1);
        const want = EXPECT[state][lang];
        // The date line and the qualifier are separate elements, read in that order and never run
        // together; a row with no qualifier has none.
        const expiry = async (tenor: string, expected: Expiry) => {
          const date = typeof expected === "string" ? expected : expected.date;
          await expect(cell(tenor).getByTestId("vol-term-exp-date")).toHaveText(date);
          if (typeof expected === "string") {
            await expect(cell(tenor).getByTestId("vol-term-exp-note")).toHaveCount(0);
            await expect(cell(tenor)).toHaveText(expected);
          } else {
            await expect(cell(tenor).getByTestId("vol-term-exp-note")).toHaveText(expected.note);
            await expect(cell(tenor)).toHaveAccessibleName(`${expected.date} ${expected.note}`);
          }
        };
        await expiry("7D", want.seven);
        await expect(cell("14D")).toHaveText(new RegExp(`^${want.fourteen}(?: · .+)?$`));
        await expiry("21D", want.twentyOne);
        if (want.absent) await expect(panel).not.toContainText(want.absent);
        for (const width of WIDTHS) await capture(page, state, width, lang, panel);
      });
    }
  }

  test.afterAll(() => {
    // beforeAll refused (or never ran): the folder stays exactly as it was.
    const ready = plan;
    if (!ready) return;
    // A failure, skip, interruption or --grep subset: EVIDENCE.yml stays byte-unchanged.
    if (passed.size !== PLANNED_TESTS || crops.length !== PLANNED_CROPS) {
      console.warn(`OPTIONS_AC40: EVIDENCE.yml not written — ${passed.size} of ${PLANNED_TESTS} planned capture tests passed`
        + ` and ${crops.length} of ${PLANNED_CROPS} planned crops were captured. Any PNG this run rewrote no longer matches`
        + ` EVIDENCE.yml; rerun the full packet.`);
      return;
    }
    const block = (crop: (typeof crops)[number]) => [`  - file: ${crop.file}`, `    viewport: ${crop.viewport}`, `    lang: ${crop.lang}`, `    state: ${crop.state}`,
      `    clock: ${crop.clock}`, `    htmlTheme: ${crop.htmlTheme}`, `    sharedShell: ${crop.sharedShell ?? "null"}`,
      ...(ONLY.length ? [`    capturedWith: OPTIONS_AC40_ONLY_WIDTHS=${WIDTHS.join(",")}`] : []), `    sha256: ${cropSha(crop.file)}`];
    let cropLines = crops.flatMap(block);
    const kept = ready.kept;
    if (kept) {
      for (const crop of crops) kept.set(crop.file, block(crop));
      cropLines = ORDER.filter(file => kept.has(file)).flatMap(file => kept.get(file) ?? []);
    }
    writeFileSync(path.join(OUT, "EVIDENCE.yml"), [...ready.header, "crops:", ...cropLines].join("\n") + "\n");
  });
});
