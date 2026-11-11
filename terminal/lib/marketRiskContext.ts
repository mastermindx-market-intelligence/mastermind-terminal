// Pure compatibility projection for the existing copilot, not a risk engine.
// A source-session date is not an issue/expiry clock. Preserve that uncertainty.

type Obj = Record<string, unknown>;
const HOUR = 3_600_000;
const LEGACY_BUILD_MAX_AGE = 48 * HOUR;
const VERDICTS = new Set(["RISK_ON", "MIXED", "RISK_OFF"]);
const RADAR_STATES = new Set(["calm", "watch", "caution", "elevated", "risk-off"]);
const obj = (v: unknown): Obj | null =>
  v != null && typeof v === "object" && !Array.isArray(v) ? v as Obj : null;
const text = (v: unknown, max = 160): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function sessionTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

function zonedTime(value: unknown): number | null {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      sessionTime(value.slice(0, 10)) == null ||
      Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 ||
      Number(value.slice(17, 19)) > 59) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function radarContext(value: unknown): Obj | null {
  const r = obj(value);
  if (!r) return null;
  const state = typeof r.state === "string" && RADAR_STATES.has(r.state) ? r.state : null;
  const out = { state, top_score: finite(r.top_score), label_en: text(r.label_en), label_zh: text(r.label_zh) };
  return Object.values(out).some(v => v != null) ? out : null;
}

export function curateMarketRiskContext(raw: unknown, nowMs: number): Obj {
  const m = obj(raw);
  const unavailable = { no_data: true, reason: "market_risk.json unavailable or unsupported on this box" };
  if (!m) return unavailable;
  const isFlat = m.schema === "market_risk/v1";
  const isLegacy = m.schema == null || m.schema === "risk_state.v1";
  const d = isFlat ? m : isLegacy ? obj(m.display) : null;
  if (!d || typeof d.verdict !== "string" || !VERDICTS.has(d.verdict)) return unavailable;

  const now = Number.isFinite(nowMs) && Number.isFinite(new Date(nowMs).getTime()) ? nowMs : null;
  const sourceStale = typeof m.stale === "boolean" ? m.stale : null;
  const protectiveMarker = "stale" in m && m.stale !== false;
  const score = finite(d.score);
  const common = {
    source_schema: isFlat ? "market_risk/v1" : m.schema ?? "legacy_display",
    verdict: d.verdict,
    score: score == null ? null : Number(score.toFixed(0)),
    label: text(d.label_en) ?? d.verdict,
    source_reported_stale: sourceStale,
    source_reported_realtime: typeof m.realtime === "boolean" ? m.realtime : null,
    is_display_only: true,
  };

  if (isFlat) {
    const session = sessionTime(m.asof);
    const invalid = now == null || session == null || session > now;
    // Flat v1 has no issue or expiry clock. A stale=false source snapshot is
    // not proof of current freshness; do not duplicate a producer age budget.
    const stale = invalid || sourceStale !== false ? true : null;
    return {
      ...common,
      asof: session == null ? null : m.asof,
      built: null,
      age_hours: null,
      stale,
      freshness_basis: "producer_report_only",
      freshness_status: stale === true ? "unverified_or_source_stale" : "current_freshness_unknown",
      radar: radarContext(m.radar),
      note: "Dated source report only; no issue/expiry clock. Current freshness is unverified. Display-only, never a trade gate.",
    };
  }

  const built = zonedTime(m.built);
  const validClock = now != null && built != null && built <= now;
  const age = validClock ? now! - built! : null;
  const stale = protectiveMarker || age == null || age > LEGACY_BUILD_MAX_AGE;
  return {
    ...common,
    asof: null,
    built: validClock ? m.built : null,
    age_hours: age == null ? null : Math.round(age / HOUR),
    stale,
    freshness_basis: "legacy_build_age_only",
    freshness_status: stale ? "unverified_or_stale" : "legacy_artifact_current",
    note: "Legacy 48-hour artifact-age check only; build time is not quote freshness. Display-only, never a trade gate.",
  };
}
