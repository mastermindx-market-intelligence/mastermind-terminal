import { scenarioGrid, type ExposureNodeInput } from "./marketStructure";
import type { ExpiryLens } from "./gexLadder";

export type QualifiedMetric = "gamma" | "vanna" | "charm";
export type ExposureLens = ExpiryLens | { kind: "next-live" } | { kind: "week" };
export interface ExposureShock { spotPercent: number; ivPoints: number; calendarDays: number }
type Metric = { unit: string; expected: number | null; received: number; qualified: number; missing: number;
  net: number | null; gross: number | null; known_net?: number | null; known_gross?: number | null;
  qualified_population_id: string; status: string };
type Joint = { expected: number | null; received: number; qualified: number; missing: number;
  population_id: string; model_ref: string | null; complete: boolean };
type Cell = { strike: number; expiry: string; economic_expiry_at: string | null; population_id: string; joint: Joint } & Record<QualifiedMetric, Metric>;
export interface QualifiedProjection {
  kind: "modeled_exposure" | "dated_provider_approximation";
  root: string; source_snapshot_ref: string; security_id: string;
  clocks: Record<string, string | null>;
  population: { id: string; scope: string; full_universe_expected: null; full_universe_complete: false };
  greek_provenance: Partial<Record<QualifiedMetric, { model_ref: string; source_ref: string }>> | null;
  underlying_reference?: { value: number | null; currency: "USD"; basis: "uniform_selected_contract_underlying_price" | "nonuniform_or_missing_selected_underlying_prices"; source_session: string; instantaneous: false };
  cells: Cell[];
}
const units = { gamma: "usd_delta_per_1pct_spot", vanna: "usd_delta_per_1vol_point", charm: "usd_delta_per_calendar_day" };
const metrics: QualifiedMetric[] = ["gamma", "vanna", "charm"];
/** Exact current source identities only. One root's security and listing never
 * cross to another root, and no alias or generic inference widens this table.
 * Dated identity v1 stays SPY-only; observed identity v2 may additionally bind
 * QQQ from its actual native first effective date, never earlier. */
