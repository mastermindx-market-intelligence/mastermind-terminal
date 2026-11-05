// E02 — the fundamental screen's feature-local EN/ZH copy. Every reason / status / field / basis /
// family code the contract can show has a non-blank pair, every literal key the components ask for
// exists, and placeholders agree across languages — so an unknown is never shown unexplained and a
// ZH reader never sees an English fallback or a raw key.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FUNDAMENTAL_CONSUMER_REASONS,
  FUNDAMENTAL_FIELD_IDS,
  FUNDAMENTAL_FIELD_REASONS,
  FUNDAMENTAL_FIELD_SPEC,
  FUNDAMENTAL_ROW_REASONS,
} from "@/lib/fundamentalScan";
import { FUNDAMENTAL_SCAN_LEX, fundText } from "@/lib/fundamentalScanLex";

const flat = (spec: Record<string, readonly string[]>) => Object.values(spec).flat();
const ALL_REASONS = [
  ...flat(FUNDAMENTAL_ROW_REASONS),
  ...flat(FUNDAMENTAL_FIELD_REASONS),
  ...flat(FUNDAMENTAL_CONSUMER_REASONS),
  "invalid_coverage", // E01 accountCoverage() bucket for a malformed classification
];

const pairOf = (key: string) => {
  const pair = FUNDAMENTAL_SCAN_LEX[key];
  expect(pair, `missing lex key ${key}`).toBeDefined();
  return pair!;
};
const expectFilled = (key: string) => {
  const [en, zh] = pairOf(key);
  expect(en.trim(), `${key} EN`).not.toBe("");
  expect(zh.trim(), `${key} ZH`).not.toBe("");
  // A ZH entry that is byte-identical to EN is an untranslated fallback (codes like "P/E" aside,
  // every entry here is prose).
  expect(zh, `${key} ZH is the EN text`).not.toBe(en);
};

describe("fundamentalScanLex — every code has EN + ZH copy", () => {
  it.each(ALL_REASONS)("reason %s", (r) => expectFilled(`fsR_${r}`));
  it.each(["evaluated", "stale", "unsupported", "unavailable"])("status %s", (s) => expectFilled(`fsS_${s}`));
  it.each(FUNDAMENTAL_FIELD_IDS)("field %s (name + column)", (f) => {
    expectFilled(`fsF_${f}`);
    expectFilled(`fsC_${f}`);
  });
  it.each([...new Set(Object.values(FUNDAMENTAL_FIELD_SPEC).map((s) => s.basis))])("basis %s", (b) => expectFilled(`fsB_${b}`));
  it.each(["industrial", "bank", "insurer", "financial_services", "ambiguous", "other"])("statement family %s", (f) =>
    expectFilled(`fsFam_${f}`),
  );

  it("has no orphan reason copy (a removed code takes its copy with it)", () => {
    const known = new Set(ALL_REASONS);
    const orphans = Object.keys(FUNDAMENTAL_SCAN_LEX)
      .filter((k) => k.startsWith("fsR_"))
      .map((k) => k.slice(4))
      .filter((r) => !known.has(r));
    expect(orphans).toEqual([]);
  });

  it("keeps {placeholders} identical across EN and ZH", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, [en, zh]] of Object.entries(FUNDAMENTAL_SCAN_LEX)) {
      expect(ph(zh), key).toEqual(ph(en));
    }
  });

  it("fundText substitutes vars and returns the key — never a blank — for an unknown key", () => {
    expect(fundText("en", "fsTallyOf", { n: 12 })).toContain("12");
    expect(fundText("zh", "fsTallyOf", { n: 12 })).toContain("12");
    expect(fundText("zh", "fsS_unavailable")).toBe(FUNDAMENTAL_SCAN_LEX.fsS_unavailable[1]);
    expect(fundText("en", "fsR_brand_new_code")).toBe("fsR_brand_new_code");
  });
});

describe("fundamentalScanLex — every literal key the components use exists", () => {
  const roots = [join(__dirname, "../../components/screener"), join(__dirname, "../../components")];
  const files = [
    ...readdirSync(roots[0]).filter((f) => f.endsWith(".tsx")).map((f) => join(roots[0], f)),
    join(roots[1], "ScreenerView.tsx"),
  ];
  it.each(files.map((f) => [f.split("/components/")[1], f]))("%s", (_name, file) => {
    const src = readFileSync(file, "utf8");
    // t("fs…") / ft("fs…") and t(cond ? "fsA" : "fsB") literals
    const keys = [...src.matchAll(/["'](fs[A-Z][A-Za-z_]*)["']/g)].map((m) => m[1]);
    for (const k of keys) expect(FUNDAMENTAL_SCAN_LEX[k], `${file}: ${k}`).toBeDefined();
  });
});
