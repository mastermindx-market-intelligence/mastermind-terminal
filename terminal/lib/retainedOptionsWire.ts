/** Supplied wire v1 only. No acquisition, clocks, cache, persistence or grants.
 * Original capture bytes remain authority; exact source numbers never become Number.
 * This validates a projection from the qualified encoder, not capture authentication.
 */
import { isGregorianDate } from "./matrixAcquisition";
import { isValidRoot } from "./flowRoot";
export type Exact = null | boolean | string | { decimal: string } | { array: Exact[] } | { object: Record<string, Exact> };
type Obj = Record<string, unknown>;
export type RetainedContext = { root: string; session: string; ownerKey: string };
export type RetainedInput = RetainedContext & { wire: string };
export type RetainedView = {
  kind: "matrix" | "events"; root: string; session: string; fingerprint: string;
  readAt: string; cutoff: string; captureBase64: string;
  /** Original validated wire retains full metadata, receipt bytes and normalized clocks. */
  wire: string;
  rows: { key: string; label: string; values: Record<string, Exact>; availableAt?: string }[];
};
const MAX = 16 * 1024 * 1024, WIRE_MAX = 4 * MAX;
const bad = (): never => { throw new Error("retained_selection_unavailable"); };
function obj(x: unknown): Obj { return x !== null && typeof x === "object" && !Array.isArray(x) ? x as Obj : bad(); }
function keys(x: unknown, required: string[], optional: string[] = []): Obj {
  const o = obj(x); if (required.some(k => !Object.hasOwn(o, k)) || Object.keys(o).some(k => !required.includes(k) && !optional.includes(k))) bad(); return o;
}
const text = (x: unknown): string => typeof x === "string" ? x : bad();
const integer = (x: unknown, min = 0, max = MAX): number => typeof x === "number" && Number.isSafeInteger(x) && x >= min && x <= max ? x : bad();
const eq = (a: unknown, b: unknown): void => { if (stable(a) !== stable(b)) bad(); };
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x !== null && typeof x === "object") return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${stable((x as Obj)[k])}`).join(",")}}`;
  return JSON.stringify(x) ?? "<missing>";
}
/** Bounded numeric lexeme normalization; no binary float conversion of source data. */
function decimal(token: string): string {
  const m = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token); if (!m) return bad();
  let digits = m[2] + (m[3] ?? ""); if (!/[1-9]/.test(digits)) return "0";
  if ((m[4] ?? "").replace(/^[+-]?0*/, "").length > 3) bad();
  const exp = BigInt(m[4] ?? "0") - BigInt((m[3] ?? "").length);
  if (exp > BigInt(128) || exp < -BigInt(128) || digits.length > 256) return bad();
  const point = digits.length + Number(exp); if (Math.max(point, 1) + Math.max(-Number(exp), 0) + m[1].length + (exp < BigInt(0) ? 1 : 0) > 128) bad();
  digits = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point) + "." + digits.slice(point);
  digits = digits.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return m[1] + digits;
}
/** Local strict tokenizer: unlike the incumbent server-only canonical-pair scanner,
 * accepts original JSON whitespace/order and tags numeric lexemes before decoding.
 * Bounds and duplicate-key checks apply before constructing any projection. */