const identityRoots: Record<"SPY" | "QQQ", { security_id: string; listing_key: string; first_session: string | null }> = {
  SPY: { security_id: "SEC:US-ARCX-SPY", listing_key: "US-ARCX-SPY", first_session: null },
  QQQ: { security_id: "SEC:US-XNAS-QQQ", listing_key: "US-XNAS-QQQ", first_session: "2026-10-20" },
};
const identityRoot = (root: unknown, observed: boolean) =>
  root === "SPY" ? identityRoots.SPY : (observed && root === "QQQ") ? identityRoots.QQQ : null;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const sum = (values: (number | null)[]) => { if (!values.length || values.some((v) => v == null)) return null; const n = values.reduce<number>((a, b) => a + b!, 0); return Number.isFinite(n) ? n : null; };

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const canonicalSession = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const awareInstant = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
  && canonicalSession(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const knownBy = (value: unknown, cutoff: number) => awareInstant(value) && Date.parse(value) <= cutoff;

/** A paged reference is a set of actual responses, never one invented raw
 * response. The producer authenticates their capture and seals the manifest. */
function validObservedEvidence(r: Record<string, unknown>, session: string, root: string): boolean {
  if (!exactKeys(r, ["schema", "scope", "root", "source_session", "effective_from", "effective_to", "known_at",
    "security_id", "listing_key", "input_sha256", "contract_keys", "observed_contract_keys",
    "reference_observation_sha256", "reference_pages", "security_master_sha256", "listing_sha256",
    "listing_receipt_sha256", "source_evidence_representation", "source_evidence_basis", "source_input_artifacts",
    "historical_first_availability_established", "root_alias_created", "binding_sha256"])
    || r.scope !== "observed_contracts" || r.source_evidence_representation !== "captured_reference_population_observation"
    || !Array.isArray(r.reference_pages) || !r.reference_pages.length || r.reference_pages.length > 20) return false;
  const cutoff = Date.parse(r.known_at as string);
  const scope: Record<string, unknown> = { underlying_ticker: root, as_of: session, "expiration_date.gte": session,
    expired: "false", order: "asc", sort: "ticker", limit: 1000 };
  const cursors = new Set<string>();
  let bytes = 0, contracts = 0;
  for (const [i, page] of r.reference_pages.entries()) {
    if (!object(page) || !exactKeys(page, ["params", "response_sha256", "completed_at", "response_bytes", "contracts"])
      || !digest(page.response_sha256) || page.response_sha256 === r.reference_observation_sha256 || !knownBy(page.completed_at, cutoff)
      || !count(page.response_bytes) || page.response_bytes === 0 || (page.response_bytes as number) > 1024 * 1024
      || !count(page.contracts) || (page.contracts as number) > 1000 || !object(page.params)) return false;
    const query = page.params;
    if (i === 0) {
      if (!exactKeys(query, Object.keys(scope)) || Object.keys(scope).some(key => query[key] !== scope[key])) return false;
    } else {
      if (typeof query.cursor !== "string" || !query.cursor.length || query.cursor.length > 8192 || cursors.has(query.cursor)
        || Object.keys(query).some(key => key !== "cursor" && (!Object.hasOwn(scope, key)
          || !["string", "number"].includes(typeof query[key]) || String(query[key]) !== String(scope[key])))) return false;
      cursors.add(query.cursor);
    }
    bytes += page.response_bytes as number; contracts += page.contracts as number;
  }
  if (bytes > 8 * 1024 * 1024 || contracts > 20_000
    || !Array.isArray(r.contract_keys) || r.contract_keys.length > contracts) return false;
  const artifacts = r.source_input_artifacts;
  if (!Array.isArray(artifacts)) return false;
  if (r.source_evidence_basis === "native_acquisition") return artifacts.length === 0;
  return r.source_evidence_basis === "retained_native_store_read" && artifacts.length === 2
    && new Set(artifacts.map(a => object(a) ? a.kind : null)).size === 2
    && artifacts.every(a => object(a) && exactKeys(a, ["kind", "sha256", "read_at"])
      && ["greeks", "oi"].includes(String(a.kind)) && digest(a.sha256) && knownBy(a.read_at, cutoff));
}

/** The producer owns capture authentication and receipt sealing. At this
 * boundary, preserve the declared series scope and its actual known-by clock;
 * a dated binding must never become a reusable root or instantaneous identity. */
function validDatedIdentity(raw: Record<string, unknown>, session: string): boolean {
  if (raw.contract_identity === undefined) return true;
  const r = raw.contract_identity;
  if (!object(r)) return false;
  const observed = r.schema === "options.dated_contract_identity/v2";
  const identity = identityRoot(r.root, observed);
  // The identity's own first effective date bounds its sessions: QQQ cannot be
  // qualified onto a pre-effective source session and no v1 binding reaches it.
  if (!identity || (identity.first_session !== null && session < identity.first_session)) return false;
  if (raw.kind !== "dated_provider_approximation" || !object(raw.clocks)
    || (!observed && (r.schema !== "options.dated_contract_identity/v1" || r.scope !== "selected_contracts"))
    || r.root !== raw.root || r.source_session !== session
    || r.security_id !== identity.security_id || r.security_id !== raw.security_id || r.listing_key !== identity.listing_key
    || r.input_sha256 !== raw.input_sha256 || r.effective_from !== session
    || !Number.isFinite(Date.parse(session)) || r.effective_to !== new Date(Date.parse(session) + 86400_000).toISOString().slice(0, 10)
    || r.root_alias_created !== false || r.historical_first_availability_established !== false
    || (!observed && ["observed_contract_keys", "reference_pages", "source_evidence_basis", "source_input_artifacts"].some(key => Object.hasOwn(r, key)))
    || (!observed && (r.source_evidence_representation !== "captured_parsed_reference_observation" || !digest(r.source_response_sha256)))
    || ["input_sha256", "reference_observation_sha256", "security_master_sha256",
      "listing_sha256", "listing_receipt_sha256", "binding_sha256"].some(key => !digest(r[key]))
    || !awareInstant(r.known_at) || Date.parse(r.known_at) < Date.parse(session)
    || Date.parse(r.known_at) > Date.parse(raw.clocks.available_at as string)
    || !Array.isArray(r.contract_keys) || r.contract_keys.length > (observed ? 100_000 : 22)
    || (!observed && !r.contract_keys.length) || (observed && !validObservedEvidence(r, session, r.root as string))) return false;
  const keys = observed ? r.observed_contract_keys : r.contract_keys;
  if (!Array.isArray(keys) || !keys.length || keys.length > 100_000) return false;
  const members = new Set<string>(), coordinates = new Map<string, number>(), expiries = new Set<string>();
  for (const key of keys) {
    if (!Array.isArray(key) || key.length !== 3 || typeof key[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key[0])
      || !Number.isFinite(Date.parse(key[0])) || new Date(key[0]).toISOString().slice(0, 10) !== key[0] || key[0] < session
      || typeof key[1] !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(key[1])
      || !Number.isFinite(Number(key[1])) || Number(key[1]) <= 0 || !["C", "P"].includes(key[2])) return false;
    const coordinate = `${key[0]}|${Number(key[1])}`, member = `${coordinate}|${key[2]}`;
    if (members.has(member)) return false;
    members.add(member); expiries.add(key[0]); coordinates.set(coordinate, (coordinates.get(coordinate) ?? 0) + 1);
  }
  const boundCoordinates = new Map<string, number>();
  if (observed) {
    const bound = new Set<string>();
    for (const key of r.contract_keys) {
      if (!Array.isArray(key) || key.length !== 3) return false;
      // Match the canonical strings, not just equivalent JS numeric values.
      const member = JSON.stringify(key);
      if (bound.has(member)) return false;
      bound.add(member);
    }
    for (const key of keys) {
      if (bound.delete(JSON.stringify(key))) {
        const coordinate = `${key[0]}|${Number(key[1])}`;
        boundCoordinates.set(coordinate, (boundCoordinates.get(coordinate) ?? 0) + 1);
      }
    }
    if (bound.size) return false;
  }
  if ((!observed && expiries.size !== 1) || coordinates.size > 50_000
    || !Array.isArray(raw.cells) || raw.cells.length !== coordinates.size) return false;
  return raw.cells.every(cell => {
    if (!object(cell)) return false;
    const expected = coordinates.get(`${cell.expiry}|${cell.strike}`);
    // Missing references remain in the observed denominator and cannot acquire
    // qualified exposure merely because their coordinate is present.
    return expected !== undefined && [...metrics, "joint"].every(metric => {
      const coverage = cell[metric];
      return object(coverage) && count(coverage.qualified) && count(coverage.missing)
        && coverage.qualified + coverage.missing === expected
        && (!observed || coverage.qualified <= (boundCoordinates.get(`${cell.expiry}|${cell.strike}`) ?? 0));
    });
  });
}

/** Expand the lossless wire representation only; qualification remains the v1
 * validator below. Tables save repeated digests without changing populations. */
export function expandExposureProjection(raw: unknown): unknown {
  if (!object(raw) || raw.schema !== "options_hub.exposure_projection/v2") return raw;
  const fields = {
    cell_fields: ["expiry_index", "strike", "population_index", "metrics", "joint"],
    metric_fields: ["expected", "received", "qualified", "missing", "status_index", "net", "gross", "known_net", "known_gross", "qualified_population_index", "call", "put", "exclusions"],
    joint_fields: ["expected", "received", "qualified", "missing", "population_index", "model_index", "complete"],
  };
  // Field arrays are an exact versioned contract, never a permissive user mapping.
  if (raw.cell_encoding !== "tuple-v1" || JSON.stringify(raw.metric_order) !== JSON.stringify(metrics)
    || JSON.stringify(raw.metric_statuses) !== JSON.stringify(["unavailable", "partial", "complete_observed", "complete_expected"])
    || !object(raw.metric_units) || metrics.some(m => (raw.metric_units as Record<string, unknown>)[m] !== units[m])
    || !Array.isArray(raw.expiry_terms) || !Array.isArray(raw.population_ids) || !Array.isArray(raw.model_refs)
    || !raw.population_ids.every(digest) || !raw.model_refs.every(m => typeof m === "string" && m.length > 0)
    || !Array.isArray(raw.cells) || raw.cells.length > 50_000) return null;
  for (const [key, value] of Object.entries(fields)) if (JSON.stringify(raw[key]) !== JSON.stringify(value)) return null;
  const index = (n: unknown, table: unknown[]) => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < table.length;
  const terms = raw.expiry_terms, populations = raw.population_ids, models = raw.model_refs, statuses = raw.metric_statuses as string[];
  const cells = [];
  for (const row of raw.cells) {
    if (!Array.isArray(row) || row.length !== 5 || !index(row[0], terms) || !index(row[2], populations)
      || !Array.isArray(row[3]) || row[3].length !== 3 || !Array.isArray(row[4]) || row[4].length !== 7) return null;
    const term = terms[row[0]];
    if (!Array.isArray(term) || term.length !== 2 || typeof term[0] !== "string" || (term[1] !== null && typeof term[1] !== "string")) return null;
    const cell: Record<string, unknown> = { expiry: term[0], economic_expiry_at: term[1], strike: row[1], population_id: populations[row[2]] };
    for (let i = 0; i < 3; i++) {
      const tuple = row[3][i];
      if (!Array.isArray(tuple) || tuple.length !== 13 || !index(tuple[4], statuses) || !index(tuple[9], populations)) return null;
      cell[metrics[i]] = { unit: units[metrics[i]], expected: tuple[0], received: tuple[1], qualified: tuple[2], missing: tuple[3], status: statuses[tuple[4]], net: tuple[5], gross: tuple[6], known_net: tuple[7], known_gross: tuple[8], qualified_population_id: populations[tuple[9]], call: tuple[10], put: tuple[11], exclusions: tuple[12] };
    }
    if (!index(row[4][4], populations) || (row[4][5] !== null && !index(row[4][5], models))) return null;
    const joint = row[4];
    cell.joint = { expected: joint[0], received: joint[1], qualified: joint[2], missing: joint[3],
      population_id: populations[joint[4]], model_ref: joint[5] === null ? null : models[joint[5]], complete: joint[6] };
    cells.push(cell);
  }
  return { ...raw, schema: "options_hub.exposure_projection/v1", cells };
}

/** Strict consumer of the incumbent producer contract; never promotes legacy marginals. */
export function qualifiedExposureProjection(raw: unknown, root: string, session: string, now: number): QualifiedProjection | null {
  if (!canonicalSession(session) || !Number.isFinite(now)) return null;
  raw = expandExposureProjection(raw);
  if (!object(raw) || raw.schema !== "options_hub.exposure_projection/v1" || raw.root !== root || !["modeled_exposure", "dated_provider_approximation"].includes(String(raw.kind))
    || !digest(raw.input_sha256)
    || raw.scale !== "dollars" || raw.position_basis !== "assumed_long_call_short_put"
    || typeof raw.source_snapshot_ref !== "string" || !raw.source_snapshot_ref || typeof raw.security_id !== "string" || !raw.security_id
    || !object(raw.clocks) || raw.clocks.source_session !== session || raw.clocks.oi_report_date !== session || !object(raw.population) || !digest(raw.population.id)
    || !["observed_population", "supplied_expected_population"].includes(raw.population.scope as string)
    || raw.population.full_universe_complete !== false || raw.population.full_universe_expected !== null
    || (raw.greek_provenance != null && !object(raw.greek_provenance)) || !Array.isArray(raw.cells) || !raw.cells.length || raw.cells.length > 50_000
    || raw.cells_status !== "complete" || raw.cell_count !== raw.cells.length) return null;
  const dated = raw.kind === "dated_provider_approximation";
  if (raw.underlying_reference !== undefined) {
    const reference = raw.underlying_reference;
    if (!dated || !object(reference) || reference.currency !== "USD" || reference.source_session !== session
      || reference.basis !== (reference.value === null ? "nonuniform_or_missing_selected_underlying_prices" : "uniform_selected_contract_underlying_price") || reference.instantaneous !== false
      || (reference.value !== null && (!finite(reference.value) || reference.value <= 0))) return null;
  }
  if (dated) {
    const v = raw.valuation, c = raw.capabilities;
    if (!object(v) || v.basis !== "provider_eod_approximation" || v.source_session !== session || v.observation_clock !== "session_only"
      || v.endpoint !== "/v3/option/history/greeks/eod" || v.requested_version !== "1" || v.serving_build !== null
      || v.tenor_policy !== "provider_eod_whole_days_0dte_0.15"
      || v.methodology_ref !== "https://www.thetadata.net/docs/Articles/Data-And-Requests/Option-Greeks.html"
      || !object(c) || c.dated_cells !== true
      || ["instantaneous", "next_live", "joint_scenario", "repricing", "historical_pit"].some(key => c[key] !== false)) return null;
  }
  const instants = ["option_observed_at", "underlying_observed_at", "greeks_available_at", "oi_available_at", "available_at"];
  const clocks = raw.clocks;
  for (const key of instants) {
    const value = clocks[key];
    if (dated && ["option_observed_at", "underlying_observed_at"].includes(key) && value === null) continue;
    if (!awareInstant(value) || Date.parse(value) > now) return null;
    if (key !== "available_at" && Date.parse(value) > Date.parse(clocks.available_at as string)) return null;
  }
  if (clocks.option_observed_at != null && Date.parse(clocks.greeks_available_at as string) < Date.parse(clocks.option_observed_at as string)) return null;
  for (const key of ["option_observed_at", "underlying_observed_at"]) {
    if (dated && clocks[key] === null) continue;
    if (new Date(clocks[key] as string).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) !== session) return null;
  }
  if (!validDatedIdentity(raw, session)) return null;
  const seen = new Set<string>();
  for (const cell of raw.cells) {
    if (!object(cell) || !finite(cell.strike) || cell.strike <= 0 || typeof cell.expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(cell.expiry)
      || !Number.isFinite(Date.parse(cell.expiry)) || new Date(cell.expiry).toISOString().slice(0, 10) !== cell.expiry || !digest(cell.population_id)) return null;
    const identity = `${cell.expiry}|${cell.strike}`;
    if (seen.has(identity)) return null; seen.add(identity);
    const joint = cell.joint;
    if (!object(joint) || !count(joint.received) || !count(joint.qualified) || !count(joint.missing)
      || joint.received > joint.qualified + joint.missing
      || (joint.expected !== null && (!count(joint.expected) || joint.expected !== joint.qualified + joint.missing))
      || !digest(joint.population_id) || typeof joint.complete !== "boolean"
      || (joint.model_ref !== null && (typeof joint.model_ref !== "string" || !joint.model_ref))
      || (joint.complete && (joint.missing !== 0 || joint.qualified === 0))) return null;
    if (dated && joint.complete) return null;
    for (const metric of metrics) {
      const m = cell[metric];
      if (!object(m) || m.unit !== units[metric] || !count(m.received) || !count(m.qualified) || !count(m.missing)
        || m.received > m.qualified + m.missing
        || (m.expected !== null && (!count(m.expected) || m.expected !== m.qualified + m.missing)) || !digest(m.qualified_population_id)
        || (m.net !== null && !finite(m.net)) || (m.gross !== null && (!finite(m.gross) || m.gross < 0))) return null;
      if (dated && metric !== "gamma" && (m.net !== null || m.gross !== null)) return null;
      if (m.net !== null || m.gross !== null) {
        if (m.missing !== 0 || m.qualified === 0 || cell.expiry < session || !["complete_observed", "complete_expected"].includes(m.status as string)
          || (m.status === "complete_expected") !== (m.expected !== null)
          || (m.gross === 0 && m.net !== 0)
          || m.net === null || m.gross === null || m.gross + Math.max(1, Math.abs(m.net)) * 1e-12 < Math.abs(m.net)) return null;
        // Qualified zero-OI members need no Greek. Net cancellation with nonzero
        // gross still needs the source's model and units.
        const provenance = object(raw.greek_provenance) ? raw.greek_provenance[metric] : null;
        if (m.gross !== 0 && (!object(provenance) || typeof provenance.model_ref !== "string" || !provenance.model_ref || provenance.source_ref !== raw.source_snapshot_ref)) return null;
      }
      // Covered contributions are usable only with their own qualification,
      // units and source provenance. Never replace missing members with zero.
      if (metric === "gamma" && m.missing > 0 && m.qualified > 0
        && (!finite(m.known_net) || !finite(m.known_gross))) return null;
      if (m.known_net != null || m.known_gross != null) {
        if (!finite(m.known_net) || !finite(m.known_gross) || m.known_gross < 0 || m.qualified === 0
          || cell.expiry < session || (dated && metric !== "gamma")
          || !["partial", "complete_observed", "complete_expected"].includes(m.status as string)
          || (m.net === null && (m.missing === 0 || m.status !== "partial" || m.gross !== null))
          || (m.known_gross === 0 && m.known_net !== 0)
          || m.known_gross + Math.max(1, Math.abs(m.known_net)) * 1e-12 < Math.abs(m.known_net)
          || (m.net != null && (m.known_net !== m.net || m.known_gross !== m.gross))) return null;
        const provenance = object(raw.greek_provenance) ? raw.greek_provenance[metric] : null;
        if (m.known_gross !== 0 && (!object(provenance) || typeof provenance.model_ref !== "string"
          || !provenance.model_ref || provenance.source_ref !== raw.source_snapshot_ref)) return null;
      }
    }
  }
  return raw as unknown as QualifiedProjection;
}

