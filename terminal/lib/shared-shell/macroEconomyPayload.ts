import { record, type Pair } from "./readingPayloads";

/** Presentation identities only. Macro's published registry owns admission. */
export const ECONOMIC_WORKSPACES = {
  liquidity_regime: { en: "Money & funding", zh: "货币与融资", path: "/macro_liquidity_regime.html", section: "money" },
  liquidity_central_banks: { en: "Central-bank liquidity", zh: "央行流动性", path: "/macro_liquidity_central_banks.html", section: "money" },
  monetary_policy: { en: "Policy rates", zh: "政策利率", path: "/macro_monetary_policy.html", section: "policy" },
  rates_curves: { en: "Rates & the curve", zh: "利率与收益率曲线", path: "/macro_rates_curves.html", section: "rates" },
  inflation_system: { en: "Inflation", zh: "通货膨胀", path: "/macro_inflation_system.html", section: "inflation" },
  growth_real_economy: { en: "Growth", zh: "经济增长", path: "/macro_growth_real_economy.html", section: "growth" },
  business_activity: { en: "Business activity", zh: "商业活动", path: "/macro_business_activity.html", section: "growth" },
  labor_markets: { en: "Jobs", zh: "就业", path: "/macro_labor_markets.html", section: "jobs" },
  housing_real_estate: { en: "Housing", zh: "住房", path: "/macro_housing_real_estate.html", section: "housing" },
  consumer_payments: { en: "Consumers", zh: "消费者", path: "/macro_consumer_payments.html", section: "consumer" },
  financial_conditions: { en: "Borrowing conditions", zh: "融资环境", path: "/macro_financial_conditions.html", section: "credit" },
  capital_structure: { en: "Corporate financing", zh: "企业融资", path: "/macro_capital_structure.html", section: "credit" },
  national_debt_liabilities: { en: "Government debt", zh: "政府债务", path: "/macro_national_debt_liabilities.html", section: "debt" },
  trade_flows: { en: "Trade", zh: "贸易", path: "/macro_trade_flows.html", section: "trade" },
} as const;
export type EconomicWorkspaceId = keyof typeof ECONOMIC_WORKSPACES;
export const economicWorkspaceId = (value: unknown): value is EconomicWorkspaceId => typeof value === "string" && Object.hasOwn(ECONOMIC_WORKSPACES, value);
export type EconomicTask = "overview" | "drivers" | "history";
export type EconomicWindow = "3m" | "1y" | "published";
export const ECONOMIC_TENORS = ["3m", "6m", "1y", "2y", "3y", "5y", "7y", "10y", "20y", "30y"] as const;
export type EconomicTenor = typeof ECONOMIC_TENORS[number];
export type EconomicSelection = { task: EconomicTask; series: string | null; window: EconomicWindow; observation: string | null; display: "chart" | "table"; evidence: string | null; tenor: EconomicTenor; comparison: "prior_close" | "prior_month" };

export function economicSelection(params: Pick<URLSearchParams, "getAll">): EconomicSelection | null {
  const one = (key: string) => { const all = params.getAll(key); return all.length > 1 ? undefined : all[0] ?? null; };
  const task = one("study"), series = one("series"), window = one("window"), observation = one("observation"), display = one("display"), evidence = one("evidence"), tenor = one("tenor"), comparison = one("comparison");
  if ([task, series, window, observation, display, evidence, tenor, comparison].includes(undefined)) return null;
  if (task !== null && !["overview", "drivers", "history"].includes(task!) || window !== null && !["3m", "1y", "published"].includes(window!) || display !== null && !["chart", "table"].includes(display!)) return null;
  if (series !== null && !identity(series) || evidence !== null && !identity(evidence) || !date(observation)) return null;
  if (tenor !== null && !ECONOMIC_TENORS.includes(tenor as EconomicTenor) || comparison !== null && comparison !== "prior_close" && comparison !== "prior_month") return null;
  return { task: (task ?? "overview") as EconomicTask, series: series!, window: (window ?? "1y") as EconomicWindow, observation: observation!, display: (display ?? "chart") as "chart" | "table", evidence: evidence!, tenor: (tenor ?? "10y") as EconomicTenor, comparison: (comparison ?? "prior_close") as EconomicSelection["comparison"] };
}
export function economicSelectionSearch(search: string, change: Partial<EconomicSelection>): string {
  const params = new URLSearchParams(search);
  const keys = { task: "study", series: "series", window: "window", observation: "observation", display: "display", evidence: "evidence", tenor: "tenor", comparison: "comparison" } as const;
  for (const key of Object.keys(change) as (keyof EconomicSelection)[]) {
    params.delete(keys[key]);
    const value = change[key];
    if (value) params.set(keys[key], value);
  }
  return params.toString();
}

