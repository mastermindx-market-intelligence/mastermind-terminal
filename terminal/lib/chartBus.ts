// Chart Bus v2 — the Terminal side of the Chart Mastermind program (CMX W1).
//
// The Mastermind Brain gateway drives the chart through a typed command envelope that arrives on the
// existing SSE `command` event → mm_brain.js widget → CFG.onCommand(j) → TerminalShell.handleBrainCommand.
// v1 envelopes ({action, symbol|tf|indicator+on|kind}) are dispatched unchanged by handleBrainCommand;
// this module owns the v2 vocabulary ({on, v:2, batch_id, seq, op, id, args, caption}).
//
// Responsibilities, all deterministic and framework-free so they unit-test without a DOM:
//   • validate()  — hand-rolled boundary validation (contract law); unknown/malformed → rejected ack,
//                   never a throw. (The contract names zod; we enforce the identical rules with typed
//                   guards to avoid a new dependency and match this repo's validation idiom.)
//   • translate() — turn a validated draw.* op into one or more lib/drawings Drawing objects, tagged
//                   `ai_*` + auto:true so they render through the existing SVG DrawLayer and never
//                   round-trip into the user's persisted drawing store.
//   • ATR(14) + fit metrics (touches / max_dev_atr) computed against the exact bar series the chart
//                   currently renders — for the state mirror the gateway reads back.
//   • CommandQueue — sequential per-batch application with a configurable pace delay (default 0 =
//                   instant) + applyInstantly() escape + a tiny step emitter W3 subscribes to later.
//
// NOTHING here persists to a server. The AI layer is in-memory per-symbol, owned by TerminalShell.

import type { Drawing, Pt } from "@/lib/drawings";
import { uid } from "@/lib/drawings";
import { isSuiteKey } from "./suites/meta";
import { readNativeSuiteParams, type IndicatorParam } from "./chartIndicatorParams";

// ── caps (contract law) ───────────────────────────────────────────────────────────────────────
export const BATCH_OP_CAP = 24; // ops per batch
export const AI_OBJECT_CAP = 60; // total live AI objects on a symbol
export const CAPTION_MAX = 140; // caption chars

// ── op vocabulary (contract law) ──────────────────────────────────────────────────────────────
export const CHART_OPS = ["chart.set_symbol", "chart.set_tf", "chart.set_indicators", "chart.set_range"] as const;
export const DRAW_OPS = [
  "draw.trendline", "draw.ray", "draw.hline", "draw.zone", "draw.channel",
  "draw.fib", "draw.path", "draw.label", "draw.marker", "draw.risk_box",
] as const;
export const SCENE_OPS = ["scene.begin", "scene.end"] as const;
export const AI_OPS = ["ai.clear", "ai.undo"] as const;
export const ALL_OPS = [...CHART_OPS, ...DRAW_OPS, ...SCENE_OPS, ...AI_OPS] as const;
export type ChartOp = (typeof ALL_OPS)[number];

const OP_SET = new Set<string>(ALL_OPS);
const STYLE_KINDS = new Set(["solid", "dashed", "dotted"]);
// NOTE: the contract's `extend` field on trendline/ray is accepted but not separately honored in W1 —
// right-extension is expressed via draw.ray. A future pass can map extend:"right" onto a ray.

// ── wire types ────────────────────────────────────────────────────────────────────────────────
export type WirePt = { t: number; p: number };
export type WireStyle = { kind?: "solid" | "dashed" | "dotted"; width?: number; color?: string };
export type ChartCommandV2 = {
  on: true;
  v: 2;
  batch_id: string;
  seq: number;
  op: ChartOp;
  id?: string;
  args?: Record<string, unknown>;
  caption?: string;
};

// A drawing produced by the AI layer. Extends Drawing with provenance the state mirror + caps read.
export type AiObject = Drawing & {
  by: "ai";
  op: ChartOp; // the draw.* op that produced it
  batch_id: string;
  seq: number;
  caption?: string;
};

export type Ack = { batch_id: string; seq: number; id: string | null; ok: boolean; error?: string };

// The result of validating+translating one command: either a set of side-effects to apply, or a reject.
export type Applied =
  | { ok: true; op: ChartOp; id: string | null; caption?: string;
      // exactly one of these is populated depending on op family:
      draw?: AiObject[]; // draw.* → objects to add
      setSymbol?: string; setTf?: string; setIndicators?: IndicatorSpec[];
      setRange?: { from: number; to: number };
      clear?: true; undo?: number; scene?: "begin" | "end"; sceneTitle?: string; }
  | { ok: false; op: string; id: string | null; error: string };

