import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectTapTarget } from "./tapTarget";

// Structure → "Open-interest change" panel. At phone width both scope toggles and all five
// sortable headers are real ≥44×44 tap targets; the controls still filter and sort exactly as
// before, header labels stay on their columns, and only the table (never the document)
// scrolls sideways. Desktop and tablet keep the prior compact geometry.

type Row = {
  root: string; exp: string; strike: number; right: string;
  dte: number | null; oi: number | null; oi_prev: number | null;
  d_oi: number | null; d_oi_pct: number | null;
};
type SortKey = "dte" | "oi_prev" | "oi" | "d_oi" | "d_oi_pct";

// FLOW_FIXTURE=1 (playwright.config) serves this file: `SPY` is the default root,
// `cross` is the All-roots board.
const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, "..", "public", "data", "oi_change_fixture.json"), "utf8"),
) as Record<string, { rows: Row[] }>;

const LABELS = {
  en: {
    group: "Open-interest change scope", root: "This root", all: "All roots",
    sort: (col: string) => `Sort by ${col}`,
    cols: { dte: "DTE", oi_prev: "Prev", oi: "OI", d_oi: "Δ OI", d_oi_pct: "Δ%" } as Record<SortKey, string>,
  },
  zh: {
    group: "未平仓变动范围", root: "本标的", all: "全部标的",
    sort: (col: string) => `按${col}排序`,
    cols: { dte: "剩余天数", oi_prev: "前值", oi: "未平仓", d_oi: "Δ 未平仓", d_oi_pct: "Δ%" } as Record<SortKey, string>,
  },
};
const SORT_KEYS: SortKey[] = ["dte", "oi_prev", "oi", "d_oi", "d_oi_pct"];

/** The panel's documented order: |Δ| columns by magnitude, others by value, nulls sink in
 *  both directions, ties keep payload order. Written independently of the component. */
function expectedOrder(rows: Row[], key: SortKey, desc: boolean, withRoot: boolean): string[] {
  const mag = (r: Row) => {
    const v = Number(r[key]);
    return key === "d_oi" || key === "d_oi_pct" ? Math.abs(v) : v;
  };
  return rows
    .map((r, i) => ({ r, i, v: mag(r) }))
    .sort((a, b) => {
      const aOk = Number.isFinite(a.v);
      const bOk = Number.isFinite(b.v);
      if (aOk !== bOk) return aOk ? -1 : 1;
      if (aOk && a.v !== b.v) return desc ? b.v - a.v : a.v - b.v;
      return a.i - b.i;
    })
    .map(({ r }) => `${withRoot ? `${r.root} ` : ""}${r.exp} ${r.strike}${r.right}`);
}

async function openStructure(page: Page, lang: "en" | "zh") {
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  await page.goto("/options?tab=structure");
  const group = page.getByRole("group", { name: LABELS[lang].group });
  await expect(group).toBeVisible({ timeout: 20_000 });
  return group;
}

function panelOf(group: Locator) {
  return group.locator("xpath=ancestor::section[1]");
}

async function rowOrder(panel: Locator, withRoot: boolean): Promise<string[]> {
  return panel.locator("tbody tr").evaluateAll((trs, root) => trs.map((tr) => {
    const cells = Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim());
    return root ? `${cells[0]} ${cells[1]}` : cells[0];
  }), withRoot);
}