type Absence = { label: Pair | null } | null;
export type EconomicArtifact = { path: string; manifest_path: string; sha256: string; bytes: number; min_client_contract: string };
type CommandSource = { served_root_qualified: true; manifest_generated_at: string; manifest_sha256: string; composed_at: string; min_client_contract: string };
export type EconomicPoint = { t: string; v: number | null };
export type EconomicSeries = {
  series_id: string; label: Pair; unit: Pair; basis: Pair; count: number; first: string | null; last: string | null;
  points: EconomicPoint[] | null; source_ref: string | null; freshness: Pair; freshness_tone: string;
  revision_behavior: string | null; unit_token?: string | null; basis_token?: string | null; freshness_token?: string | null;
};
export type EconomicMetric = {
  metric_id: string; label: Pair; value: Pair | null; value_raw?: number | string | boolean | null;
  unit: Pair | null; basis: Pair | null; absence: Absence; reference_period: string | null;
  freshness: Pair | null; freshness_tone: string; coverage: string | null; source_refs: string[];
  transformation: string | null; definition_version: string | null;
};
export type EconomicDelta = {
  metric_id: string; label: Pair | null; prior: string | null; current: string | null; delta: string | null;
  prior_raw: number | null; current_raw: number | null; delta_raw: number | null;
  prior_present: boolean; current_present: boolean; delta_present: boolean; comparable: boolean; is_movement: boolean; absence: Absence;
};
export type EconomicSource = {
  source_id: string; label: Pair; provider: string | null; transform: string | null; owner_ref: string | null;
  rights: Pair | null; freshness: Pair | null; artifact_ref: string | null;
  clocks: { name: Pair; meaning: Pair; value: string | null }[];
};
/** Existing producers use both source_id and FRED:<series>. Resolve the latter
 * only through an exact published artifact identity, never a guessed label. */
export function economicSourceIds(refs: string[], sources: EconomicSource[]): string[] {
  return refs.flatMap(ref => {
    if (sources.some(row => row.source_id === ref)) return [ref];
    const match = /^FRED:([A-Z0-9_]+)$/.exec(ref);
    const candidates = match ? sources.filter(row => row.artifact_ref === `data/fred/${match[1]}.parquet`) : [];
    return candidates.length === 1 ? [candidates[0].source_id] : [];
  });
}
export type EconomicCurve = {
  ok: boolean; shape_read: Pair; as_of_caption: Pair | null; null_panel: Pair;
  tenors: { tenor: string; label: Pair; as_of_tenor: string | null; today: number | null; prior_close: number | null; prior_month: number | null; delta_close: number | null; delta_month: number | null; prior_close_as_of?: string | null; prior_month_as_of?: string | null }[];
};
export type EconomicWorkspaceView = {
  ok: true; workspace: { id: EconomicWorkspaceId; title: Pair; subtitle: Pair | null }; region: { code: "US"; supported: true };
  context: { state: string; state_label: Pair; worst_freshness_token: string; worst_freshness: Pair; coverage: string | null;
    required: { component_id: string; label: Pair; source_asof: string | null; freshness: Pair | null; freshness_state: string; presence: Pair | null }[] };
  headline: { state_id: string | null; state_label: Pair | null; subtitle: Pair | null; effective_date: string | null; method_version: string | null;
    hysteresis: { held_prior: boolean; note: Pair | null } };
  axes: { axis_id: string; label: Pair; value: string | null; value_raw: number | null; value_with_unit: Pair | null; absence: Absence }[];
  changes: { comparable: boolean; comparability: string; prior_is_earlier: boolean; prior_effective_date: string | null; absence: Absence; deltas: EconomicDelta[] };
  metrics: EconomicMetric[];
  drivers: { group_id: string; title: Pair; absent: boolean; absence: Absence; rows: { driver_id: string; label: Pair; value: Pair | null; unit: Pair | null; coverage: Pair | null; absence: Absence; note: string | null; impact: string | null; impact_present: boolean; impact_sign: "up" | "down" | "flat" | null; impact_absence: Absence }[] }[];
  implications: { entries: { implication_id: string; text: Pair; evidence_label: Pair | null; evidence_claim: Pair | null }[]; absent: boolean; absence_text: Pair };
  series: { entries: EconomicSeries[]; absent: boolean; absence: Absence };
  evidence: { sources: EconomicSource[]; generation: { generation_id: string; content_sha256: string; calculation_as_of: string | null };
    artifact: EconomicArtifact; authority: { class: "context_only"; statement: Pair; flags: { value: false }[] };
    corrections: { state: Pair; predecessor: string | null; changed_fingerprints: string[]; changed_sources: Pair | null; note: Pair | null; predecessor_label: Pair | null } };
  curve_hero?: EconomicCurve;
};
export type EconomicWorkspaceRead = { source: CommandSource; selected_workspace: { workspace_id: EconomicWorkspaceId; region: "US" } & (
  { state: "ready"; generation_id: string; artifact: EconomicArtifact; view: EconomicWorkspaceView; failure: null } |
  { state: "unavailable"; generation_id: null; artifact: null; view: null; failure: { kind: string; detail: string } }
) };