export type IndicatorSpec = { name: string; params?: Record<string, IndicatorParam> };

// ── small typed guards ────────────────────────────────────────────────────────────────────────
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
// contract: times are epoch SECONDS, "sane" — roughly 1990 … 2100.
const SANE_MIN = 631152000; // 1990-01-01
const SANE_MAX = 4102444800; // 2100-01-01
const isSaneTime = (v: unknown): v is number => isFiniteNum(v) && v >= SANE_MIN && v <= SANE_MAX;
const isPrice = (v: unknown): v is number => isFiniteNum(v) && v > 0;

function readPt(v: unknown): WirePt | null {
  if (!isObj(v)) return null;
  if (!isSaneTime(v.t) || !isPrice(v.p)) return null;
  return { t: v.t, p: v.p };
}

// Sanitise a caption: plain text, ≤140 chars, control chars stripped. Stored only; rendered ONLY as
// textContent by the (future) W3 theater — never as innerHTML. We normalise here so storage is clean.
export function cleanCaption(v: unknown): string | undefined {
  if (!isStr(v)) return undefined;
  // strip ASCII control chars (codepoints < 0x20 and 0x7F) via a char-code filter — avoids a
  // control-char regex literal in source. Plain text, stored for the future W3 theater textContent.
  let s = "";
  for (const ch of v) { const c = ch.codePointAt(0)!; s += (c < 0x20 || c === 0x7f) ? " " : ch; }
  s = s.trim().slice(0, CAPTION_MAX);
  return s.length ? s : undefined;
}

