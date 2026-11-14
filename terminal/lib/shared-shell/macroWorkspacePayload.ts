import { record, type Pair } from "./readingPayloads";

export const LIQUIDITY_WORKSPACE = "liquidity_regime";
export type MacroSelection = "overview" | "liquidity" | "invalid";
export function macroSelection(params: Pick<URLSearchParams, "getAll">): MacroSelection {
  const values = params.getAll("macroWorkspace");
  return values.length === 0 ? "overview" : values.length === 1 && values[0] === LIQUIDITY_WORKSPACE ? "liquidity" : "invalid";
}
export function macroWorkspaceHref(search: string, detail: boolean): string {
  const params = new URLSearchParams(search);
  params.delete("macroWorkspace");
  if (detail) params.set("macroWorkspace", LIQUIDITY_WORKSPACE);
  return `/intelligence${params.size ? `?${params}` : ""}`;
}

type Absence = { label: Pair | null } | null;
type Artifact = { path: string; manifest_path: string; sha256: string; bytes: number; min_client_contract: string };
type Source = { served_root_qualified: true; manifest_generated_at: string; manifest_sha256: string; composed_at: string; min_client_contract: string };
export type MacroDelta = {
  metric_id: string; label: Pair | null; prior: string | null; current: string | null; delta: string | null;
  prior_present: boolean; current_present: boolean; delta_present: boolean; comparable: boolean; is_movement: boolean;
  prior_raw: number | null; current_raw: number | null; delta_raw: number | null; absence: Absence;
};
export type LiquidityView = {
  ok: true; decision_first: true; workspace: { id: string; title: Pair; subtitle: Pair | null };
  region: { code: "US"; supported: true };
  context: { state: string; state_label: Pair | null; worst_freshness_token: string | null; worst_freshness: Pair | null;
    required: { component_id: string; label: Pair | null; source_asof: string | null; presence: Pair | null; freshness: Pair | null }[] };
  headline: { state_id: string | null; state_label: Pair | null; subtitle: Pair | null; effective_date: string | null; method_version: string | null;
    prior: { state_id: string | null; effective_date: string | null }; hysteresis: { held_prior: boolean; note: Pair | null } };
  axes: { axis_id: string; label: Pair | null; value: string | null; value_raw: number | null; value_with_unit: Pair | null; absence: Absence }[];
  changes: { comparable: boolean; comparability: string; comparability_label: Pair | null; prior_is_earlier: boolean; prior_effective_date: string | null; deltas: MacroDelta[]; absence: Absence };
  metrics: { metric_id: string; unit: Pair | null }[];
  drivers: { group_id: string; title: Pair | null; absent: boolean; absence: Absence;
    rows: { driver_id: string; label: Pair | null; value: Pair | null; unit: Pair | null; absence: Absence; coverage: Pair | null; impact: string | null; impact_present: boolean }[] }[];
  implications: { entries: { implication_id: string; text: Pair; evidence_label: Pair | null; evidence_claim: Pair | null }[]; absent: boolean; absence_text: Pair };
  series: { absent: boolean; absence: Absence };
  evidence: { generation: { generation_id: string; content_sha256: string; calculation_as_of: string | null };
    artifact: Artifact; authority: { class: "context_only"; statement: Pair; flags: { value: false }[] } };
};
export type MacroWorkspaceRead = { source: Source; selected_workspace: {
  workspace_id: typeof LIQUIDITY_WORKSPACE; region: "US";
} & ({ state: "ready"; generation_id: string; artifact: Artifact; view: LiquidityView; failure: null } | {
  state: "unavailable"; generation_id: null; artifact: null; view: null; failure: { kind: string; detail: string };
}) };

