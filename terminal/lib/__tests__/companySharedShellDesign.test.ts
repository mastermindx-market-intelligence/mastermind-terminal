/**
 * Shared Shell Company · selected-event read — source contract test.
 *
 * Static guardrails for the appended `Shared Shell Company · selected-event read`
 * block in app/company-intelligence.css. Pure fs + rule parsing (no browser):
 * the parent/Acceptance run captures actual dark/light/EN/ZH desktop/390 renders.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const CSS_PATH = path.join(ROOT, "app", "company-intelligence.css");
const MARKER = "Shared Shell Company · selected-event read";
const SCOPE = 'html[data-mmx-shared-shell="1"]';

const TOKEN_ALLOWlist = new Set([
  "--panel",
  "--panel-2",
  "--line",
  "--line-2",
  "--hairline",
  "--text",
  "--text-2",
  "--muted",
  "--shadow-card",
  "--r-card",
  "--r-tile",
]);

type Rule = { selector: string; body: string; media: string };

const norm = (s: string): string => s.replace(/\s+/g, "");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Flat-walk declared rules, threading @media preludes into each record. */
function parseRules(css: string, media = "", out: Rule[] = []): Rule[] {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const prelude = css.slice(i, open).trim();
    if (prelude.startsWith("@")) {
      let depth = 1;
      let j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      parseRules(css.slice(open + 1, j - 1), prelude, out);
      i = j;
    } else {
      const close = css.indexOf("}", open);
      if (close === -1) break;
      out.push({
        selector: prelude.replace(/\s+/g, " ").trim(),
        body: css.slice(open + 1, close).trim(),
        media,
      });
      i = close + 1;
    }
  }
  return out;
}

const parts = (r: Rule): string[] => r.selector.split(",").map((s) => norm(s));

function isScoped(selectorNorm: string): boolean {
  return selectorNorm.startsWith(norm(SCOPE));
}

const raw = readFileSync(CSS_PATH, "utf8");
const beginTag = `/* BEGIN ${MARKER}`;
const endTag = `/* END ${MARKER}`;
const beginAt = raw.indexOf(beginTag);
const endAt = raw.indexOf(endTag);
const block = beginAt >= 0 && endAt > beginAt ? raw.slice(beginAt, endAt) : "";
const rules = parseRules(stripComments(block));
const blockNorm = norm(stripComments(block));