export function selectedProjectionCells(p: QualifiedProjection, lens: ExposureLens, now = Date.now()): Cell[] {
  if (lens.kind === "next-live" || lens.kind === "week") {
    if (p.kind === "dated_provider_approximation") return [];
    // Date labels cannot identify an intraday fixing/expiry boundary.
    if (!Number.isFinite(now) || p.cells.some((c) => !c.economic_expiry_at || !/(Z|[+-]\d{2}:\d{2})$/.test(c.economic_expiry_at) || !Number.isFinite(Date.parse(c.economic_expiry_at)))) return [];
    const live = p.cells.filter((c) => Date.parse(c.economic_expiry_at!) > now);
    if (lens.kind === "next-live") {
      const next = Math.min(...live.map((c) => Date.parse(c.economic_expiry_at!)));
      return live.filter((c) => Date.parse(c.economic_expiry_at!) === next);
    }
    const date = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const day = Date.parse(date), weekday = (new Date(day).getUTCDay() + 6) % 7;
    const monday = day - weekday * 86400_000;
    return live.filter((c) => Date.parse(c.expiry) >= monday && Date.parse(c.expiry) < monday + 7 * 86400_000);
  }
  return p.cells.filter((c) => lens.kind === "all" || (lens.kind === "zero" && c.expiry === p.clocks.source_session)
    || (lens.kind === "ex-zero" && c.expiry !== p.clocks.source_session) || (lens.kind === "one" && c.expiry === lens.exp));
}