function parse(raw: string, source = false): unknown {
  let i = 0, count = 0; const ws = () => { while (/[\t\r\n ]/.test(raw[i] ?? "x")) i++; };
  const str = (): string => {
    const start = i++; let escaped = false;
    while (i < raw.length) { const c = raw[i++]; if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') return JSON.parse(raw.slice(start, i)); }
    return bad();
  };
  const value = (depth: number): unknown => {
    if (++count > 2_000_000 || depth > (source ? 24 : 64)) bad(); ws();
    if (raw[i] === '"') return str();
    if (raw[i] === "{") {
      i++; ws(); const o: Obj = Object.create(null);
      if (raw[i] !== "}") for (;;) { if (raw[i] !== '"') bad(); const k = str(); ws(); if (raw[i++] !== ":" || Object.hasOwn(o, k)) bad(); o[k] = value(depth + 1); ws(); if (raw[i] === "}") break; if (raw[i++] !== ",") bad(); ws(); }
      i++; return source ? { object: o } : o;
    }
    if (raw[i] === "[") { i++; ws(); const a: unknown[] = []; if (raw[i] !== "]") for (;;) { a.push(value(depth + 1)); ws(); if (raw[i] === "]") break; if (raw[i++] !== ",") bad(); } i++; return source ? { array: a } : a; }
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i)); if (!m) return bad(); i += m[0].length;
    if (/^(true|false|null)$/.test(m[0])) return JSON.parse(m[0]);
    if (source) return { decimal: decimal(m[0]) };
    if (!/^(0|[1-9]\d*)$/.test(m[0])) return bad(); return integer(Number(m[0]), 0, 2_000_000_000);
  };
  const result = value(0); ws(); if (i !== raw.length) bad(); return result;
}
function exactObject(x: unknown): Obj { return obj(keys(x, ["object"]).object); }
function exactArray(x: unknown): unknown[] { const a = keys(x, ["array"]).array; return Array.isArray(a) ? a : bad(); }
function token(x: unknown): string { const d = text(keys(x, ["decimal"]).decimal); if (d.length > 128 || decimal(d) !== d) bad(); return d; }
function date(x: unknown): string { const s = text(x); return isGregorianDate(s) ? s : bad(); }
/** Exact nanoseconds. Calendar arithmetic uses bounded integers; no Date clock rounding. */
function clock(x: unknown): bigint {
  const s = text(x), m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(s); if (!m) return bad(); date(m[1]);
  const [y, mo, d] = m[1].split("-").map(Number); const yr = y - (mo <= 2 ? 1 : 0), era = Math.floor(yr / 400), yo = yr - era * 400;
  const days = era * 146097 + yo * 365 + Math.floor(yo / 4) - Math.floor(yo / 100) + Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1 - 719468;
  const [hh, mm, ss] = [m[2], m[3], m[4]].map(Number); if (hh > 23 || mm > 59 || ss > 59) bad();
  let offset = 0; if (m[6] !== "Z") { const oh = Number(m[6].slice(1, 3)), om = Number(m[6].slice(4)); if (oh > 23 || om > 59) bad(); offset = (oh * 60 + om) * (m[6][0] === "-" ? -1 : 1); }
  return BigInt(days * 86400 + hh * 3600 + mm * 60 + ss - offset * 60) * BigInt(1_000_000_000) + BigInt((m[5] ?? "").padEnd(9, "0"));
}
/** Calendar membership only; exact clock comparisons above remain BigInt nanoseconds.
 * Venue holidays and event-domain validation remain the incumbent producer's scope. */