function readStyle(v: unknown): WireStyle {
  if (!isObj(v)) return {};
  const out: WireStyle = {};
  if (isStr(v.kind) && STYLE_KINDS.has(v.kind)) out.kind = v.kind as WireStyle["kind"];
  if (isFiniteNum(v.width) && v.width > 0 && v.width <= 12) out.width = v.width;
  // color is accepted only as a token or hex — never arbitrary text (defence-in-depth; DrawLayer
  // reads d.color into an SVG attribute). The AI accent is applied by the caller regardless.
  if (isStr(v.color) && /^(var\(--[a-z0-9-]+\)|#[0-9a-fA-F]{3,8})$/.test(v.color)) out.color = v.color;
  return out;
}

// ── validation ────────────────────────────────────────────────────────────────────────────────
// Returns a discriminated result. NEVER throws. `isV2` lets the caller decide whether to fall back to
// the v1 dispatcher (an envelope without v:2 is not our concern).
export function isV2Envelope(j: unknown): j is ChartCommandV2 {
  return isObj(j) && j.v === 2 && j.on === true;
}

export type ValidateResult =
  | { ok: true; cmd: ChartCommandV2 }
  | { ok: false; op: string; id: string | null; seq: number; batch_id: string; error: string };

// Validate the envelope shell (v/on/batch_id/seq/op/id/caption). Arg-level validation happens in
// translate() per op-family so the reject carries the right id/seq.
export function validateEnvelope(j: unknown): ValidateResult {
  if (!isObj(j)) return { ok: false, op: "", id: null, seq: -1, batch_id: "", error: "not_an_object" };
  const idOf = (x: Record<string, unknown>): string | null => (isStr(x.id) ? x.id : null);
  const seqOf = (x: Record<string, unknown>): number => (isFiniteNum(x.seq) ? x.seq : -1);
  const batchOf = (x: Record<string, unknown>): string => (isStr(x.batch_id) ? x.batch_id : "");
  const op = isStr(j.op) ? j.op : "";
  const base = { op, id: idOf(j), seq: seqOf(j), batch_id: batchOf(j) };
  if (j.v !== 2) return { ok: false, ...base, error: "bad_version" };
  if (j.on !== true) return { ok: false, ...base, error: "not_on" };
  if (!isStr(j.batch_id) || !j.batch_id) return { ok: false, ...base, error: "bad_batch_id" };
  if (!isFiniteNum(j.seq)) return { ok: false, ...base, error: "bad_seq" };
  if (!OP_SET.has(op)) return { ok: false, ...base, error: "unknown_op" };
  // id, when present, MUST be an ai_* namespaced string (contract). draw.* ops require an id.
  if (j.id != null && (!isStr(j.id) || !j.id.startsWith("ai_")))
    return { ok: false, ...base, error: "bad_id_namespace" };
  if (op.startsWith("draw.") && (!isStr(j.id) || !j.id.startsWith("ai_")))
    return { ok: false, ...base, error: "draw_requires_ai_id" };
  return { ok: true, cmd: j as unknown as ChartCommandV2 };
}

// ── op → Drawing translation ──────────────────────────────────────────────────────────────────
// The AI accent token — a violet distinct from the user's blue (--brand-2), added to globals.css.
export const AI_ACCENT = "var(--ai)";

// contract epoch-seconds → the DrawLayer's anchor time. It accepts a numeric-string (parsed *1000 by
// toMs) or a "YYYY-MM-DD" — a numeric-string round-trips through both daily and intraday snapping.
const anchorT = (t: number): string => String(Math.round(t));

function pt(t: number, p: number): Pt {
  return { t: anchorT(t), p };
}

// Build one AiObject with shared provenance fields.
function mkObj(cmd: ChartCommandV2, kind: Drawing["kind"], parts: Partial<Drawing>, idSuffix = ""): AiObject {
  const color = parts.color ?? AI_ACCENT;
  return {
    id: (cmd.id || "ai_" + uid()) + idSuffix,
    kind,
    points: parts.points ?? [],
    color,
    auto: true, // routes AI objects away from the user-persisted store in ChartPane.handleChange
    ...parts,
    by: "ai",
    op: cmd.op,
    batch_id: cmd.batch_id,
    seq: cmd.seq,
    caption: cleanCaption(cmd.caption),
    meta: { ...(parts.meta || {}), by: "ai" },
  };
}

const dashOf = (s: WireStyle): Drawing["dash"] => (s.kind === "dashed" ? "dashed" : s.kind === "dotted" ? "dotted" : "solid");

// Translate a validated envelope. Returns Applied (ok:true with side-effects, or ok:false reject).
// `caps` supplies the enum surfaces so chart.* ops reject hallucinated names deterministically.
export function translate(
  cmd: ChartCommandV2,
  caps: { tfs: string[]; indicators: string[] },
): Applied {
  const a = (isObj(cmd.args) ? cmd.args : {}) as Record<string, unknown>;
  const reject = (error: string): Applied => ({ ok: false, op: cmd.op, id: cmd.id ?? null, error });
  const okDraw = (objs: AiObject[]): Applied => ({ ok: true, op: cmd.op, id: cmd.id ?? null, caption: cleanCaption(cmd.caption), draw: objs });

  switch (cmd.op) {
    // ── chart.* ─────────────────────────────────────────────────────────────────────────────
    case "chart.set_symbol": {
      if (!isStr(a.symbol) || !a.symbol.trim()) return reject("bad_symbol");
      return { ok: true, op: cmd.op, id: null, setSymbol: a.symbol.trim() };
    }
    case "chart.set_tf": {
      if (!isStr(a.tf)) return reject("bad_tf");
      if (!caps.tfs.includes(a.tf)) return reject("unknown_tf");
      return { ok: true, op: cmd.op, id: null, setTf: a.tf };
    }
    case "chart.set_indicators": {
      if (!Array.isArray(a.indicators)) return reject("bad_indicators");
      const specs: IndicatorSpec[] = [];
      for (const raw of a.indicators) {
        if (!isObj(raw) || !isStr(raw.name)) return reject("bad_indicator_entry");
        if (!caps.indicators.includes(raw.name)) return reject("unknown_indicator");
        if (isSuiteKey(raw.name)) {
          const native = readNativeSuiteParams(raw.name, raw.params);
          if (!native.ok) return reject(native.error);
          specs.push({ name: raw.name, params: native.params });
          continue;
        }
        // The legacy classic path remains numeric-only; native schemas are explicit above.
        const params: Record<string, number> = {};
        if (isObj(raw.params)) for (const [k, v] of Object.entries(raw.params)) if (isFiniteNum(v)) params[k] = v;
        specs.push({ name: raw.name, params: Object.keys(params).length ? params : undefined });
      }
      return { ok: true, op: cmd.op, id: null, setIndicators: specs };
    }
    case "chart.set_range": {
      if (!isSaneTime(a.from) || !isSaneTime(a.to) || (a.from as number) >= (a.to as number)) return reject("bad_range");
      return { ok: true, op: cmd.op, id: null, setRange: { from: a.from as number, to: a.to as number } };
    }

    // ── draw.* ──────────────────────────────────────────────────────────────────────────────
    case "draw.trendline":
    case "draw.ray": {
      const p1 = readPt(a.p1), p2 = readPt(a.p2);
      if (!p1 || !p2) return reject("bad_points");
      const style = readStyle(a.style);
      const kind = cmd.op === "draw.ray" ? "ray" : "trendline";
      return okDraw([mkObj(cmd, kind, {
        points: [pt(p1.t, p1.p), pt(p2.t, p2.p)],
        width: style.width, dash: dashOf(style), color: style.color ?? AI_ACCENT,
        meta: isStr(a.text) ? { label: a.text.slice(0, CAPTION_MAX) } : undefined,
      })]);
    }
    case "draw.hline": {
      if (!isPrice(a.p)) return reject("bad_price");
      const style = readStyle(a.style);
      // anchor time is irrelevant for an hline (spans full width); use `at` if present else now.
      const at = isSaneTime(a.at) ? (a.at as number) : Math.floor(Date.now() / 1000);
      return okDraw([mkObj(cmd, "hline", {
        points: [pt(at, a.p as number)],
        width: style.width, dash: dashOf(style), color: style.color ?? AI_ACCENT,
        meta: { label: isStr(a.text) ? a.text.slice(0, CAPTION_MAX) : (a.p as number).toString(), by: "ai" },
      })]);
    }
    case "draw.zone": {
      // a horizontal price band between p_lo/p_hi across [t1,t2] (or full width). → rect
      const lo = a.p_lo ?? a.p1, hi = a.p_hi ?? a.p2;
      if (!isPrice(lo) || !isPrice(hi)) return reject("bad_zone_prices");
      const t1 = isSaneTime(a.t1) ? (a.t1 as number) : Math.floor(Date.now() / 1000) - 86400 * 30;
      const t2 = isSaneTime(a.t2) ? (a.t2 as number) : Math.floor(Date.now() / 1000);
      const style = readStyle(a.style);
      return okDraw([mkObj(cmd, "rect", {
        points: [pt(t1, Math.max(lo as number, hi as number)), pt(t2, Math.min(lo as number, hi as number))],
        color: style.color ?? AI_ACCENT,
        meta: { label: isStr(a.text) ? a.text.slice(0, CAPTION_MAX) : undefined, by: "ai" },
      })]);
    }
    case "draw.channel": {
      // two parallel-ish trendlines (upper/lower) → two objects sharing the base id (+"_u"/"_l").
      const u1 = readPt(a.u1), u2 = readPt(a.u2), l1 = readPt(a.l1), l2 = readPt(a.l2);
      if (!u1 || !u2 || !l1 || !l2) return reject("bad_channel_points");
      const style = readStyle(a.style);
      const common = { width: style.width, dash: dashOf(style), color: style.color ?? AI_ACCENT };
      return okDraw([
        mkObj(cmd, "trendline", { ...common, points: [pt(u1.t, u1.p), pt(u2.t, u2.p)] }, "_u"),
        mkObj(cmd, "trendline", { ...common, points: [pt(l1.t, l1.p), pt(l2.t, l2.p)] }, "_l"),
      ]);
    }
    case "draw.fib": {
      const p1 = readPt(a.p1), p2 = readPt(a.p2);
      if (!p1 || !p2) return reject("bad_points");
      return okDraw([mkObj(cmd, "fib", {
        points: [pt(p1.t, p1.p), pt(p2.t, p2.p)],
        color: (readStyle(a.style).color) ?? AI_ACCENT,
      })]);
    }
    case "draw.path": {
      // a polyline of ≥2 points → N-1 trendline segments sharing the base id (+"_0","_1",…).
      if (!Array.isArray(a.points) || a.points.length < 2) return reject("bad_path_points");
      const pts: WirePt[] = [];
      for (const raw of a.points) { const p = readPt(raw); if (!p) return reject("bad_path_point"); pts.push(p); }
      if (pts.length > 64) return reject("path_too_long");
      const style = readStyle(a.style);
      const common = { width: style.width, dash: dashOf(style), color: style.color ?? AI_ACCENT };
      const segs: AiObject[] = [];
      for (let i = 0; i < pts.length - 1; i++)
        segs.push(mkObj(cmd, "trendline", { ...common, points: [pt(pts[i].t, pts[i].p), pt(pts[i + 1].t, pts[i + 1].p)] }, "_" + i));
      return okDraw(segs);
    }
    case "draw.label": {
      const p1 = readPt(a.p1) ?? (isSaneTime(a.t) && isPrice(a.p) ? { t: a.t as number, p: a.p as number } : null);
      if (!p1) return reject("bad_anchor");
      if (!isStr(a.text) || !a.text.trim()) return reject("bad_text");
      const style = readStyle(a.style);
      return okDraw([mkObj(cmd, "text", {
        points: [pt(p1.t, p1.p)], text: a.text.slice(0, CAPTION_MAX),
        color: style.color ?? AI_ACCENT, fontSize: 13,
      })]);
    }
    case "draw.marker": {
      // a marker at a bar (arrow pointing at t/p). → arrow (short) or text glyph.
      const p1 = readPt(a.p1) ?? (isSaneTime(a.t) && isPrice(a.p) ? { t: a.t as number, p: a.p as number } : null);
      if (!p1) return reject("bad_anchor");
      const glyph = isStr(a.text) ? a.text.slice(0, 24) : "▲";
      const style = readStyle(a.style);
      return okDraw([mkObj(cmd, "text", {
        points: [pt(p1.t, p1.p)], text: glyph, color: style.color ?? AI_ACCENT, fontSize: 15,
      })]);
    }
    case "draw.risk_box": {
      // entry/stop/target → a rect from entry↔stop plus target hline. Encodes an R-multiple trade.
      const entry = a.entry, stop = a.stop, target = a.target;
      if (!isPrice(entry) || !isPrice(stop)) return reject("bad_risk_levels");
      const t1 = isSaneTime(a.t1) ? (a.t1 as number) : Math.floor(Date.now() / 1000) - 86400 * 10;
      const t2 = isSaneTime(a.t2) ? (a.t2 as number) : Math.floor(Date.now() / 1000) + 86400 * 10;
      const style = readStyle(a.style);
      const objs: AiObject[] = [
        mkObj(cmd, "rect", {
          points: [pt(t1, Math.max(entry as number, stop as number)), pt(t2, Math.min(entry as number, stop as number))],
          color: style.color ?? AI_ACCENT,
          meta: { label: "risk", by: "ai" },
        }, "_risk"),
      ];
      if (isPrice(target)) objs.push(mkObj(cmd, "hline", {
        points: [pt(t2, target as number)], color: "var(--up)", dash: "dashed",
        meta: { label: "target " + (target as number), by: "ai" },
      }, "_tgt"));
      return okDraw(objs);
    }

    // ── scene.* ─────────────────────────────────────────────────────────────────────────────
    case "scene.begin":
      return { ok: true, op: cmd.op, id: null, scene: "begin", sceneTitle: isStr(a.title) ? a.title.slice(0, CAPTION_MAX) : undefined };
    case "scene.end":
      return { ok: true, op: cmd.op, id: null, scene: "end" };

    // ── ai.* ────────────────────────────────────────────────────────────────────────────────
    case "ai.clear":
      return { ok: true, op: cmd.op, id: null, clear: true };
    case "ai.undo": {
      const n = isFiniteNum(a.n) && a.n > 0 ? Math.min(Math.floor(a.n), 1000) : 1;
      return { ok: true, op: cmd.op, id: null, undo: n };
    }
  }
  return reject("unhandled_op");
}

// ── pure store reducer (caps / clear / undo / add) ──────────────────────────────────────────────
// Applies a validated+translated command to the per-symbol AI store. PURE: returns the next store, an
// ack, and any non-store side-effect for the caller (chart.* mutators) to run. This is where the
// contract's caps + "clear only by:ai" + "AI never mutates user objects" are enforced deterministically.
export type StoreEffect =
  | { kind: "setSymbol"; symbol: string }
  | { kind: "setTf"; tf: string }
  | { kind: "setIndicators"; indicators: IndicatorSpec[] }
  | { kind: "setRange"; from: number; to: number }
  | { kind: "scene"; phase: "begin" | "end"; title?: string }
  | null;

export function applyToStore(
  store: Record<string, AiObject[]>,
  activeSym: string,
  cmd: ChartCommandV2,
  res: Applied,
): { store: Record<string, AiObject[]>; ack: Ack; effect: StoreEffect } {
  const ackOk = (id: string | null = cmd.id ?? null): Ack => ({ batch_id: cmd.batch_id, seq: cmd.seq, id, ok: true });
  const ackErr = (error: string): Ack => ({ batch_id: cmd.batch_id, seq: cmd.seq, id: cmd.id ?? null, ok: false, error });
  const same = (effect: StoreEffect, ack: Ack) => ({ store, ack, effect });

  if (!res.ok) return { store, ack: ackErr(res.error), effect: null };

  // chart.* — no store change; the caller applies the effect.
  if (res.setSymbol != null) return same({ kind: "setSymbol", symbol: res.setSymbol }, ackOk(null));
  if (res.setTf != null) return same({ kind: "setTf", tf: res.setTf }, ackOk(null));
  if (res.setIndicators != null) return same({ kind: "setIndicators", indicators: res.setIndicators }, ackOk(null));
  if (res.setRange != null) return same({ kind: "setRange", from: res.setRange.from, to: res.setRange.to }, ackOk(null));
  if (res.scene != null) return same({ kind: "scene", phase: res.scene, title: res.sceneTitle }, ackOk(null));

  const cur = store[activeSym] ?? [];

  // ai.clear — remove ONLY AI objects (the store holds only AI objects; user drawings live elsewhere).
  if (res.clear) return { store: { ...store, [activeSym]: [] }, ack: ackOk(null), effect: null };

  // ai.undo{n} — drop the objects belonging to the N most-recent batch_ids.
  if (res.undo != null) {
    const order: string[] = [];
    for (const o of cur) if (!order.includes(o.batch_id)) order.push(o.batch_id);
    const drop = new Set(order.slice(-Math.max(1, res.undo)));
    return { store: { ...store, [activeSym]: cur.filter((o) => !drop.has(o.batch_id)) }, ack: ackOk(null), effect: null };
  }

  // draw.* — add objects, enforcing per-batch + total caps (reject with an ack error, never silent-drop).
  if (res.draw) {
    const objs = res.draw;
    const batchCount = cur.filter((o) => o.batch_id === cmd.batch_id).length;
    if (batchCount + 1 > BATCH_OP_CAP) return { store, ack: ackErr("batch_cap_exceeded"), effect: null };
    // replace-by-id: a re-used ai_* id updates in place. Count only genuinely NEW ids toward the cap.
    const incoming = new Set(objs.map((o) => o.id));
    const kept = cur.filter((o) => !incoming.has(o.id));
    if (kept.length + objs.length > AI_OBJECT_CAP) return { store, ack: ackErr("object_cap_exceeded"), effect: null };
    return { store: { ...store, [activeSym]: [...kept, ...objs] }, ack: ackOk(), effect: null };
  }

  return { store, ack: ackErr("noop"), effect: null };
}

// ── ATR(14) + fit metrics ─────────────────────────────────────────────────────────────────────
// Bars as the chart holds them: {time,o,h,l,c,v}. ATR is the last value of a **Wilder-smoothed**
// ATR(period) — an EXACT mirror of the macro gateway's chart_perception._atr_series (the single
// source of truth for ack-time fit). Wilder: seed = mean of the first `period` true ranges, then
// prev = (prev·(period−1) + TR)/period. The TR series includes bar 0 (TR₀ = high−low, no prior
// close), matching the gateway. Deterministic; no dependency on indicator state.
export type FitBar = { time: string | number; h: number; l: number; c: number; o?: number };

export function atr(bars: FitBar[], period = 14): number {
  const n = bars.length;
  if (n < 2) return 0;
  // True ranges aligned to input length; bar 0 uses high−low (mirrors gateway _true_ranges).
  const trs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      trs.push(Math.max(0, bars[i].h - bars[i].l));
    } else {
      const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
  }
  if (trs.length < period) return 0; // no full Wilder window yet → no scale (gateway returns None)
  let prev = trs.slice(0, period).reduce((s, x) => s + x, 0) / period; // Wilder seed
  for (let i = period; i < trs.length; i++) prev = (prev * (period - 1) + trs[i]) / period;
  return prev;
}

const toMsFit = (t: string | number): number => {
  if (typeof t === "number") return t * 1000;
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  return +new Date(t + "T12:00:00Z");
};

// Price of a line at bar time `tm`, given two anchors (t is epoch-seconds in the stored anchor). For
// hline (one anchor) the price is constant.
function priceAt(points: Pt[], tm: number): number | null {
  if (!points.length) return null;
  if (points.length === 1) return points[0].p;
  const t0 = toMsFit(points[0].t), t1 = toMsFit(points[1].t);
  const p0 = points[0].p, p1 = points[1].p;
  if (t1 === t0) return p0;
  const frac = (tm - t0) / (t1 - t0);
  return p0 + (p1 - p0) * frac;
}

// Fit metrics for trendline / ray / hline / zone — an EXACT mirror of the macro gateway's
// chart_perception._line_fit (the single source of truth the gateway reads back at ack time).
//
//   • touches      — bars whose [l,h] straddles the line within a 0.5×ATR band (unchanged).
//   • max_dev_atr  — the worst *violation* of the line, in ATRs: how far price closed THROUGH it on
//                    the wrong side, NOT the natural swing away from it. The line's side (support vs
//                    resistance) is inferred from where the CLOSES predominantly sit over the span
//                    (support if closes mostly ABOVE the line, resistance if mostly below — ties →
//                    support, matching the gateway's `above >= below`). A support line is violated by
//                    a low dipping BELOW it; a resistance line by a high poking ABOVE it. A within-band
//                    poke is a touch, not a violation, so each violation is band-discounted. This is
//                    what makes the verdict meaningful: a respected support line reads small even when
//                    price legitimately rallies far ABOVE it between touches; a clean close THROUGH it
//                    reads large.
//
// Rounded to 3 decimals to match the gateway's `round(max_pen / atr_now, 3)`. Returns null when
// uncomputable (no bars / no ATR scale / line crosses nothing / degenerate zone).
export type Fit = { touches: number; max_dev_atr: number };

export function fitMetrics(obj: { kind: string; points: Pt[] }, bars: FitBar[]): Fit | null {
  if (!bars.length) return null;
  const kind = obj.kind;
  if (!["trendline", "ray", "hline", "rect"].includes(kind)) return null;
  const a = atr(bars, 14);
  if (!(a > 0)) return null;
  const band = 0.5 * a;

  // For a zone (rect) the band has two edges — the lower edge acts as support, the upper as
  // resistance. touches = bars overlapping [lo,hi]±band; a violation is a bar that closed the range
  // entirely on the wrong side of an edge (below lo → support broken; above hi → resistance broken),
  // band-discounted exactly as the line case.
  if (kind === "rect") {
    if (obj.points.length < 2) return null;
    const hi = Math.max(obj.points[0].p, obj.points[1].p);
    const lo = Math.min(obj.points[0].p, obj.points[1].p);
    let touches = 0, maxPen = 0;
    for (const b of bars) {
      if (b.l <= hi + band && b.h >= lo - band) touches++;
      // wrong-side penetration past the nearer edge (0 when the range overlaps the band)
      let pen = b.h < lo ? lo - b.h : b.l > hi ? b.l - hi : 0;
      pen = Math.max(0, pen - band); // a within-band poke is a touch, not a violation
      if (pen > maxPen) maxPen = pen;
    }
    return { touches, max_dev_atr: +(maxPen / a).toFixed(3) };
  }

  // trendline / ray / hline: evaluate the line's price at each bar's time. Two passes over the
  // in-span bars — first tally touches + the close distribution (side), then the band-discounted
  // wrong-side penetration — mirroring the gateway's two loops.
  const ext = kind === "ray";
  const t0 = toMsFit(obj.points[0].t);
  const t1 = obj.points.length > 1 ? toMsFit(obj.points[1].t) : t0;
  const loT = Math.min(t0, t1), hiT = Math.max(t0, t1);
  const inSpan = (bt: number): boolean => {
    // hline spans all bars; segment only within [loT,hiT]; ray only from loT onward.
    if (kind === "trendline" && (bt < loT || bt > hiT)) return false;
    if (kind === "ray" && bt < loT) return false;
    return true;
  };
  // Pass 1: touches + side inference from the close distribution.
  let touches = 0, above = 0, below = 0, crossed = 0;
  const rows: Array<{ b: FitBar; lp: number }> = [];
  for (const b of bars) {
    const bt = toMsFit(b.time);
    if (!inSpan(bt)) continue;
    void ext;
    const lp = kind === "hline" ? obj.points[0].p : priceAt(obj.points, bt);
    if (lp == null) continue;
    crossed++;
    rows.push({ b, lp });
    if (b.l <= lp + band && b.h >= lp - band) touches++;
    if (b.c > lp) above++;
    else if (b.c < lp) below++;
  }
  if (!crossed) return null;
  // Side: support if closes mostly sit above the line, resistance if mostly below (ties → support).
  const isSupport = above >= below;
  // Pass 2: worst band-discounted wrong-side violation.
  let maxPen = 0;
  for (const { b, lp } of rows) {
    // support → low dipping BELOW the line; resistance → high poking ABOVE it.
    let pen = isSupport ? Math.max(0, lp - b.l) : Math.max(0, b.h - lp);
    pen = Math.max(0, pen - band); // within-band poke is a touch, not a violation
    if (pen > maxPen) maxPen = pen;
  }
  return { touches, max_dev_atr: +(maxPen / a).toFixed(3) };
}

// ── command queue with pacing hooks ──────────────────────────────────────────────────────────
// Applies commands sequentially. Default delay 0 = synchronous/instant. A configurable delay paces
// each step (the W3 theater); applyInstantly() drains the queue with delay forced to 0.
// The emitter lets W3 subscribe to per-step (op + caption + fit) events without this module knowing
// about the DOM, PLUS two session-lifecycle events W3 needs to bracket the conductor overlay:
//   • "batch-start" — fires when work enters a previously IDLE queue (queue was empty AND not
//                     draining). This is the "session begins" edge W3 arms the overlay on.
//   • "drain"       — fires once the queue empties after processing (both the paced path and the
//                     applyInstantly() escape). W3 arms its 1.2s done-timer on this.
// A single burst that enqueues N ops in one tick fires exactly ONE batch-start (on the first op) and
// exactly ONE drain (after the last). fit metrics ride the step so the rail can show the ack chip
// for the object that step produced (populated by the dispatch job, which owns the bar series).
// `anchor` (epoch-seconds t + price p of the object's FIRST point) rides the step so W3's ghost cursor
// can glide to the exact pane pixel via the DrawLayer transform — the step is otherwise geometry-free.
export type QueueStep = { op: ChartOp; id: string | null; caption?: string; ok: boolean; fit?: Fit; anchor?: { t: number; p: number } };
export type StepListener = (step: QueueStep) => void;
export type LifecycleListener = () => void;

export class CommandQueue {
  private q: Array<() => QueueStep> = [];
  private listeners = new Set<StepListener>();
  private startListeners = new Set<LifecycleListener>();
  private drainListeners = new Set<LifecycleListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  // "active" is true from the batch-start edge until the drain edge — the window in which further
  // enqueues belong to the SAME session (no second batch-start) even across the paced setTimeout gaps.
  private active = false;
  delayMs: number;

  constructor(delayMs = 0) {
    this.delayMs = delayMs;
  }

  on(fn: StepListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Subscribe to the session-start edge (queue idle → work). Returns an unsubscribe.
  onBatchStart(fn: LifecycleListener): () => void {
    this.startListeners.add(fn);
    return () => this.startListeners.delete(fn);
  }

  // Subscribe to the drain edge (last job processed, queue now empty). Returns an unsubscribe.
  onDrain(fn: LifecycleListener): () => void {
    this.drainListeners.add(fn);
    return () => this.drainListeners.delete(fn);
  }

  private emit(step: QueueStep) {
    for (const fn of this.listeners) { try { fn(step); } catch { /* listener errors never break the queue */ } }
  }
  private emitStart() {
    for (const fn of this.startListeners) { try { fn(); } catch { /* never break the queue */ } }
  }
  private emitDrain() {
    for (const fn of this.drainListeners) { try { fn(); } catch { /* never break the queue */ } }
  }

  // Enqueue a unit of work. `run` performs the side-effect and returns the step descriptor to emit.
  // The batch-start edge is the transition into an active session — detected BEFORE the job runs so
  // W3 can arm the overlay ahead of the first stroke.
  enqueue(run: () => QueueStep) {
    if (!this.active) { this.active = true; this.emitStart(); }
    this.q.push(run);
    this.pump();
  }

  private pump() {
    if (this.running || this.timer) return;
    const step = () => {
      this.timer = null;
      const job = this.q.shift();
      if (!job) { this.settleDrain(); return; }
      const desc = job();
      this.emit(desc);
      if (this.q.length) {
        if (this.delayMs > 0) this.timer = setTimeout(step, this.delayMs);
        else step();
      } else {
        this.settleDrain();
      }
    };
    if (this.delayMs > 0) this.timer = setTimeout(step, this.delayMs);
    else step();
  }

  // Fire the drain edge exactly once per active session, only when genuinely empty.
  private settleDrain() {
    if (this.active && this.q.length === 0 && !this.timer) {
      this.active = false;
      this.emitDrain();
    }
  }

  // Drain everything synchronously right now, ignoring the pace delay (the W3 "skip" escape).
  applyInstantly() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.running = true;
    try {
      let job: (() => QueueStep) | undefined;
      while ((job = this.q.shift())) this.emit(job());
    } finally {
      this.running = false;
    }
    this.settleDrain();
  }

  get size() { return this.q.length; }
  clear() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.q = []; this.settleDrain(); }
}
