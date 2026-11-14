export const WTI_CHAIN = "oil_inflation_duration_derate";
export const WTI_LEGS = ["oil_shock", "breakeven_rise", "yield_rise", "duration_derate"] as const;
export type WtiLegId = typeof WTI_LEGS[number];
type Localized = { en: string; zh: string };
type Value = string | number | boolean | null;
export type WtiReceipt = { metric: string | null; series: string | null; vs: string | null; window: number | null;
  op: string | null; value: Value; threshold: Value; passed: boolean | null };
type Leg = { id: WtiLegId; title: Localized; confirmed: boolean | null; observation: string;
  source: string | null; receipts: WtiReceipt[] };
export type WtiPath = {
  revision: number; manifest: string; observed: string | null; built: string | null;
  episode: Localized; blocker: WtiLegId | null; legs: Leg[]; contradiction: Localized | null;
  comparison: { status: string; note: Localized | null; transition: string | null; asof: string | null };
};
export type WtiRead = { status: "ready"; data: WtiPath }
  | { status: "signin" | "restricted" | "unavailable" | "incoherent" | "limited" };

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Malformed snapshot");
  return input as Record<string, unknown>;
}
function text(input: unknown): string | null {
  return typeof input === "string" && input.trim() && input.length <= 4096 ? input : null;
}
function localized(input: unknown): Localized {
  const label = record(input);
  const en = text(label.en), zh = text(label.zh);
  if (!en || !zh) throw Error("Incomplete label");
  return { en, zh };
}
function scalar(input: unknown): Value {
  if (typeof input === "boolean" || typeof input === "number" && Number.isFinite(input)) return input;
  return text(input);
}
function receipt(input: unknown): WtiReceipt {
  const r = record(input);
  return { metric: text(r.metric), series: text(r.series), vs: text(r.vs), op: text(r.op),
    window: typeof r.window === "number" && Number.isSafeInteger(r.window) ? r.window : null,
    value: scalar(r.value), threshold: scalar(r.threshold), passed: typeof r.passed === "boolean" ? r.passed : null };
}

/** Project only the reader fields. Episode state and the first blocker are supplied by Macro. */
export function parseWtiPath(input: unknown): WtiPath {
  const raw = record(input), source = record(raw.source), path = record(raw.path), state = record(raw.state);
  const manifest = text(source.source_manifest_hash);
  if (raw.schema !== "ontology_explorer_snapshot.v1" || source.chain !== WTI_CHAIN ||
    typeof source.rev !== "number" || !Number.isSafeInteger(source.rev) || source.rev < 1 ||
    !manifest || !/^sha256:[a-f0-9]{64}$/.test(manifest) ||
    !Array.isArray(path.sequence) || path.sequence.join("|") !== WTI_LEGS.join("|") ||
    !Array.isArray(path.legs) || path.legs.length !== WTI_LEGS.length) throw Error("Unsupported WTI snapshot");
  const legs = path.legs.map((input, i): Leg => {
    const r = record(input), id = WTI_LEGS[i];
    const observation = text(r.observation);
    if (r.node_id !== id || r.index !== i + 1 || !observation ||
      !["observed", "unobserved", "unresolved", "incomplete", "unreadable"].includes(observation) ||
      (observation === "observed" ? typeof r.confirmed !== "boolean" : r.confirmed !== null) ||
      !Array.isArray(r.receipts) || r.receipts.length > 64) throw Error("Malformed WTI condition");
    return { id, title: localized(r.title), confirmed: r.confirmed as boolean | null, observation,
      source: text(r.src), receipts: r.receipts.map(receipt) };
  });
  const blocker = raw.first_blocking_leg === null ? null : record(raw.first_blocking_leg).node_id;
  const first = legs.find(leg => leg.confirmed !== true)?.id ?? null;
  if (blocker !== first) throw Error("Conflicting blocker");
  const change = record(raw.what_changed);
  if (!["comparison_incomplete", "comparison_unavailable", "recorded_transition"].includes(String(change.status)) ||
    !Array.isArray(change.items)) throw Error("Unsupported comparison");
  const latest = change.items.length ? record(change.items[0]) : null;
  return { revision: source.rev, manifest, observed: text(source.asof), built: text(source.built),
    episode: localized(state.label), blocker: first, legs,
    contradiction: raw.contradiction == null ? null : localized(record(raw.contradiction).note),
    comparison: { status: String(change.status), note: change.note == null ? null : localized(change.note),
      transition: text(latest?.transition), asof: text(latest?.asof) } };
}

export function primaryReading(leg: Leg) {
  return leg.receipts.find(r => typeof r.value === "number") ?? leg.receipts[0];
}
export function readingText(value: Value, r: WtiReceipt, leg: WtiLegId, lang: "en" | "zh") {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? (lang === "zh" ? "是" : "Yes") : (lang === "zh" ? "否" : "No");
  if (typeof value === "string") return value === "rising" && lang === "zh" ? "上升" : value;
  const unit = ["ret", "ret_pct"].includes(r.metric ?? "") ? "%" :
    r.metric === "ret_bp" || (leg === "yield_rise" && r.op === "gt" && !r.metric) ? (lang === "zh" ? " 基点" : " bp") :
    ["rs", "rs_pp"].includes(r.metric ?? "") ? (lang === "zh" ? " 个百分点" : " pp") : "";
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 4 }).format(value) + unit;
}