const text = (v: unknown): v is string => typeof v === "string" && v.length <= 20000;
const nullableText = (v: unknown): v is string | null => v === null || text(v);
const identity = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const pair = (v: unknown): v is Pair => record(v) && text(v.en) && text(v.zh);
const nullablePair = (v: unknown): boolean => v === null || pair(v);
const finite = (v: unknown): v is number | null => v === null || typeof v === "number" && Number.isFinite(v);
const absence = (v: unknown): boolean => v === null || record(v) && nullablePair(v.label);
const hash = (v: unknown): boolean => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const clock = (v: unknown): boolean => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
function date(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const stamp = new Date(v + "T00:00:00Z");
  return Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === v;
}
function list(v: unknown, check: (row: Record<string, unknown>) => boolean, max = 100): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length <= max && v.every(row => record(row) && check(row));
}
function unique(rows: Record<string, unknown>[], key: string): boolean { return new Set(rows.map(row => row[key])).size === rows.length; }
function artifact(v: unknown, id: EconomicWorkspaceId): v is EconomicArtifact {
  return record(v) && v.path === `macrodata/workspaces/${id}/US/latest.json` && v.manifest_path === "macrodata/workspaces/manifest.json" && hash(v.sha256) && Number.isSafeInteger(v.bytes) && (v.bytes as number) > 0 && (v.bytes as number) <= 2 * 1024 * 1024 && v.min_client_contract === "mastermind.macro_workspace_snapshot.v1@1.0.0";
}
function validPoints(points: unknown): points is EconomicPoint[] {
  if (!list(points, p => typeof p.t === "string" && date(p.t) && finite(p.v), 5000)) return false;
  return points.every((p, i) => i === 0 || (points[i - 1].t as string) < (p.t as string));
}
const clocks = (v: unknown) => list(v, row => pair(row.name) && pair(row.meaning) && nullableText(row.value), 12);

/** Only validates transport and consumed fields. Macro remains the semantic,
 * financial and publication authority. Never parses numbers from display copy. */