describe("Shared Shell Company · selected-event read repair block", () => {
  it("is present in company-intelligence.css exactly once", () => {
    expect(beginAt).toBeGreaterThanOrEqual(0);
    expect(endAt).toBeGreaterThan(beginAt);
    expect(raw.indexOf(beginTag, beginAt + 1)).toBe(-1);
    expect(rules.length).toBeGreaterThan(0);
  });

  it("scopes every declared selector to html[data-mmx-shared-shell]", () => {
    for (const rule of rules) {
      for (const selector of parts(rule)) {
        expect(isScoped(selector), `unscoped selector: ${rule.selector}`).toBe(true);
      }
    }
  });

  it("reintroduces no forbidden brand stripes on hero or section labels", () => {
    for (const rule of rules) {
      for (const selector of parts(rule)) {
        expect(selector.includes(".ci-hero::before")).toBe(false);
        expect(selector.includes(".ci-section-label>span::before")).toBe(false);
      }
    }
    const hero = rules.filter((r) =>
      parts(r).some((s) => s === norm(SCOPE) + ".ci-hero"),
    );
    expect(hero.length).toBeGreaterThan(0);
    for (const rule of hero) {
      expect(norm(rule.body)).toContain("background:var(--panel)");
      expect(norm(rule.body)).not.toContain("gradient");
    }
  });

  it("removes the incumbent forbidden edge rules globally, not only in the override block", () => {
    const allRules = parseRules(stripComments(raw));
    expect(allRules.some(rule => parts(rule).includes(".ci-hero::before"))).toBe(false);
    expect(allRules.some(rule => parts(rule).includes(".ci-section-label>span::before"))).toBe(false);
    const note = allRules.find(rule => parts(rule).includes(".ci-ts-dialog-note"));
    expect(note).toBeDefined();
    expect(norm(note!.body)).toContain("border:1pxsolidvar(--line)");
    expect(norm(note!.body)).not.toContain("border-left");
  });

  it("gives the take-note an even neutral border (no left rail, no color-mix)", () => {
    const note = rules.filter((r) =>
      parts(r).some((s) => s.endsWith(".ci-ts-dialog-note")),
    );
    expect(note.length).toBeGreaterThan(0);
    for (const rule of note) {
      const body = norm(rule.body);
      expect(body).toContain("border:1pxsolidvar(--hairline)");
      expect(body).not.toContain("border-left");
      expect(body).not.toContain("color-mix(");
    }
  });

  it("hides only the decorative ticker orbit visual", () => {
    const orbit = rules.filter((r) =>
      parts(r).some((s) => s.endsWith(".ci-paper-company-visual")),
    );
    expect(orbit.some((r) => norm(r.body).includes("display:none"))).toBe(true);
    for (const rule of rules) {
      if (norm(rule.body).includes("display:none")) {
        expect(
          parts(rule).some((s) => s.endsWith(".ci-paper-company-visual")),
          `content hidden outside the orbit: ${rule.selector}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the desktop two-column answer/watch layout", () => {
    const brief = rules.find(
      (r) => r.media === "" && parts(r).includes(norm(SCOPE) + ".ci-paper-brief"),
    );
    expect(brief).toBeDefined();
    expect(norm(brief!.body)).toContain(
      "grid-template-columns:minmax(0,1.8fr)minmax(260px,.9fr)",
    );
    const watch = rules.find(
      (r) => r.media === "" && parts(r).includes(norm(SCOPE) + ".ci-paper-watch"),
    );
    expect(watch).toBeDefined();
    expect(norm(watch!.body)).toContain("grid-column:2");
    expect(norm(watch!.body)).toContain("grid-row:1/span3");
  });

  it("places the boundary footer full width below without a fixed row number", () => {
    const boundary = rules.find(
      (r) => r.media === "" && parts(r).includes(norm(SCOPE) + ".ci-paper-boundary"),
    );
    expect(boundary).toBeDefined();
    expect(norm(boundary!.body)).toContain("grid-column:1/-1");
    expect(norm(boundary!.body)).toContain("grid-row:auto");
  });

  it("single-columns the shared hero and reclaims copy width", () => {
    const hero = rules.find(
      (r) => r.media === "" && parts(r).includes(norm(SCOPE) + ".ci-paper-brief-hero") && norm(r.body).includes("grid-template-columns:"),
    );
    expect(hero).toBeDefined();
    const body = norm(hero!.body);
    expect(body).toContain("grid-template-columns:minmax(0,1fr)");
    expect(body).toContain("min-height:0");
    expect(body).toContain("background:var(--panel)");
    const h3 = rules.find((r) =>
      parts(r).some((s) => s === norm(SCOPE) + ".ci-paper-brief-copyh3"),
    );
    expect(h3).toBeDefined();
    expect(norm(h3!.body)).toContain("font-size:clamp(22px,2vw,30px)");
    const p = rules.find((r) =>
      parts(r).some((s) => s === norm(SCOPE) + ".ci-paper-brief-copy>p"),
    );
    expect(p).toBeDefined();
    expect(norm(p!.body)).toContain("font-size:13.5px");
    expect(norm(p!.body)).toContain("line-height:1.55");
  });

  it("resets every child to natural DOM order at the 1100px breakpoint", () => {
    const stacked = rules.filter((r) => /max-width:\s*1100px/.test(r.media));
    expect(stacked.length).toBeGreaterThan(0);
    const brief = stacked.find((r) =>
      parts(r).includes(norm(SCOPE) + ".ci-paper-brief"),
    );
    expect(brief).toBeDefined();
    expect(norm(brief!.body)).toContain("grid-template-columns:minmax(0,1fr)");
    const allChildren = stacked.find((r) => {
      const selectors = parts(r);
      return [".ci-paper-brief-hero", ".ci-paper-metrics", ".ci-paper-insights", ".ci-paper-watch", ".ci-paper-boundary"].every(
        (cls) => selectors.some((s) => s.endsWith(cls)),
      );
    });
    expect(allChildren).toBeDefined();
    expect(norm(allChildren!.body)).toContain("grid-column:auto");
    expect(norm(allChildren!.body)).toContain("grid-row:auto");
  });

  it("uses readable semantic foregrounds on light selected and inactive lenses", () => {
    const light = norm(SCOPE) + '[data-theme="light"]';
    const inactive = rules.find(rule => parts(rule).includes(light + ".ci-lensesbutton"));
    const selected = rules.find(rule => parts(rule).includes(light + ".ci-lensesbutton.on"));
    expect(inactive).toBeDefined();
    expect(norm(inactive!.body)).toContain("color:var(--text-2)");
    expect(selected).toBeDefined();
    expect(norm(selected!.body)).toContain("color:var(--text)");
    expect(norm(selected!.body)).toContain("background:var(--panel-2)");
  });

  it("wraps mobile provenance groups without shrinking their text into neighboring groups", () => {
    const mobile = rules.filter(rule => /max-width:\s*760px/.test(rule.media));
    const bar = mobile.find(rule => parts(rule).includes(norm(SCOPE) + ".ci-provenance-bar"));
    const item = mobile.find(rule => parts(rule).includes(norm(SCOPE) + ".ci-provenance-bar>span"));
    expect(bar).toBeDefined();
    expect(norm(bar!.body)).toContain("flex-wrap:wrap");
    expect(norm(bar!.body)).toContain("white-space:normal");
    expect(norm(bar!.body)).toContain("overflow-x:visible");
    expect(item).toBeDefined();
    expect(norm(item!.body)).toContain("flex:00auto");
    expect(norm(item!.body)).toContain("max-width:100%");
    expect(norm(item!.body)).toContain("flex-wrap:wrap");
  });

  it("never reorders, removes, or fabricates content", () => {
    for (const rule of rules) {
      const body = norm(rule.body);
      expect(/(^|;)order:/.test(body), `order property in ${rule.selector}`).toBe(false);
      expect(body).not.toContain("visibility:hidden");
      expect(body).not.toContain("content:");
    }
  });

  it("touches no focus or chart styling", () => {
    for (const rule of rules) {
      for (const selector of parts(rule)) {
        expect(/:focus|outline|canvas|svg|chart|spark/i.test(selector)).toBe(false);
      }
    }
  });

  it("uses existing tokens only (no invented palette, no literals but geometry)", () => {
    expect(blockNorm).not.toContain("#");
    expect(blockNorm).not.toContain("rgb(");
    expect(blockNorm).not.toContain("hsl(");
    expect(blockNorm).not.toContain("color-mix(");
    const tokens = Array.from(blockNorm.matchAll(/--[a-z0-9-]+/g), (m) => m[0]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(
        TOKEN_ALLOWlist.has(token) || token.startsWith("--sp-"),
        `invented token ${token}`,
      ).toBe(true);
    }
  });
});
