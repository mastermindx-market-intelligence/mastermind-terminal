/**
 * Read-only consumer of Macro market_tide.event_response/v1.
 *
 * Validates semantic consistency and maps known-at observations to a small
 * display projection. It never authenticates upstream receipts, fetches data,
 * reprices options, ranks securities, issues alerts or grants trading authority.
 */
export type TideEvent = {
  eventId: string;
  eventType: string | null;
  sourceRef: string;
  revision: string;
  knownAt: string;
  resolutionState: "scheduled" | "unresolved" | "resolved" | "cancelled" | "unverified";
  status: "admitted" | "resolution_unverified";
};
export type TideEventLink = {
  eventId: string;
  channel: string;
  evidenceClass: "verified_fact" | "scenario" | "hypothesis";
  sourceRef: string;
  scenarioDirection: string | null;
};
export type TideRow = {
  securityId: string;
  ticker: string | null;
  status: "observed" | "unavailable";
  reason: string | null;
  returnPct: number | null;
  source: { sourceRef: string; revision: string; rightsRef: string;
    observedAt: string; usableAt: string; status: "complete" | "partial" } | null;
  eventLinks: TideEventLink[];
  decomposition: { marketPct: number; sectorExcessPct: number; unexplainedPct: number } | null;
};
export type TideResponseView = {
  kind: "observed_noncausal_event_response";
  decisionAt: string;
  marketStatus: "admitted" | "unavailable";
  marketReason: string | null;
  events: TideEvent[];
  rows: TideRow[];
  coverage: { eligible: number; observed: number; modeled: number; unavailable: number;
    eventsWithheld: number; linksWithheld: number };
  forecastAvailable: false;
  hedgeFlowAvailable: false;
  tradingAllowed: false;
  publishingAllowed: false;
};

type Obj = Record<string, unknown>;
const obj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string" && !!x.trim();
const nullableString = (x: unknown): x is string | null => x === null || str(x);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const count = (x: unknown): x is number => num(x) && Number.isSafeInteger(x) && x >= 0;
const eq = (a: number, b: number) => Math.abs(a - b) <= 0.000002;
const RIGHTS = ["may_rank", "may_gate", "may_size", "may_trade", "may_alert", "may_forecast"];

/** Timezone-aware ISO timestamp, with microsecond ordering retained. */
function micros(value: unknown): bigint | null {
  if (!str(value)) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = m[1].split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.toISOString().slice(0, 10) !== m[1]) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return BigInt(ms) * BigInt(1000) + BigInt((m[5] ?? "").padEnd(6, "0").slice(3));
}
const unique = (names: string[]) => new Set(names).size === names.length;