export function macroEconomyPayload(input: unknown, expected: EconomicWorkspaceId): EconomicWorkspaceRead | null {
  if (!record(input) || input.schema !== "mastermind.macro_command_workspace_read.v1" || !record(input.source) || !record(input.selected_workspace)) return null;
  const source = input.source, selected = input.selected_workspace;
  if (source.served_root_qualified !== true || !hash(source.manifest_sha256) || !clock(source.manifest_generated_at) || !clock(source.composed_at) || source.min_client_contract !== "mastermind.macro_workspace_snapshot.v1@1.0.0" || selected.workspace_id !== expected || selected.region !== "US") return null;
  if (selected.state === "unavailable") {
    return selected.generation_id === null && selected.artifact === null && selected.view === null && record(selected.failure) && text(selected.failure.kind) && text(selected.failure.detail) ? input as unknown as EconomicWorkspaceRead : null;
  }
  const v = selected.view;
  if (selected.state !== "ready" || selected.failure !== null || !artifact(selected.artifact, expected) || !text(selected.generation_id) || !selected.generation_id || !record(v) || v.ok !== true || !record(v.workspace) || v.workspace.id !== expected || !pair(v.workspace.title) || !nullablePair(v.workspace.subtitle) || !record(v.region) || v.region.code !== "US" || v.region.supported !== true) return null;
  const e = v.evidence;
  if (!record(e) || !record(e.generation) || e.generation.generation_id !== selected.generation_id || e.generation.content_sha256 !== selected.artifact.sha256 || !date(e.generation.calculation_as_of) || !artifact(e.artifact, expected) || e.artifact.sha256 !== selected.artifact.sha256 || e.artifact.bytes !== selected.artifact.bytes || !record(e.authority) || e.authority.class !== "context_only" || !pair(e.authority.statement) || !list(e.authority.flags, flag => flag.value === false, 5) || e.authority.flags.length !== 5) return null;
  if (!list(e.sources, row => identity(row.source_id) && pair(row.label) && nullableText(row.provider) && nullableText(row.transform) && nullableText(row.owner_ref) && nullablePair(row.rights) && nullablePair(row.freshness) && nullableText(row.artifact_ref) && clocks(row.clocks), 160) || !unique(e.sources, "source_id")) return null;
  const corrections = e.corrections;
  if (!record(corrections) || !pair(corrections.state) || !nullableText(corrections.predecessor) || !nullablePair(corrections.changed_sources) || !nullablePair(corrections.note) || !nullablePair(corrections.predecessor_label) || !Array.isArray(corrections.changed_fingerprints) || corrections.changed_fingerprints.length > 200 || !corrections.changed_fingerprints.every(text)) return null;
  const h = v.headline, c = v.context, changes = v.changes;
  if (!record(h) || !nullableText(h.state_id) || !nullablePair(h.state_label) || !nullablePair(h.subtitle) || !date(h.effective_date) || !nullableText(h.method_version) || !record(h.hysteresis) || typeof h.hysteresis.held_prior !== "boolean" || !nullablePair(h.hysteresis.note)) return null;
  if (!record(c) || !text(c.state) || !pair(c.state_label) || !text(c.worst_freshness_token) || !pair(c.worst_freshness) || !nullableText(c.coverage) || !list(c.required, row => identity(row.component_id) && pair(row.label) && date(row.source_asof) && nullablePair(row.freshness) && text(row.freshness_state) && nullablePair(row.presence), 80)) return null;
  if (!list(v.axes, row => identity(row.axis_id) && pair(row.label) && nullableText(row.value) && finite(row.value_raw) && nullablePair(row.value_with_unit) && absence(row.absence), 2)) return null;
  if (!record(changes) || typeof changes.comparable !== "boolean" || changes.comparable !== (changes.comparability === "COMPARABLE") || typeof changes.prior_is_earlier !== "boolean" || !date(changes.prior_effective_date) || !absence(changes.absence)) return null;
  if (changes.prior_is_earlier && !(changes.prior_effective_date && h.effective_date && changes.prior_effective_date < h.effective_date)) return null;
  if (!list(changes.deltas, row => identity(row.metric_id) && nullablePair(row.label) && finite(row.prior_raw) && finite(row.current_raw) && finite(row.delta_raw) && nullableText(row.prior) && nullableText(row.current) && nullableText(row.delta) && row.prior_present === (row.prior_raw !== null) && row.current_present === (row.current_raw !== null) && row.delta_present === (row.delta_raw !== null) && typeof row.comparable === "boolean" && typeof row.is_movement === "boolean" && absence(row.absence), 300)) return null;
  if (!list(v.metrics, row => identity(row.metric_id) && pair(row.label) && nullablePair(row.value) && nullablePair(row.unit) && nullablePair(row.basis) && absence(row.absence) && date(row.reference_period) && nullablePair(row.freshness) && text(row.freshness_tone) && nullableText(row.coverage) && Array.isArray(row.source_refs) && row.source_refs.every(text) && nullableText(row.transformation) && nullableText(row.definition_version), 300) || !unique(v.metrics, "metric_id")) return null;
  if (!list(v.drivers, group => identity(group.group_id) && pair(group.title) && typeof group.absent === "boolean" && absence(group.absence) && list(group.rows, row => identity(row.driver_id) && pair(row.label) && nullablePair(row.value) && nullablePair(row.unit) && nullablePair(row.coverage) && absence(row.absence) && nullableText(row.note) && nullableText(row.impact) && row.impact_present === (row.impact !== null) && (row.impact_sign === null || ["up", "down", "flat"].includes(row.impact_sign as string)) && (row.impact_present || row.impact_sign === null) && absence(row.impact_absence)), 8)) return null;
  if (!record(v.implications) || typeof v.implications.absent !== "boolean" || !pair(v.implications.absence_text) || !list(v.implications.entries, row => identity(row.implication_id) && pair(row.text) && nullablePair(row.evidence_label) && nullablePair(row.evidence_claim), 30)) return null;
  if (!record(v.series) || typeof v.series.absent !== "boolean" || !absence(v.series.absence) || !list(v.series.entries, row => identity(row.series_id) && pair(row.label) && pair(row.unit) && pair(row.basis) && Number.isSafeInteger(row.count) && (row.count as number) >= 0 && date(row.first) && date(row.last) && nullableText(row.source_ref) && pair(row.freshness) && text(row.freshness_tone) && nullableText(row.revision_behavior) && (row.points === undefined || validPoints(row.points)), 64) || !unique(v.series.entries, "series_id")) return null;
  let total = 0;
  for (const row of v.series.entries) {
    if (Array.isArray(row.points)) {
      const points = row.points as EconomicPoint[], values = points.filter(p => p.v !== null);
      total += points.length;
      if (row.count !== values.length || row.first !== (values[0]?.t ?? null) || row.last !== (values.at(-1)?.t ?? null)) return null;
    }
  }
  if (total > 60000) return null;
  let qualifiedCurve: EconomicCurve | undefined;
  if (v.curve_hero !== undefined) {
    const curve = v.curve_hero;
    if (expected !== "rates_curves" || !record(curve) || typeof curve.ok !== "boolean" || !pair(curve.shape_read) || !nullablePair(curve.as_of_caption) || !pair(curve.null_panel) || !list(curve.tenors, row => ECONOMIC_TENORS.includes(row.tenor as EconomicTenor) && pair(row.label) && date(row.as_of_tenor) && finite(row.today) && finite(row.prior_close) && finite(row.prior_month) && finite(row.delta_close) && finite(row.delta_month) && (row.prior_close_as_of === undefined || date(row.prior_close_as_of)) && (row.prior_month_as_of === undefined || date(row.prior_month_as_of)), 10) || curve.tenors.length !== 10 || !unique(curve.tenors, "tenor")) return null;
    if (curve.ok !== (curve.tenors.filter(row => row.today !== null).length >= 6)) return null;
    const tenors = [];
    for (const row of curve.tenors) {
      if ((row.today === null) !== (row.as_of_tenor === null)) return null;
      const qualified = { ...row };
      for (const window of ["prior_close", "prior_month"] as const) {
        const stamp = row[`${window}_as_of`], delta = window === "prior_close" ? "delta_close" : "delta_month";
        // Older view publishers omitted comparison dates. Retain current
        // observations but do not draw an unqualified historical comparison.
        if (stamp === undefined) { qualified[window] = null; qualified[delta] = null; qualified[`${window}_as_of`] = null; continue; }
        if ((row[window] === null) !== (stamp === null)) return null;
        if (row[window] !== null) {
          if (typeof stamp !== "string" || typeof row.as_of_tenor !== "string" || stamp >= row.as_of_tenor) return null;
          if (window === "prior_month" && Date.parse(row.as_of_tenor) - Date.parse(stamp) < 30 * 86400000) return null;
        }
      }
      tenors.push(qualified);
    }
    qualifiedCurve = { ...curve, tenors } as unknown as EconomicCurve;
  }
  // Older qualified publishers expose history metadata only. Keep the rest of
  // their useful evidence, but explicitly mark coordinates unavailable.
  return { ...input, selected_workspace: { ...selected, view: { ...v, ...(qualifiedCurve ? { curve_hero: qualifiedCurve } : {}), series: { ...v.series, entries: v.series.entries.map(row => ({ ...row, points: row.points ?? null })) } } } } as unknown as EconomicWorkspaceRead;
}