/** Explicit local shock through the existing scenario owner, only over identical qualified members. */
export function projectedExposureScenario(p: QualifiedProjection, cell: Cell, shock: ExposureShock): number | null {
  if (p.kind === "dated_provider_approximation") return null;
  const weights = { gamma: shock.spotPercent, vanna: shock.ivPoints, charm: shock.calendarDays };
  if (!Object.values(weights).every(Number.isFinite) || Math.abs(shock.spotPercent) > 3 || Math.abs(shock.ivPoints) > 5 || shock.calendarDays < 0 || shock.calendarDays > 5) return null;
  const active = metrics.filter((m) => weights[m] !== 0);
  if (!active.length) return 0;
  // The producer's joint receipt covers all three Greeks. Its digest names
  // series/terms, whereas metric digests name source-bound contract identities;
  // those distinct namespaces must never be compared as if they were equal.
  if (active.length === metrics.length && (!cell.joint.complete || active.some(m => cell[m].qualified !== cell.joint.qualified))) return null;
  if (active.some((m) => cell[m].net == null)) return null;
  if (new Set(active.map((m) => cell[m].qualified_population_id)).size !== 1) return null;
  const models = active.filter((m) => cell[m].gross !== 0).map((m) => p.greek_provenance?.[m]?.model_ref);
  if (models.some((m) => !m) || new Set(models).size > 1) return null;
  if (active.length === metrics.length && models.length && cell.joint.model_ref !== models[0]) return null;
  const grid = scenarioGrid({ gammaMn: weights.gamma === 0 ? 0 : cell.gamma.net! / 1e6, gammaKnown: 1,
    vannaMn: weights.vanna === 0 ? 0 : cell.vanna.net! / 1e6, charmMn: weights.charm === 0 ? 0 : cell.charm.net! / 1e6,
    deltaMn: null, callAbsMn: 0, putAbsMn: 0, nStrikes: 1, nStrikesFull: null, windowed: true },
    { dsPct: [shock.spotPercent], dVolPts: [shock.ivPoints], dtDays: shock.calendarDays });
  const value = grid.cells[0][0]; return finite(value) ? value : null;
}