for (const lang of ["en", "zh"] as const) {
  test(`phone: OI-change scope and sort controls are 44×44, aligned, and keep the document unscrolled (${lang})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone-width tap-target contract");
    const L = LABELS[lang];
    const group = await openStructure(page, lang);
    const panel = panelOf(group);

    const scope = group.getByRole("button");
    await expect(scope).toHaveCount(2);
    await expect(scope.nth(0)).toHaveText(L.root);
    await expect(scope.nth(1)).toHaveText(L.all);
    for (let i = 0; i < 2; i++) await expectTapTarget(scope.nth(i), { width: 44, height: 44 });

    for (const key of SORT_KEYS) {
      const btn = panel.getByRole("button", { name: L.sort(L.cols[key]), exact: true });
      await expect(btn).toBeVisible();
      await expectTapTarget(btn, { width: 44, height: 44 });
      const fit = await btn.evaluate((el) => {
        const th = el.closest("th") as HTMLElement;
        const thBox = th.getBoundingClientRect();
        const padR = parseFloat(getComputedStyle(th).paddingRight);
        const range = document.createRange();
        range.selectNodeContents(el);
        const ink = range.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        return {
          text: (el.textContent ?? "").trim(),
          clipped: el.scrollWidth > el.clientWidth + 1,
          // label ink must end on the column's content edge, where the right-aligned values end
          inkRightGap: thBox.right - padR - ink.right,
          inkInsideButton: ink.top >= b.top - 0.5 && ink.bottom <= b.bottom + 0.5,
          // the active column's ▾/▴ keeps its separating space after the label
          arrowGap: (() => {
            const arrow = Array.from(el.querySelector("span")?.childNodes ?? [])
              .find((n) => /[▾▴]/.test(n.textContent ?? "")) as Text | undefined;
            if (!arrow || !el.firstChild) return null;
            const at = arrow.data.search(/[▾▴]/);
            range.setStart(arrow, at);
            range.setEnd(arrow, at + 1);
            const glyph = range.getBoundingClientRect();
            range.selectNodeContents(el.firstChild);
            return glyph.left - range.getBoundingClientRect().right;
          })(),
        };
      });
      expect(fit.text.startsWith(L.cols[key]), `${key} label text`).toBe(true);
      expect(fit.clipped, `${key} label clipped`).toBe(false);
      expect(Math.abs(fit.inkRightGap), `${key} label right edge vs column edge`).toBeLessThanOrEqual(1);
      expect(fit.inkInsideButton, `${key} label vertically inside its button`).toBe(true);
      if (key === "d_oi") expect(fit.arrowGap ?? 0, "space before the sort arrow").toBeGreaterThanOrEqual(2);
    }

    // The table may scroll inside its own scroller; the document may not.
    const overflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  });
}

test("phone: tapping each scope and each sort twice keeps the filter and asc/desc semantics", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone-width tap-target contract");
  const L = LABELS.en;
  const group = await openStructure(page, "en");
  const panel = panelOf(group);
  const rootBtn = group.getByRole("button", { name: L.root, exact: true });
  const allBtn = group.getByRole("button", { name: L.all, exact: true });

  const runSorts = async (rows: Row[], withRoot: boolean) => {
    // Default: Δ OI, descending by magnitude.
    await expect.poll(() => rowOrder(panel, withRoot)).toEqual(expectedOrder(rows, "d_oi", true, withRoot));
    for (const key of SORT_KEYS) {
      const btn = panel.getByRole("button", { name: L.sort(L.cols[key]), exact: true });
      // Each column is fresh when reached (dte first), so tap 1 sorts descending and
      // tap 2 flips the same column to ascending.
      await btn.tap();
      await expect(btn).toHaveText(`${L.cols[key]} ▾`);
      await expect.poll(() => rowOrder(panel, withRoot)).toEqual(expectedOrder(rows, key, true, withRoot));
      await btn.tap();
      await expect(btn).toHaveText(`${L.cols[key]} ▴`);
      await expect.poll(() => rowOrder(panel, withRoot)).toEqual(expectedOrder(rows, key, false, withRoot));
    }
    // Leave the panel on its default sort for the next scope.
    const dOi = panel.getByRole("button", { name: L.sort(L.cols.d_oi), exact: true });
    await dOi.tap();
    await expect(dOi).toHaveText(`${L.cols.d_oi} ▾`);
  };

  await expect(rootBtn).toHaveAttribute("aria-pressed", "true");
  await expect(allBtn).toHaveAttribute("aria-pressed", "false");
  await runSorts(FIXTURE.SPY.rows, false);

  // Each scope tapped twice: the second tap on the active scope changes nothing.
  for (let n = 0; n < 2; n++) {
    await allBtn.tap();
    await expect(allBtn).toHaveAttribute("aria-pressed", "true");
    await expect(rootBtn).toHaveAttribute("aria-pressed", "false");
    await expect(panel.locator("thead th").first()).toHaveText("Root");
    await expect.poll(() => rowOrder(panel, true)).toEqual(expectedOrder(FIXTURE.cross.rows, "d_oi", true, true));
  }
  await runSorts(FIXTURE.cross.rows, true);

  for (let n = 0; n < 2; n++) {
    await rootBtn.tap();
    await expect(rootBtn).toHaveAttribute("aria-pressed", "true");
    await expect(allBtn).toHaveAttribute("aria-pressed", "false");
    await expect(panel.locator("thead th").first()).toHaveText("Contract");
    await expect.poll(() => rowOrder(panel, false)).toEqual(expectedOrder(FIXTURE.SPY.rows, "d_oi", true, false));
  }
});

test("desktop and tablet keep the compact OI-change controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "wider viewports keep the prior geometry");
  const group = await openStructure(page, "en");
  const panel = panelOf(group);

  const scope = group.getByRole("button");
  await expect(scope).toHaveCount(2);
  // Desktop: the inline 24px chip. Tablet (≤860px): the shared 36px chip floor, unchanged.
  const chipHeight = testInfo.project.name === "desktop" ? 24 : 36;
  for (let i = 0; i < 2; i++) {
    const box = await scope.nth(i).boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(chipHeight);
  }

  for (const key of SORT_KEYS) {
    const btn = panel.getByRole("button", { name: LABELS.en.sort(LABELS.en.cols[key]), exact: true });
    const style = await btn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, minHeight: cs.minHeight, minWidth: cs.minWidth, padding: cs.padding };
    });
    expect(style, `${key} header button`).toEqual({ display: "inline-block", minHeight: "0px", minWidth: "0px", padding: "0px" });
    const box = await btn.boundingBox();
    expect(box?.height ?? 0, `${key} header button keeps its text height`).toBeLessThan(24);
  }
});
