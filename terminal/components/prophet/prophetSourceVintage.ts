/** Prophet source-evidence vintage is not its publication timestamp. */
export interface ProphetSourceVintage {
  source_asof?: string | null;
  source_delayed?: boolean | null;
  source_unknown?: boolean | null;
  source_mixed_vintage?: boolean | null;
}
export type VintageWarning = "unknown" | "delayed" | "mixed";

export function prophetSourceVintage(
  payload: ProphetSourceVintage | null | undefined,
  lang: "en" | "zh",
): { label: string | null; warnings: VintageWarning[] } {
  const raw = typeof payload?.source_asof === "string" ? payload.source_asof : "";
  const date = /^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(raw) ? raw.slice(0, 10) : null;
  const parsed = date ? new Date(date + "T12:00:00Z") : null;
  const validDate = parsed && Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
  const label = validDate
    ? parsed.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
      month: "short", day: "numeric", timeZone: "America/New_York",
    })
    : null;
  const warnings: VintageWarning[] = [];
  if (payload?.source_unknown === true || !label) warnings.push("unknown");
  if (payload?.source_delayed === true) warnings.push("delayed");
  if (payload?.source_mixed_vintage === true) warnings.push("mixed");
  return { label, warnings };
}
