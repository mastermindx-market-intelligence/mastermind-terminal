/** Native display contract. Source scores, caps and missing values are never inferred. */
export type MacroRecord = Record<string, unknown>;
export type MacroHistoryPoint = { asof: string; score: number | null };
export type MacroDashboard = {
  publishedAt: string; sourceAsOf: string | null; publicationSha: string;
  marketState: MacroRecord; currentRisk: MacroRecord | null; regime: MacroRecord;
  history: MacroHistoryPoint[]; riskEnvelope: MacroRecord; rates: MacroRecord;
  events: MacroRecord[]; sentiment: MacroRecord; breadth: MacroRecord;
  sectorHeat: MacroRecord; policy: MacroRecord; marketTiles: MacroRecord[];
  alerts: MacroRecord[]; health: MacroRecord[]; brief: MacroRecord; news: MacroRecord[]; newsState: MacroRecord; releaseFeed: MacroRecord;
};
export const macroRecord = (value: unknown): MacroRecord => value !== null && typeof value === "object" && !Array.isArray(value) ? value as MacroRecord : {};
export const macroRows = (value: unknown): MacroRecord[] => Array.isArray(value) ? value.filter(v => v !== null && typeof v === "object" && !Array.isArray(v)).slice(0, 200) as MacroRecord[] : [];
export const macroText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, 6000) : null;
export const macroNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
export function macroLocal(value: unknown, lang: "en" | "zh", stem?: string): string | null {
  const node = macroRecord(value);
  return macroText(node[stem ? `${stem}_${lang}` : lang]) ?? macroText(node[stem ? `${stem}_en` : "en"]) ?? (stem ? macroText(node[stem]) : null);
}
export function macroDate(value: unknown): string | null {
  const text = macroText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : null;
}
function finite(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length <= 200 && value.every(v => finite(v, depth + 1));
  return value !== null && typeof value === "object" && Object.values(value).every(v => finite(v, depth + 1));
}
export function decodeMacroDashboard(value: unknown): MacroDashboard | null {
  const source = macroRecord(value);
  const published = macroText(source.published_at), sha = macroText(source.publication_sha256);
  if (source.schema !== "mastermind.macro_dashboard.v1" || source.market !== "US" || source.display_only !== true
      || !published || !/(?:Z|[+-]\d{2}:\d{2})$/.test(published) || !Number.isFinite(Date.parse(published))
      || !sha || !/^[a-f0-9]{64}$/.test(sha) || !finite(source)) return null;
  // Preserve holes and source order. Duplicate/descending dates are rejected,
  // rather than silently drawing a more persuasive synthetic trajectory.
  const history: MacroHistoryPoint[] = [];
  for (const row of macroRows(source.history).slice(-60)) {
    const asof = macroDate(row.asof), score = macroNumber(row.score);
    if (!asof || (history.length && asof <= history[history.length - 1].asof)) return null;
    history.push({ asof, score: score !== null && score >= 0 && score <= 100 ? score : null });
  }
  return {
    publishedAt: published, publicationSha: sha, sourceAsOf: macroDate(source.source_as_of),
    marketState: macroRecord(source.market_state), currentRisk: source.current_risk == null ? null : macroRecord(source.current_risk),
    regime: macroRecord(source.regime), history, riskEnvelope: macroRecord(source.risk_envelope),
    rates: macroRecord(source.rates), events: macroRows(source.events), sentiment: macroRecord(source.sentiment),
    breadth: macroRecord(source.breadth), sectorHeat: macroRecord(source.sector_heat), policy: macroRecord(source.policy),
    marketTiles: macroRows(source.market_tiles), alerts: macroRows(source.alerts), health: macroRows(source.health),
    brief: macroRecord(source.brief), news: macroRows(source.news), newsState: macroRecord(source.news_state), releaseFeed: macroRecord(source.release_feed),
  };
}

export const MACRO_DETAILS = ["factors", "risk", "rates", "releases", "sentiment", "sectors", "policy", "brief", "alerts", "sources", "markets"] as const;
export type MacroDetail = typeof MACRO_DETAILS[number];
/** Canonical URL state plus old bookmarked dialog/section anchors. */
export function macroDetailFromHash(hash: string): MacroDetail | null {
  const key = hash.replace(/^#/, "");
  const aliases: Record<string, MacroDetail> = {
    "dlg-risk": "risk", "dlg-fed": "rates", "dlg-events": "releases", "dlg-fg": "sentiment",
    "dlg-sectors": "sectors", "dlg-policy": "policy", "dlg-ai": "brief", "data-health": "sources",
    "mx5PopFactors": "factors", "fired-alerts": "alerts",
    "dlg-sentiment": "sentiment", "dlg-sector": "sectors", "dlg-aibrief": "brief",
    "dlg-news": "brief", "dlg-markets": "markets", "regime-radar": "factors", "health": "sources",
    "risk-state": "risk", "dlg-liquidity": "factors", "dlg-credit": "risk",
    "liquidity": "risk", "credit": "risk", "dlg-alerts": "alerts",
  };
  return MACRO_DETAILS.includes(key as MacroDetail) ? key as MacroDetail : aliases[key] ?? null;
}

/** Links remain on the existing destination owners; no source-provided protocol. */
export function macroSafeLink(value: unknown): string | null {
  const text = macroText(value);
  if (!text || /[\\\u0000-\u0020]/.test(text)) return null;
  try {
    const url = new URL(text, "https://beta.mastermind-x.com");
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (["beta.mastermind-x.com", "mastermind-x.com", "www.mastermind-x.com"].includes(url.hostname)) return `${url.pathname}${url.search}${url.hash}`;
    return url.href;
  } catch { return null; }
}

/** Use the incumbent watcher's verified actual, never a date-passed inference. */
export function macroOfficialResult(row: MacroRecord): boolean {
  const actual = macroRecord(row.actual), url = macroText(row.source_url), sha = macroText(row.source_sha256);
  if (row.status !== "published" || row.data_ready !== true || !url || actual.source_url !== url
      || !sha || !/^[a-f0-9]{64}$/.test(sha) || sha !== row.content_sha256) return false;
  try {
    const source = new URL(url);
    return source.protocol === "https:" && !source.username && !source.password
      && ["federalreserve.gov", "bls.gov", "bea.gov", "dol.gov", "census.gov", "treasury.gov"].some(host => source.hostname === host || source.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
