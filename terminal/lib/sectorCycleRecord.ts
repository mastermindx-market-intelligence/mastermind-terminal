import { object, text, type SectorRotationEpisodes } from "./sectorIntelligence";
import { strictDay } from "./sectorCycleRhythm";
import { CYCLE_PHASE_LABELS } from "./sectorCycleHazard";
import type { SectorCycleGeneration } from "./sectorCycleSnapshot";

/* ────────────────────────────────────────────────────────────────────────────
 * Reader for the deep Cycles publication payload (Macro engine producer,
 * consumed read-only — this module never invents a field or re-dates a value).
 * Families, records, the publication gate, the exact-values osc history, the
 * engine read, leg stories and the conviction grader all validate
 * independently: a corrupt optional depth never erases a qualified core.
 * ──────────────────────────────────────────────────────────────────────────── */

export type CycleFamily = "sectors" | "baskets" | "nasdaq" | "russell";
export const CYCLE_FAMILIES: readonly {
  key: CycleFamily;
  kind: string;
  benchmark: string;
}[] = [
  { key: "sectors", kind: "sector", benchmark: "SPY" },
  { key: "baskets", kind: "basket", benchmark: "SPY" },
  { key: "nasdaq", kind: "nasdaq", benchmark: "QQQ" },
  { key: "russell", kind: "russell", benchmark: "IWM" },
];
const familyOf = (key: string) => CYCLE_FAMILIES.find((f) => f.key === key);

const PUBLICATION_ID = /^cycp1-[0-9a-f]{64}$/;
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/* ── Publication gate (donor #10707 publicationGate) ───────────────────────── */

export interface CycleEvidenceReceipt {
  schema?: unknown;
  status?: unknown;
  publicationId?: unknown;
  asOf?: unknown;
  region?: unknown;
  parts?: unknown;
}
export type CyclePublicationOutcome =
  | { state: "ready" }
  | { state: "loading"; reason: "verification_pending" }
  | { state: "incompatible_generation"; reason: string }
  | { state: "unavailable"; reason: string };

export function publicationGate(
  evidence: unknown,
  expected: { publicationId: string | null; region: string },
): CyclePublicationOutcome {
  const e = object(evidence);
  if (e.schema !== "sector_cycles.evidence.v1") {
    return { state: "unavailable", reason: "receipt_unavailable" };
  }
  if (e.status === "pending") return { state: "loading", reason: "verification_pending" };
  if (e.status === "superseded" || e.status === "incompatible_publication") {
    return { state: "incompatible_generation", reason: text(e.status) || "unknown" };
  }
  if (e.status !== "verified") {
    return { state: "unavailable", reason: "publication_" + (text(e.status) || "unknown") };
  }
  const parts = object(e.parts);
  if (parts.core !== "verified") {
    return { state: "unavailable", reason: "core_receipt_unverified" };
  }
  const idOk = (v: unknown): v is string =>
    typeof v === "string" && PUBLICATION_ID.test(v);
  if (!idOk(e.publicationId) || !idOk(expected.publicationId)) {
    return { state: "unavailable", reason: "publication_unbound" };
  }
  if (e.publicationId !== expected.publicationId || e.region !== "us") {
    return { state: "incompatible_generation", reason: "publication_mismatch" };
  }
  if (!strictDay(e.asOf)) return { state: "unavailable", reason: "receipt_date_invalid" };
  return { state: "ready" };
}

/* ── Roster / subject records ─────────────────────────────────────────────── */

export interface CycleRosterEntry {
  id: string;
  ticker: string;
  name: string;
  nameZh: string | null;
  kind: string;
  family: CycleFamily;
  /** Ontology phase (phase_v2 via an ontology source) — null when unqualified. */
  phase: string | null;
  /** Ontology position 0–100 — null when unqualified, 0 kept. */
  position: number | null;
  /** Legacy phase label — kept distinguishable from the ontology reading (C04). */
  legacyPhase: string | null;
  basis: string | null;
}