function sessionAt(ns: bigint): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Number(ns / BigInt(1_000_000))));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get("year")?.padStart(4, "0")}-${get("month")}-${get("day")}`;
}
const floorUs = (t: bigint) => t - ((t % BigInt(1000) + BigInt(1000)) % BigInt(1000));
const ceilUs = (t: bigint) => floorUs(t + BigInt(999));
function base64(s: unknown, max = MAX): Uint8Array {
  const v = text(s); if (!v || v.length > 4 * Math.ceil(max / 3) || (v.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(v))) return bad();
  const binary = atob(v); if (binary.length > max || btoa(binary) !== v) bad(); return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function hash(b: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)))].map(x => x.toString(16).padStart(2, "0")).join(""); }
const utf8 = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);
const rootName = (x: unknown) => { const s = text(x); return isValidRoot(s) && s === s.toUpperCase() && !s.includes("..") ? s : bad(); };

export async function decodeRetainedOptions(raw: string, context: RetainedContext): Promise<RetainedView | null> {
  try {
    if (!context.ownerKey || typeof raw !== "string" || !raw.length || raw.length > WIRE_MAX || new TextEncoder().encode(raw).length > WIRE_MAX) return null;
    const w = obj(parse(raw)); const common = ["schema", "kind", "capture", "decision_at", "cutoff_utc", "read_observed_at", "selector", "state"];
    keys(w, [...common, ...(w.kind === "matrix" ? ["snapshot", "rows", "document"] : ["source_stage_key", "records"])]);
    if (w.schema !== "options.retained_selection.wire/v1" || !["matrix", "events"].includes(text(w.kind))) bad();
    const c = keys(w.capture, ["encoding", "body_base64", "sha256", "byte_length", "read_at"]);
    if (c.encoding !== "base64" || !/^[a-f0-9]{64}$/.test(text(c.sha256))) bad();
    const body = base64(c.body_base64); if (body.length !== integer(c.byte_length, 1) || await hash(body) !== c.sha256) bad();
    const originalRead = clock(c.read_at), read = ceilUs(originalRead), cut = floorUs(clock(w.decision_at));
    if (read > cut || clock(w.read_observed_at) !== read || clock(w.cutoff_utc) !== cut) bad();
    const view: RetainedView = { kind: w.kind as RetainedView["kind"], root: context.root, session: context.session,
      wire: raw, fingerprint: text(c.sha256), captureBase64: text(c.body_base64), readAt: text(c.read_at), cutoff: text(w.decision_at), rows: [] };
    if (w.kind === "matrix") {
      const s = keys(w.snapshot, ["root", "session", "sha256", "byte_length", "version_ref", "key"]), sel = keys(w.selector, ["expiry", "side"]);
      const r = rootName(s.root); if (r !== context.root || s.session !== context.session) bad(); date(s.session); date(sel.expiry); if (!["call", "put", "all"].includes(text(sel.side))) bad();
      eq(s.sha256, c.sha256); eq(s.byte_length, c.byte_length); eq(s.version_ref, `sha256:${c.sha256}:bytes:${body.length}:session:${s.session}`); eq(s.key, `options_structure/matrix/history/${r}/${c.sha256}.json`);
      const original = parse(utf8(body), true); eq(w.document, original); const doc = exactObject(original);
      eq(doc.schema, "options_structure.matrix/v1"); eq(doc.root, r);
      const metaSession = doc._build_meta == null ? null : exactObject(doc._build_meta).asof_date;
      if (doc.session != null && metaSession != null) eq(doc.session, metaSession); eq(doc.session ?? metaSession, s.session);
      const cells = exactArray(doc.cells), seen = new Set<string>(), expected: unknown[] = [];
      for (let index = 0; index < cells.length; index++) {
        const cell = exactObject(cells[index]), expiry = date(cell.expiry), strike = token(cell.strike);
        if (strike === "0" || !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{0,7}[1-9])?$/.test(strike)) bad(); const coordinate = `${expiry}|${strike}`; if (seen.has(coordinate)) bad(); seen.add(coordinate);
        for (const side of ["call", "put"] as const) {
          const oi = cell[`${side}_oi`], vol = cell[`${side}_vol`];
          for (const v of [oi, vol]) if (v != null && (token(v).startsWith("-") || token(v).includes("."))) bad();
          if (expiry !== sel.expiry || (sel.side !== "all" && sel.side !== side) || (oi == null && vol == null)) continue;
          const metrics: Obj = {};
          for (const [from, to] of [[`${side}_oi`, "open_interest"], [`${side}_vol`, "volume"]]) if (Object.hasOwn(cell, from)) metrics[to] = cell[from];
          for (const from of ["delta_oi", "unusual"]) if (cell[from] != null && typeof cell[from] === "object" && Object.hasOwn(obj(cell[from]), "object")) { const sides = exactObject(cell[from]); if (Object.hasOwn(sides, side)) metrics[from] = sides[side]; }
          expected.push({ expiry, strike, side, cell_index: index, metrics });
          view.rows.push({ key: `${r}|${s.session}|${coordinate}|${side}`, label: `${expiry} · ${strike} · ${side}`, values: metrics as Record<string, Exact> });
        }
      }
      eq(w.rows, expected); eq(w.state, { selection_mode: "known_snapshot_only", row_status: expected.length ? "supplied_observations" : "no_supplied_observations", first_available_at: null, history_order: null, correction_order: null, universe_coverage: null, gap_interpretation: "missing_is_unknown" });
    } else {
      const sel = keys(w.selector, ["session", "root", "event_ids"]), r = rootName(sel.root), session = date(sel.session); if (r !== context.root || session !== context.session) bad();
      const sourceKey = `live_flow/events/${session}.jsonl`; eq(w.source_stage_key, sourceKey);
      const ids = sel.event_ids; if (ids !== null && (!Array.isArray(ids) || ids.length < 1 || ids.length > 200000 || new Set(ids).size !== ids.length || ids.some(x => typeof x !== "string" || !x || x.trim() !== x))) bad();
      const source = utf8(body), lines = source.match(/[^\n]*\n/g) ?? bad(); if (lines.join("") !== source) bad();
      const pending = new Map<string, Exact>(), seen = new Set<string>(), expected: Obj[] = []; let prefixBytes = 0, prefixHashWork = 0;
      for (let i = 0; i < lines.length; i++) {
        prefixBytes += new TextEncoder().encode(lines[i]).length; const record = exactObject(parse(lines[i], true));
        const id = text(record.event_id); if (!id || id.trim() !== id || record.schema !== "live_flow.event_stage/v1") bad();
        if (record.kind === "decision") {
          keys(record, ["schema", "kind", "event_id", "event"]); if (seen.has(id)) bad(); seen.add(id); const event = exactObject(record.event); eq(event.id, id);
          const a = clock(event.ts), b = clock(event.observed_at), d = clock(event.decision_at); if (a > b || b > d) bad();
          for (const t of [a, b, d]) if (sessionAt(t) !== session) bad(); pending.set(id, record.event as Exact);
        } else if (record.kind === "availability") {
          keys(record, ["schema", "kind", "event_id", "available_at"], ["context_capture"]); const eventValue = pending.get(id); if (!eventValue) bad(); pending.delete(id); const event = exactObject(eventValue);
          const available = clock(record.available_at); if (sessionAt(available) !== session) bad(); if (floorUs(available) < floorUs(clock(event.decision_at)) || available > originalRead || ceilUs(available) > read) bad();
          if (event.root !== r || (Array.isArray(ids) && !ids.includes(id))) continue;
          const found = Array.isArray(w.records) ? w.records[expected.length] : bad(); const row = keys(found, ["event", "decision_at", "available_at", "source_available_at", "source_availability_receipt_base64", "source_stage_key", "source_stage_schema", "source_stage_prefix_records", "source_stage_prefix_sha256"]);
          eq(row.event, eventValue); if (clock(row.decision_at) !== floorUs(clock(event.decision_at)) || clock(row.available_at) !== floorUs(available)) bad();
          eq(row.source_available_at, record.available_at); eq(utf8(base64(row.source_availability_receipt_base64)), lines[i]); eq(row.source_stage_key, sourceKey); eq(row.source_stage_schema, "live_flow.event_stage/v1"); eq(row.source_stage_prefix_records, i + 1); // WebCrypto has no incremental SHA state. Bound total prefix work rather
          // than hashing a large ledger quadratically or adding another crypto owner.
          prefixHashWork += prefixBytes; if (prefixHashWork > WIRE_MAX) bad();
          eq(row.source_stage_prefix_sha256, await hash(body.slice(0, prefixBytes)));
          expected.push(row); view.rows.push({ key: `${r}|${session}|${id}|${row.source_stage_prefix_sha256}`, label: id, values: event as Record<string, Exact>, availableAt: text(record.available_at) });
        } else bad();
      }
      if (pending.size || !Array.isArray(w.records) || w.records.length !== expected.length || (Array.isArray(ids) && expected.length !== ids.length)) bad();
      eq(w.state, { population: "individual_aggregate_events", package_support: "no_sourced_membership", universe_coverage: null, correction_order: null });
    }
    return view;
  } catch { return null; }
}
export function exactText(value: Exact | undefined): string {
  if (value === undefined) return "∅"; if (value === null) return "—";
  if (typeof value === "object") return "decimal" in value ? value.decimal : JSON.stringify(value);
  return String(value);
}