export function projectionNodes(p: QualifiedProjection, lens: ExposureLens, metric: QualifiedMetric | "combined", shock: ExposureShock, now = Date.now()) {
  const selected = selectedProjectionCells(p, lens, now);
  const groups = new Map<number, Cell[]>();
  for (const cell of selected) {
    const group = groups.get(cell.strike);
    if (group) group.push(cell); else groups.set(cell.strike, [cell]);
  }
  const coveredOnly = metric === "gamma" && selected.some(c => c.gamma.missing > 0);
  const gammaSum = (cells: Cell[], key: "net" | "gross") => {
    const values = cells.map(c => c.gamma[key] ?? c.gamma[key === "net" ? "known_net" : "known_gross"] ?? null);
    // Null cells remain present in rows and coverage; only the explicitly
    // labeled measured subtotal can omit their unknown contribution.
    const value = sum(coveredOnly ? values.filter((v): v is number => v != null) : values);
    return value == null ? null : value / 1e6;
  };
  const rows: ExposureNodeInput[] = [...groups].map(([strike, cells]) => ({ strike,
    netMn: metric === "combined" ? sum(cells.map((c) => projectedExposureScenario(p, c, shock)))
      : metric === "gamma" ? gammaSum(cells, "net") : sum(cells.map((c) => c[metric].net == null ? null : c[metric].net / 1e6)),
    grossMn: metric === "gamma" ? gammaSum(cells, "gross") : null }));
  const coverage = metric === "combined" ? null : {
    expected: selected.some((c) => c[metric].expected == null) ? null : selected.reduce((n, c) => n + c[metric].expected!, 0),
    received: selected.reduce((n, c) => n + c[metric].received, 0), qualified: selected.reduce((n, c) => n + c[metric].qualified, 0), missing: selected.reduce((n, c) => n + c[metric].missing, 0),
  };
  return { rows, coverage, coveredOnly };
}