export function cycleRecordFor(
  payload: unknown,
  family: CycleFamily,
  id: string,
): unknown | null {
  const list = object(payload)[family];
  if (!Array.isArray(list)) return null;
  const meta = familyOf(family);
  const matches = list.filter(
    (r) => object(r).id === id && (!meta || object(r).kind === meta.kind),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** The ontology phase/position gate (donor buildView): a phase is only shown
 * when its source is the ontology, and a position only when it was computed
 * from pos_v2. Zero survives; out-of-range and wrong-input do not. */
export function ontologyReading(record: unknown): {
  phase: string | null;
  position: number | null;
} {
  const now = object(object(record).now);
  const source = text(now.phase_v2_source);
  const phase =
    source === "ontology" && CYCLE_PHASE_LABELS[String(now.phase_v2)]
      ? String(now.phase_v2)
      : null;
  let position = finite(now.pos_v2);
  if (
    position === null ||
    position < 0 ||
    position > 100 ||
    now.phase_v2_position_input !== "pos_v2"
  ) position = null;
  return { phase, position };
}

export function cycleRoster(payload: unknown, family: CycleFamily): CycleRosterEntry[] {
  const meta = familyOf(family);
  const list = object(payload)[family];
  if (!meta || !Array.isArray(list)) return [];
  const seen = new Set<string>();
  const rows: CycleRosterEntry[] = [];
  for (const value of list) {
    const r = object(value);
    const id = text(r.id), ticker = text(r.ticker);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ontology = ontologyReading(r);
    rows.push({
      id,
      ticker: ticker || id,
      name: text(r.name) || ticker || id,
      nameZh: text(r.name_zh) || null,
      kind: text(r.kind) || meta.kind,
      family,
      phase: ontology.phase,
      position: ontology.position,
      legacyPhase: CYCLE_PHASE_LABELS[text(object(r.now).phase)] ? text(object(r.now).phase) : null,
      basis: text(r.basis) || null,
    });
  }
  return rows;
}

export function cycleFamiliesPresent(payload: unknown): CycleFamily[] {
  return CYCLE_FAMILIES.filter(
    (f) => Array.isArray(object(payload)[f.key]) && object(payload)[f.key].length > 0,
  ).map((f) => f.key);
}

/* ── Exact-values osc history (donor historyOf) ───────────────────────────── */

export interface OscPoint {
  /** Source decimal-year coordinate. Not a publication date. */
  x: number;
  /** Cycle position 0–100. */
  value: number;
}
export type OscState = "ready" | "unavailable" | "invalid" | "unverified";
export interface OscHistory {
  state: OscState;
  sourcePart: "core" | "series";
  rows: OscPoint[];
}

export function oscHistory(
  record: unknown,
  family: CycleFamily,
  evidenceParts: Record<string, unknown> | null,
): OscHistory {
  const sourcePart = family === "sectors" ? "core" : "series";
  if (
    family !== "sectors" &&
    (!evidenceParts || object(evidenceParts).series !== "verified")
  ) {
    return { state: "unverified", sourcePart, rows: [] };
  }
  const points = object(record).osc;
  if (!Array.isArray(points) || points.length < 2) {
    return { state: "unavailable", sourcePart, rows: [] };
  }
  let previous = -Infinity;
  const rows: OscPoint[] = [];
  for (const p of points) {
    const x = finite(object(p).x), value = finite(object(p).v);
    if (x === null || value === null || value < 0 || value > 100 || x <= previous) {
      return { state: "invalid", sourcePart, rows: [] };
    }
    rows.push({ x, value });
    previous = x;
  }
  return { state: "ready", sourcePart, rows };
}

/* ── Engine read (C14): factual owner output, family-match gated ──────────── */

export type ReadState = "valid" | "withheld" | "absent";
export interface CycleRead {
  state: ReadState;
  en: string | null;
  zh: string | null;
}

const shortLabel = (phase: unknown): string | null =>
  CYCLE_PHASE_LABELS[text(phase)] ? CYCLE_PHASE_LABELS[text(phase)].short[0] : null;

/** The production read must name the same phase family as the phase clock
 * (donor familyMatch); otherwise it is kept but withheld from the face. */
export function cycleRead(record: unknown): CycleRead {
  const now = object(object(record).now);
  const en = typeof now.read === "string" ? now.read : null;
  const zh = typeof now.read_zh === "string" ? now.read_zh : null;
  if (!en) return { state: "absent", en: null, zh: null };
  const a = shortLabel(now.phase), b = shortLabel(now.phase_v2);
  const familyMatch = !!a && !!b && a === b && en.includes(a);
  if (!familyMatch || !zh) return { state: "withheld", en, zh };
  return { state: "valid", en, zh };
}

/* ── Leg story (C12): epoch/TTL/stale quarantine ──────────────────────────── */

export type StoryState = "valid" | "expired" | "absent" | "wrong_epoch";
export interface CycleStory {
  state: StoryState;
  en: string | null;
  zh: string | null;
  epoch: string | null;
  reason: "ttl" | "stale" | null;
}

export function cycleStory(
  record: unknown,
  generation: SectorCycleGeneration | null,
): CycleStory {
  const s = object(object(record).story);
  const absent: CycleStory = { state: "absent", en: null, zh: null, epoch: null, reason: null };
  if (!s.en && !s.zh) return absent;
  const epoch = text(s.epoch) || null;
  if (generation && epoch !== null && epoch !== generation.asOf) {
    return { state: "wrong_epoch", en: null, zh: null, epoch, reason: null };
  }
  const expires = strictDay(s.expires_asof);
  if (expires !== null && generation && expires < generation.asOf) {
    return { state: "expired", en: null, zh: null, epoch, reason: "ttl" };
  }
  if (s.stale === true) {
    return { state: "expired", en: null, zh: null, epoch, reason: "stale" };
  }
  return {
    state: "valid",
    en: typeof s.en === "string" ? s.en : null,
    zh: typeof s.zh === "string" ? s.zh : null,
    epoch,
    reason: null,
  };
}

/* ── Conviction grader (C23) ──────────────────────────────────────────────── */

export const GRADER_HORIZONS = ["21d", "63d", "126d"] as const;
export type GraderHorizonKey = (typeof GRADER_HORIZONS)[number];
export interface GraderHorizon {
  horizon: GraderHorizonKey;
  n: number | null;
  nDirectional: number | null;
  nCorrectDirectional: number | null;
  nNeutral: number | null;
  /** Conditional directional hit rate 0–1; null while accruing or absent. */
  hitRate: number | null;
  rankIc: number | null;
  meanExcessVsBench: number | null;
  accruing: boolean;
}
export interface CycleGrader {
  available: boolean;
  horizons: GraderHorizon[];
  note: string | null;
}

export function cycleGrader(payload: unknown): CycleGrader {
  const g = object(object(payload).grader);
  const byHorizon = object(g.by_horizon);
  if (g.available === false || !Object.keys(byHorizon).length) {
    return { available: false, horizons: [], note: text(g.note) || null };
  }
  const horizons: GraderHorizon[] = GRADER_HORIZONS.map((key) => {
    const e = object(byHorizon[key]);
    const hit = finite(e.conditional_directional_hit_rate);
    const n = finite(e.n);
    return {
      horizon: key,
      n: n !== null && Number.isInteger(n) && n >= 0 ? n : null,
      nDirectional: finite(e.n_directional),
      nCorrectDirectional: finite(e.n_correct_directional),
      nNeutral: finite(e.n_neutral),
      hitRate:
        hit !== null && hit >= 0 && hit <= 1 && e.note !== "accruing" ? hit : null,
      rankIc: finite(e.rank_ic),
      meanExcessVsBench: finite(e.mean_excess_vs_bench),
      accruing: e.note === "accruing" || (n !== null && n > 0 && hit === null),
    };
  });
  return { available: true, horizons, note: text(g.note) || null };
}

/* ── Rotation events (C20): capability-local generation binding ───────────── */

export interface BoundEpisodes {
  state: "ready" | "wrong_epoch" | "absent";
  episodes: SectorRotationEpisodes | null;
}

/** Rotation events carry their own generation (sourceAsOf/generatedUtc). Events
 * stamped after the selected generation are a different generation's history —
 * withheld, never spliced in. */
export function episodesForGeneration(
  episodes: SectorRotationEpisodes | null,
  generation: SectorCycleGeneration | null,
): BoundEpisodes {
  if (!episodes) return { state: "absent", episodes: null };
  if (!generation) return { state: "ready", episodes };
  if (episodes.sourceAsOf > generation.asOf) {
    return { state: "wrong_epoch", episodes: null };
  }
  return { state: "ready", episodes };
}