export function parseMarketTideEventResponse(value: unknown): TideResponseView | null {
  if (!obj(value)) return null;
  const v = value;
  const decision = micros(v.decision_at);
  if (v.schema !== "market_tide.event_response/v1" ||
      v.evidence_class !== "OBSERVATION" || decision === null ||
      v.interpretation !== "descriptive_noncausal" || v.forecast !== null ||
      v.hedge_flow !== null || !obj(v.authority) ||
      Object.keys(v.authority).length !== RIGHTS.length ||
      !RIGHTS.every(k => v.authority && obj(v.authority) && v.authority[k] === false) ||
      !Array.isArray(v.events) || v.events.length > 256 ||
      !Array.isArray(v.securities) || v.securities.length > 5000 ||
      !obj(v.coverage) || !count(v.event_count_known) || !count(v.event_count_withheld) ||
      v.event_count_known !== v.events.length) return null;

  const events: TideEvent[] = [], eventIds = new Set<string>(), activeIds = new Set<string>();
  for (const item of v.events) {
    if (!obj(item) || !str(item.event_id) || eventIds.has(item.event_id) ||
        !nullableString(item.event_type) || !str(item.source_ref) || !str(item.revision) ||
        micros(item.known_at) === null || micros(item.known_at)! > decision ||
        !["admitted", "resolution_unverified"].includes(String(item.status)) ||
        !["scheduled", "unresolved", "resolved", "cancelled", "unverified"].includes(String(item.resolution_state)) ||
        (item.status === "resolution_unverified" && item.resolution_state !== "unverified") ||
        (item.status === "admitted" && item.resolution_state === "unverified")) return null;
    eventIds.add(item.event_id);
    if (item.status === "admitted") activeIds.add(item.event_id);
    events.push({
      eventId: item.event_id, eventType: item.event_type as string | null, sourceRef: item.source_ref,
      revision: item.revision, knownAt: item.known_at,
      resolutionState: item.resolution_state as TideEvent["resolutionState"],
      status: item.status as TideEvent["status"],
    });
  }

  const rows: TideRow[] = [], securities = new Set<string>();
  let observed = 0, modeled = 0, withheldCount = 0;
  for (const item of v.securities) {
    if (!obj(item) || !str(item.security_id) || securities.has(item.security_id) ||
        !nullableString(item.ticker) || !["observed", "unavailable"].includes(String(item.status)) ||
        !Array.isArray(item.event_links) || item.event_links.length > 128) return null;
    securities.add(item.security_id);
    const available = item.status === "observed";
    if (available && (!num(item.return_pct) || item.reason !== null || !obj(item.source))) return null;
    if (!available && (item.return_pct !== null || item.source !== null ||
                       item.decomposition !== null || !str(item.reason))) return null;
    let source: TideRow["source"] = null;
    if (available) {
      const s = item.source as Obj;
      const tObserved = micros(s.observed_at), tUsable = micros(s.usable_at);
      if (!str(s.source_ref) || !str(s.revision) || !str(s.rights_ref) ||
          tObserved === null || tUsable === null || tObserved > tUsable ||
          tUsable > decision || !["complete", "partial"].includes(String(s.status))) return null;
      source = { sourceRef: s.source_ref, revision: s.revision, rightsRef: s.rights_ref,
        observedAt: s.observed_at as string, usableAt: s.usable_at as string,
        status: s.status as "complete" | "partial" };
      observed++;
    }
    const eventLinks: TideEventLink[] = [];
    for (const link of item.event_links) {
      if (!obj(link) || !str(link.event_id) || !activeIds.has(link.event_id) ||
          !str(link.channel) || !str(link.source_ref) ||
          !["verified_fact", "scenario", "hypothesis"].includes(String(link.evidence_class)) ||
          !nullableString(link.scenario_direction) || link.causality_established !== false) return null;
      eventLinks.push({ eventId: link.event_id, channel: link.channel,
        evidenceClass: link.evidence_class as TideEventLink["evidenceClass"],
        sourceRef: link.source_ref, scenarioDirection: link.scenario_direction });
    }
    const d = item.decomposition;
    let decomposition: TideRow["decomposition"] = null;
    if (d !== null) {
      if (!available || !obj(d) || d.method !== "market_plus_sector_excess/v1" ||
          d.causal_attribution !== false || !num(d.market_pct) ||
          !num(d.sector_excess_pct) || !num(d.unexplained_pct) ||
          !eq(d.market_pct + d.sector_excess_pct + d.unexplained_pct,
              item.return_pct as number)) return null;
      decomposition = { marketPct: d.market_pct,
        sectorExcessPct: d.sector_excess_pct, unexplainedPct: d.unexplained_pct };
      modeled++;
    }
    rows.push({ securityId: item.security_id, ticker: item.ticker,
      status: item.status as TideRow["status"], reason: item.reason as string | null,
      returnPct: item.return_pct as number | null, source, eventLinks, decomposition });
    withheldCount += eventLinks.length;
  }

  const c = v.coverage;
  if (!count(c.eligible) || !count(c.observed) || !count(c.modeled) ||
      !count(c.unavailable) || !count(c.event_links_withheld) ||
      c.eligible !== rows.length || c.observed !== observed ||
      c.modeled !== modeled || c.unavailable !== rows.length - observed ||
      modeled > observed || !["admitted", "unavailable"].includes(String(v.market_status)) ||
      !(v.market_status === "admitted" ? v.market_reason === null : str(v.market_reason))) return null;

  return {
    kind: "observed_noncausal_event_response",
    decisionAt: v.decision_at as string,
    marketStatus: v.market_status as TideResponseView["marketStatus"],
    marketReason: v.market_reason as string | null,
    events, rows,
    coverage: {
      eligible: c.eligible as number, observed, modeled,
      unavailable: c.unavailable as number,
      eventsWithheld: v.event_count_withheld as number,
      linksWithheld: c.event_links_withheld as number,
    },
    forecastAvailable: false, hedgeFlowAvailable: false,
    tradingAllowed: false, publishingAllowed: false,
  };
}
