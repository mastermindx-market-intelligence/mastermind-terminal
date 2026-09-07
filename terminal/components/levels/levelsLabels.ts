/**
 * Display names for Levels board roles. Glyphs stay in the view; this module is
 * the bilingual label map so exhaustiveness tests can import it without React.
 */

export const ALL_ROLES = [
  "anchor",
  "call_wall",
  "put_wall",
  "flip",
  "cluster",
  "counter",
  "void",
  "trapdoor",
  "launchpad",
] as const;

export type Role = (typeof ALL_ROLES)[number];

export const ROLE_LABELS: Record<Role, { en: string; zh: string }> = {
  anchor:    { en: "Keystone",  zh: "关键位" },
  call_wall: { en: "Ceiling",   zh: "上方阻力" },
  put_wall:  { en: "Floor",     zh: "下方支撑" },
  flip:      { en: "Flip",      zh: "多空翻转位" },
  cluster:   { en: "Cluster",   zh: "密集区" },
  counter:   { en: "Backstop",  zh: "后备位" },
  void:      { en: "Void",      zh: "真空区" },
  trapdoor:  { en: "Trapdoor",  zh: "下跌缺口位" },
  launchpad: { en: "Launchpad", zh: "上涨启动位" },
};

export const ROLE_GLYPH: Record<Role, string> = {
  anchor:    "★",
  call_wall: "▔",
  put_wall:  "▁",
  flip:      "⚡",
  cluster:   "◆",
  counter:   "↘",
  void:      "≋",
  trapdoor:  "⚠",
  launchpad: "⤴",
};

const UNCLASSIFIED = { en: "Not classified", zh: "未分类" } as const;

// `role` stays `string` (not `Role`) on purpose: the exhaustiveness suite
// (lib/__tests__/levelsLabels.test.ts, "falls back to Not classified") calls
// this with unknown/empty strings to pin the defensive fallback for role
// values that arrive from untrusted runtime data (API payload, not a type-checked
// literal). Narrowing to `Role` would make that call site a type error and
// remove the guard the fallback exists to test. Reviewed and left widened
// (round-1 ruling; round-2 review re-confirms "not a blocker").
export function roleLabel(role: string, lang: "en" | "zh"): string {
  const pair = Object.prototype.hasOwnProperty.call(ROLE_LABELS, role)
    ? ROLE_LABELS[role as Role]
    : undefined;
  const text = pair ? (lang === "zh" ? pair.zh : pair.en) : "";
  if (!text) return lang === "zh" ? UNCLASSIFIED.zh : UNCLASSIFIED.en;
  return text;
}

export const STACK_LABELS = { en: "Stack", zh: "堆叠区" } as const;
export const STACK_GLYPH = "⊕";

export function stackLabel(lang: "en" | "zh"): string {
  return lang === "zh" ? STACK_LABELS.zh : STACK_LABELS.en;
}

export function notPresentLabel(lang: "en" | "zh"): string {
  return lang === "zh" ? "未出现" : "not present";
}