const text = (v: unknown): v is string => typeof v === "string" && v.length <= 20000;
const optionalText = (v: unknown): v is string | null => v === null || text(v);
const visibleText = (v: unknown): v is string => text(v) && v.trim().length > 0;
const observationText = (raw: unknown, display: unknown): boolean => raw === null ? display === null : visibleText(display);
const pair = (v: unknown): v is Pair => record(v) && text(v.en) && text(v.zh);
const optionalPair = (v: unknown): v is Pair | null => v === null || pair(v);
const number = (v: unknown): v is number | null => v === null || typeof v === "number" && Number.isFinite(v);
const absence = (v: unknown): boolean => v === null || record(v) && optionalPair(v.label);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown): v is string | null => {
  if (v === null) return true;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(v + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};
const clock = (v: unknown): v is string => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const list = (v: unknown, check: (row: Record<string, unknown>) => boolean, maximum = 100): boolean => Array.isArray(v) && v.length <= maximum && v.every(row => record(row) && check(row));
const artifact = (v: unknown): v is Artifact => record(v) && v.path === "macrodata/workspaces/liquidity_regime/US/latest.json" && v.manifest_path === "macrodata/workspaces/manifest.json" && hash(v.sha256) && Number.isSafeInteger(v.bytes) && (v.bytes as number) > 0 && (v.bytes as number) <= 2 * 1024 * 1024 && text(v.min_client_contract) && !!v.min_client_contract;

/** Validate the selected transport identity and consumed presentation fields.
 * Macro's existing reader remains the schema/digest/financial authority. This
 * decoder does not recalculate the state, compare observations or fill absences. */
export function macroWorkspacePayload(input: unknown): MacroWorkspaceRead | null {
  if (!record(input) || input.schema !== "mastermind.macro_command_workspace_read.v1" || !record(input.source) || !record(input.selected_workspace)) return null;
  const source = input.source, selected = input.selected_workspace;
  if (source.served_root_qualified !== true || !hash(source.manifest_sha256) || !clock(source.manifest_generated_at) || !clock(source.composed_at) || !text(source.min_client_contract) || !source.min_client_contract || selected.workspace_id !== LIQUIDITY_WORKSPACE || selected.region !== "US") return null;
  if (selected.state === "unavailable") {
    if (selected.view !== null || selected.artifact !== null || selected.generation_id !== null || !record(selected.failure) || !text(selected.failure.kind) || !/^[A-Z][A-Z0-9_]+$/.test(selected.failure.kind) || !text(selected.failure.detail)) return null;
    return input as unknown as MacroWorkspaceRead;
  }
  const v = selected.view;
  if (selected.state !== "ready" || selected.failure !== null || !artifact(selected.artifact) || !text(selected.generation_id) || !selected.generation_id || !record(v) || v.ok !== true || v.decision_first !== true || !record(v.workspace) || v.workspace.id !== LIQUIDITY_WORKSPACE || !pair(v.workspace.title) || !optionalPair(v.workspace.subtitle) || !record(v.region) || v.region.code !== "US" || v.region.supported !== true) return null;
  if (selected.artifact.min_client_contract !== source.min_client_contract || !record(v.evidence) || !record(v.evidence.generation) || v.evidence.generation.generation_id !== selected.generation_id || v.evidence.generation.content_sha256 !== selected.artifact.sha256 || !date(v.evidence.generation.calculation_as_of) || !artifact(v.evidence.artifact) || v.evidence.artifact.sha256 !== selected.artifact.sha256 || v.evidence.artifact.bytes !== selected.artifact.bytes || v.evidence.artifact.min_client_contract !== source.min_client_contract) return null;
  const authority = v.evidence.authority;
  if (!record(authority) || authority.class !== "context_only" || !pair(authority.statement) || !Array.isArray(authority.flags) || authority.flags.length !== 5 || !authority.flags.every(flag => record(flag) && flag.value === false)) return null;
  const h = v.headline, c = v.changes, context = v.context;
  if (!record(h) || !optionalText(h.state_id) || !optionalPair(h.state_label) || !optionalPair(h.subtitle) || !date(h.effective_date) || !optionalText(h.method_version) || !record(h.prior) || !optionalText(h.prior.state_id) || !date(h.prior.effective_date) || !record(h.hysteresis) || typeof h.hysteresis.held_prior !== "boolean" || !optionalPair(h.hysteresis.note)) return null;
  if (!record(context) || !text(context.state) || !optionalText(context.worst_freshness_token) || !optionalPair(context.worst_freshness) || !optionalPair(context.state_label) || !list(context.required, row => text(row.component_id) && optionalPair(row.label) && date(row.source_asof) && optionalPair(row.presence) && optionalPair(row.freshness), 40)) return null;
  if (!Array.isArray(v.axes) || v.axes.length !== 2 || !list(v.axes, row => text(row.axis_id) && optionalPair(row.label) && number(row.value_raw) && optionalText(row.value) && (row.value_raw === null || visibleText(row.value)) && optionalPair(row.value_with_unit) && absence(row.absence))) return null;
  if (!record(c) || typeof c.comparable !== "boolean" || !text(c.comparability) || c.comparable !== (c.comparability === "COMPARABLE") || !optionalPair(c.comparability_label) || typeof c.prior_is_earlier !== "boolean" || !date(c.prior_effective_date) || !absence(c.absence)) return null;
  if (c.prior_is_earlier && !(c.prior_effective_date && h.effective_date && c.prior_effective_date < h.effective_date)) return null;
  if (!list(c.deltas, row => text(row.metric_id) && optionalPair(row.label) && number(row.prior_raw) && number(row.current_raw) && number(row.delta_raw) && observationText(row.prior_raw,row.prior) && observationText(row.current_raw,row.current) && observationText(row.delta_raw,row.delta) && row.prior_present === (row.prior_raw !== null) && row.current_present === (row.current_raw !== null) && row.delta_present === (row.delta_raw !== null) && typeof row.comparable === "boolean" && typeof row.is_movement === "boolean" && absence(row.absence))) return null;
  if (!list(v.metrics, row => text(row.metric_id) && optionalPair(row.unit))) return null;
  if (!list(v.drivers, group => text(group.group_id) && optionalPair(group.title) && typeof group.absent === "boolean" && absence(group.absence) && list(group.rows, row => text(row.driver_id) && optionalPair(row.label) && optionalPair(row.value) && optionalPair(row.unit) && optionalPair(row.coverage) && absence(row.absence) && (row.impact === null || visibleText(row.impact)) && row.impact_present === (row.impact !== null)), 8)) return null;
  if (!record(v.implications) || typeof v.implications.absent !== "boolean" || !pair(v.implications.absence_text) || !list(v.implications.entries, row => text(row.implication_id) && pair(row.text) && optionalPair(row.evidence_label) && optionalPair(row.evidence_claim), 3) || !record(v.series) || typeof v.series.absent !== "boolean" || !absence(v.series.absence)) return null;
  return input as unknown as MacroWorkspaceRead;
}
