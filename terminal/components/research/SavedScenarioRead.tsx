"use client";
// SavedScenarioRead — the recipient/owner view of ONE saved scenario reference.
//
// The stored field arrives as UNKNOWN and is re-validated on every render with the strict
// reference parser: only deliberately shared user inputs and reference / model / captured-clock
// metadata can ever be painted. A numeric basis, results, Greeks, spot, move or totals are not
// part of the STORED contract and are not rendered from storage even if a generic RPC or an old
// full-value payload returns them — an invalid or full-value payload renders the explicit
// unavailable card and nothing else. No state is kept between renders, so an unavailable answer
// can never leave an old value painted behind it.
//
// Honesty rules: this component never links a raw source, and never claims a current market read
// on its own. The saved reference is NOT re-resolved by rendering; current availability is NOT
// checked by rendering; and the saved calculation is NOT verified by rendering. An unknown clock
// is shown as unknown at capture — it is never a denial, a zero, or an ended grant, and no
// current data is ever substituted.
//
// RESOLUTION (b-f12-scenario-resolve-consumer). The ONE exception to "no values here" is an
// EXPLICIT, user-initiated, read-only resolution: when the exact context is complete (a real
// investigation uuid, a positive revision, and the exact grant uuid for a recipient — or an
// explicit null grant for the owner) AND the viewer is a current account, a "Resolve saved
// scenario" button POSTs to the dedicated authenticated same-origin endpoint
// /api/investigation-scenarios with EXACTLY {investigation_id, revision, grant_id} — no capture,
// user, token, root, source or model override. Cookie/session verification, the canonical RPC,
// hashes and math are all server-owned. Basis/result may be painted ONLY from that dedicated
// authenticated answer, and only when the answer is bound to this exact id/revision/grant, its
// capture strictly equals the capture in view, and its basis/result survive the native shape and
// math checks (localScenarioValue recomputes the engine result from the returned basis — no new
// math mirror lives here). Any not_found / unavailable / denied answer, any mismatch, any
// malformed payload, and any transport failure: clear previous paid values, never claim zero, an
// ended grant or a successful resolution, and leave trying again to an explicit click.
//
// Isolation: the resolution state lives in a KEYED subcomponent whose key is the exact
// (account, investigation, revision, grant, capture) tuple. Any change to any of those — or an
// unmount — replaces the component in the same render, so late in-flight answers can never paint
// into a new context, and the previous private basis/results are cleared synchronously. The
// in-flight request is aborted on that same change. There is no render/prop auto-fetch, no save,
// no retention effect and no mutation replay: resolving is always one deliberate click.

import { useEffect, useMemo, useRef, useState } from "react";
import { parseScenarioCapture, type ScenarioCapture } from "@/lib/investigationScenario";
import {
  SCENARIO_VERSION,
  fmtMovePct,
  fmtScenarioMn,
  localScenarioValue,
  type ScenarioBasis,
  type ScenarioInputs,
  type ScenarioValue,
} from "@/lib/exposureScenario";
import { identityUserId, type AccountIdentity } from "@/lib/accountIdentity";
import styles from "./SavedScenario.module.css";

type Props = {
  /** Untreated storage/RPC payload. Parsed here; anything but an exact reference-only capture is unavailable. */
  capture: unknown;
  lang: "en" | "zh";
  /** Context label only — it never turns the read into a live or resolved claim. */
  revision?: { id?: string; investigationId?: string; revision?: number; grantId?: string | null } | null;
  /** The current viewer. Resolution is offered to a current account with complete context only. */
  identity?: AccountIdentity | null;
};

const COPY = {
  en: {
    head: "Saved scenario",
    boundary:
      "This revision records the scenario inputs its author set, plus a reference to the exact market source that read used. No market values are stored. Opening this revision does not resolve the reference or verify the saved calculation. Use the explicit resolve action below to request the exact retained source under your current access.",
    model: "Model",
    sourceOwner: "Source owner",
    root: "Security root",
    session: "Source session",
    sourceAsOf: "Source as of",
    unknownClock: "Unknown at capture",
    evaluatedAt: "Captured at",
    lens: "Lens",
    selection: "Expiries selected",
    digest: "Basis digest",
    gexRef: "GEX source reference",
    movesRef: "Moves source reference",
    movesNone: "Not referenced",
    bytes: "bytes",
    inputs: "Scenario inputs",
    targetSpot: "Target spot",
    deltaSigmaPts: "Vol shift (Δσ points)",
    days: "Calendar days",
    resolution: "Source resolution at reopen",
    resolutionValue: "Not verified",
    unavailable:
      "The saved scenario for this revision is unavailable. No inputs or source reference are shown, and no current data is substituted.",
    resolveBtn: "Resolve saved scenario",
    resolveBusy: "Resolving…",
    resolveNote:
      "Resolution reads the exact referenced source again on the server, under your current access, for this exact revision only. It happens only when you ask: nothing is resolved automatically, nothing is stored with the research, and no current or alternative source is ever substituted.",
    resolvedLabel: "Resolved for this exact revision (read-only)",
    basisHead: "What the resolution was based on",
    qualLabel: "Basis qualification",
    refSpot: "Reference spot",
    gexBasis: "GEX basis",
    vexBasis: "VEX basis",
    cexBasis: "CEX basis",
    emLabel: "1σ expected move",
    moveLabel: "Spot move",
    spotTerm: "Spot term",
    volTerm: "Vol term",
    timeTerm: "Time term",
    totalLabel: "Total",
    readOnlyNote:
      "Displayed only — these values are not stored with the research. A later attempt can become unavailable if access or retention changes; a successful resolution always uses this same captured source and model.",
    notFound:
      "This saved scenario is unavailable for this revision and your current access. Nothing was substituted or changed, and the saved reference is kept.",
    denied:
      "Resolving this saved scenario requires current access to the exact referenced source. Nothing was substituted and nothing was changed.",
    unavailableNow:
      "The saved scenario could not be resolved right now. Nothing was substituted and nothing was changed — you can try again.",
    mismatch:
      "The resolution answer did not match this exact saved reference, so it was discarded. Nothing was substituted and nothing was changed.",
    reasonLabel: "Reason",
  },
  zh: {
    head: "已保存方案",
    boundary:
      "此修订版本记录了作者设置的方案输入，以及该次读数所用确切市场来源的引用。不存储任何市场数值。打开此修订版本不会解析引用或核验计算。可通过下方的显式解析操作，在当前访问权限下请求确切保留的来源。",
    model: "模型",
    sourceOwner: "来源属主",
    root: "证券代码",
    session: "来源盘面",
    sourceAsOf: "来源截至",
    unknownClock: "捕获时未知",
    evaluatedAt: "捕获时间",
    lens: "透镜",
    selection: "所选到期",
    digest: "基准摘要",
    gexRef: "GEX 来源引用",
    movesRef: "Moves 来源引用",
    movesNone: "未引用",
    bytes: "字节",
    inputs: "方案输入",
    targetSpot: "目标现价",
    deltaSigmaPts: "波动率偏移（Δσ 点）",
    days: "自然日",
    resolution: "重新打开时的来源解析",
    resolutionValue: "未核验",
    unavailable: "此修订版本的已保存方案不可用。不显示任何输入或来源引用，也不会替换为当前数据。",
    resolveBtn: "解析已保存方案",
    resolveBusy: "解析中…",
    resolveNote:
      "解析会在服务器上、在你当前的访问权限下，仅为这一个确切修订版本重新读取所引用的确切来源。仅在你主动点击时才会发生：不会自动解析，不会随研究存储任何数值，也绝不会替换为当前或其他来源。",
    resolvedLabel: "已为此确切修订版本解析（只读）",
    basisHead: "解析所依据的基准",
    qualLabel: "基准资格",
    refSpot: "参考现价",
    gexBasis: "GEX 基准",
    vexBasis: "VEX 基准",
    cexBasis: "CEX 基准",
    emLabel: "1σ 预期波动",
    moveLabel: "现价变动",
    spotTerm: "现价项",
    volTerm: "波动率项",
    timeTerm: "时间项",
    totalLabel: "合计",
    readOnlyNote:
      "仅作展示——这些数值不会随研究存储。若权限或保留状态变化，再次解析可能不可用；成功解析始终使用此处相同的捕获来源与模型。",
    notFound:
      "此已保存方案在该修订版本及你当前的访问权限下不可用。未替换或更改任何内容，已保存的引用保持不变。",
    denied:
      "解析此已保存方案需要对所引用确切来源的当前访问权限。未替换任何数据，也未更改任何内容。",
    unavailableNow:
      "此已保存方案暂时无法解析。未替换任何数据，也未更改任何内容——可以重试。",
    mismatch:
      "解析答案与此确切的已保存引用不一致，已弃用该答案。未替换任何数据，也未更改任何内容。",
    reasonLabel: "原因",
  },
} as const;

/** The exact stored number, never re-rounded: String() keeps every double digit. */
const exact = (v: number): string => (Number.isFinite(v) ? String(v) : "—");
const lensText = (lens: unknown): string => {
  const l = (lens ?? {}) as { kind?: unknown; exp?: unknown };
  return typeof l.exp === "string" ? `${String(l.kind)} · ${l.exp}` : String(l.kind);
};
const digestText = (ref: { sha256: string; byte_length: number }, bytes: string): string =>
  `${ref.sha256} · ${exact(ref.byte_length)} ${bytes}`;

// ── Resolution contract ─────────────────────────────────────────────────────────────────────

/** A real investigation / grant uuid — the only context that may name the resolve target. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The exact, complete context a resolve request may carry. `grantId` is null for the owner. */
type ResolutionContext = { investigationId: string; revision: number; grantId: string | null };

/** Read-only failure statuses the endpoint may answer with. Anything else is unknown. */
const FAILURE_STATUS = new Set<string>(["not_found", "unavailable", "denied"]);
/** Allowlisted, bounded failure reasons. Anything else is reported as unknown, never guessed. */
const FAILURE_REASON = new Set<string>([
  "not_retained",
  "source_unavailable",
  "model_unavailable",
  "rights_unqualified",
  "out_of_range",
  "invalid_capture",
]);
const FAILURE_KIND = ["not_found", "unavailable", "denied", "mismatch"] as const;
type FailureKind = (typeof FAILURE_KIND)[number];

type ResolveState =
  | { phase: "idle" }
  | { phase: "resolving" }
  | { phase: "failed"; kind: FailureKind; reason: string | null }
  | { phase: "resolved"; basis: ScenarioBasis; result: ScenarioValue };

type ResolutionVerdict =
  | { ok: true; basis: ScenarioBasis; result: ScenarioValue }
  | { ok: false; kind: FailureKind; reason: string | null };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Exact key set: every key present, nothing else own — a payload with extras is refused. */
const hasKeys = (raw: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(raw);
  if (own.length !== keys.length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(raw, k));
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nullableFinite = (v: unknown): v is number | null => v === null || finite(v);

/** Native full-precision results must agree exactly; never accept rounded substitutes. */
const close = (a: number, b: number): boolean =>
  a === b;
const termEq = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : close(a, b);

const BASIS_KEYS = [
  "root", "session", "referenceSpot", "gexMn", "vexMn", "cexMn", "emPct", "qualification", "sourceRef",
] as const;

/** Strict ScenarioBasis shape bound to THIS capture's root/session, qualified, or null. */
const parseBasis = (raw: unknown, capture: ScenarioCapture): ScenarioBasis | null => {
  if (!isRecord(raw) || !hasKeys(raw, BASIS_KEYS)) return null;
  const { root, session, referenceSpot, gexMn, vexMn, cexMn, emPct, qualification, sourceRef } = raw;
  if (root !== capture.source.root || session !== capture.source.session) return null;
  if (!finite(referenceSpot) || referenceSpot <= 0) return null;
  if (!nullableFinite(gexMn) || !nullableFinite(vexMn) || !nullableFinite(cexMn) || !nullableFinite(emPct)) return null;
  if (qualification !== "qualified") return null;
  if (sourceRef !== null) {
    if (typeof sourceRef !== "string") return null;
  }
  return {
    root, session, referenceSpot, gexMn, vexMn, cexMn, emPct,
    qualification: "qualified", sourceRef,
  };
};

const RESULT_KEYS = ["ok", "version", "moveFraction", "movePct", "inputs", "terms", "totalMn", "joint", "missing"] as const;
const GREEKS = ["gex", "vex", "cex"] as const;

/** Strict frozen ScenarioValue shape re-binding THIS capture's exact inputs, or null. */
const parseResult = (raw: unknown, inputs: ScenarioInputs): ScenarioValue | null => {
  if (!isRecord(raw) || !hasKeys(raw, RESULT_KEYS)) return null;
  const { ok, version, moveFraction, movePct, inputs: returned, terms, totalMn, joint, missing } = raw;
  if (ok !== true || version !== SCENARIO_VERSION || joint !== false) return null;
  if (!finite(moveFraction) || !finite(movePct) || !finite(totalMn)) return null;
  if (!isRecord(returned) || !hasKeys(returned, ["targetSpot", "deltaSigmaPts", "days"])) return null;
  const { targetSpot, deltaSigmaPts, days } = returned;
  if (!finite(targetSpot) || !finite(deltaSigmaPts) || !finite(days)) return null;
  if (targetSpot !== inputs.targetSpot || deltaSigmaPts !== inputs.deltaSigmaPts || days !== inputs.days) return null;
  if (!isRecord(terms) || !hasKeys(terms, ["spotMn", "volMn", "timeMn"])) return null;
  const { spotMn, volMn, timeMn } = terms;
  if (!nullableFinite(spotMn) || !nullableFinite(volMn) || !nullableFinite(timeMn)) return null;
  if (!Array.isArray(missing) || !missing.every((g) => (GREEKS as readonly unknown[]).includes(g))) return null;
  return {
    ok: true, version: SCENARIO_VERSION, moveFraction, movePct,
    inputs: { targetSpot, deltaSigmaPts, days },
    terms: { spotMn, volMn, timeMn },
    totalMn, joint: false, missing: missing as ScenarioValue["missing"],
  };
};

/**
 * Bind and validate one resolution answer against THIS exact context and capture.
 * A failure status is forwarded with its allowlisted reason (unknown reasons stay unknown).
 * A success must echo the exact id/revision/grant, carry a capture that strictly equals the
 * capture in view, and carry a basis/result the native engine reproduces — anything else is a
 * mismatch that paints nothing. No failure here is ever a zero, an ended grant or a success.
 */
const readVerdict = (body: unknown, ctx: ResolutionContext, capture: ScenarioCapture): ResolutionVerdict => {
  if (!isRecord(body)) return { ok: false, kind: "unavailable", reason: null };
  const status = body.status;
  const reason = typeof body.reason === "string" && FAILURE_REASON.has(body.reason) ? body.reason : null;
  if (typeof status === "string" && FAILURE_STATUS.has(status)) {
    return { ok: false, kind: status as FailureKind, reason };
  }
  if (status !== "resolved") return { ok: false, kind: "unavailable", reason: null };
  if (body.investigation_id !== ctx.investigationId || body.revision !== ctx.revision || body.grant_id !== ctx.grantId) {
    return { ok: false, kind: "mismatch", reason: null };
  }
  const returned = parseScenarioCapture(body.capture);
  // Both sides are parser outputs with a fixed key order, so a string compare is an exact deep
  // equality — a server answer about any other reference is not this reference's answer.
  if (!returned || JSON.stringify(returned) !== JSON.stringify(capture)) {
    return { ok: false, kind: "mismatch", reason: null };
  }
  const basis = parseBasis(body.basis, capture);
  const result = parseResult(body.result, capture.inputs);
  if (!basis || !result) return { ok: false, kind: "mismatch", reason: null };
  // The native engine is the only math authority: the returned paid values must be exactly what
  // it computes from the returned basis and this capture's inputs.
  const local = localScenarioValue(basis, capture.inputs);
  if (!local.ok) return { ok: false, kind: "mismatch", reason: null };
  if (!close(local.moveFraction, result.moveFraction) || !close(local.movePct, result.movePct)
    || !close(local.totalMn, result.totalMn)) return { ok: false, kind: "mismatch", reason: null };
  if (!termEq(local.terms.spotMn, result.terms.spotMn) || !termEq(local.terms.volMn, result.terms.volMn)
    || !termEq(local.terms.timeMn, result.terms.timeMn)) return { ok: false, kind: "mismatch", reason: null };
  if (local.missing.length !== result.missing.length
    || !local.missing.every((g, i) => result.missing[i] === g)) return { ok: false, kind: "mismatch", reason: null };
  return { ok: true, basis, result };
};

/**
 * The keyed resolution subcomponent. Its key is the exact (account, investigation, revision,
 * grant, capture) tuple, so any context change replaces it — fresh state, prior paid values gone
 * in the same render — and its cleanup aborts the in-flight request. It never fetches on mount;
 * resolving is always one deliberate button click, and a failed or mismatched answer leaves the
 * button available for an explicit retry only.
 */
function SavedScenarioResolve({ ctx, capture, lang }: {
  ctx: ResolutionContext;
  capture: ScenarioCapture;
  lang: "en" | "zh";
}) {
  const c = COPY[lang];
  const [state, setState] = useState<ResolveState>({ phase: "idle" });
  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  // Unmount (or a key change replacing this instance) aborts the in-flight request and stops any
  // late completion from painting. The response can never outlive the context it was asked for.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function onResolve() {
    if (!aliveRef.current || state.phase === "resolving") return;
    // Replacing the whole state clears any previously painted paid values in this same commit.
    setState({ phase: "resolving" });
    const controller = new AbortController();
    abortRef.current = controller;
    let body: unknown = null;
    try {
      // The exact wire contract: three keys, nothing else — no capture/user/token/root/source/
      // model override. Verification, the canonical RPC, hashes and math are server-owned.
      const response = await fetch("/api/investigation-scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          investigation_id: ctx.investigationId,
          revision: ctx.revision,
          grant_id: ctx.grantId,
        }),
      });
      body = await response.json();
      if (!response.ok && !(isRecord(body) && FAILURE_STATUS.has(String(body.status)))) body = null;
    } catch {
      body = null; // transport failure or abort: unknown, never an effect claim
    }
    if (!aliveRef.current || controller.signal.aborted) return;
    const verdict = readVerdict(body, ctx, capture);
    setState(verdict.ok
      ? { phase: "resolved", basis: verdict.basis, result: verdict.result }
      : { phase: "failed", kind: verdict.kind, reason: verdict.reason });
  }

  const statusText = state.phase === "idle" ? `${c.resolution}: ${c.resolutionValue}`
    : state.phase === "resolving" ? c.resolveBusy
    : state.phase === "failed"
      ? `${state.kind === "unavailable" ? c.unavailableNow : state.kind === "not_found" ? c.notFound : c[state.kind]}${state.reason ? ` (${c.reasonLabel}: ${state.reason})` : ""}`
      : c.resolvedLabel;
  const stateAttr = state.phase === "idle" ? "unverified"
    : state.phase === "failed" ? state.kind
    : state.phase;

  return (
    <div className={styles.resolve} data-testid="scenario-resolution" data-state={stateAttr}>
      <p className={styles.note}>{c.resolveNote}</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.action} ${styles.primary}`}
          onClick={() => void onResolve()}
          disabled={state.phase === "resolving"}
          aria-label={c.resolveBtn}
        >
          {state.phase === "resolving" ? c.resolveBusy : c.resolveBtn}
        </button>
      </div>
      <p className={styles.status} role="status">{statusText}</p>
      {state.phase === "resolved" ? (
        <>
          <span className={styles.eyebrow}>{c.basisHead}</span>
          <p className={`${styles.status} ${styles.ok}`}>
            {`${c.model} ${capture.model_version} · ${capture.source.owner} · ${capture.source.root} · ${capture.source.session}`}
          </p>
          <dl className={styles.facts}>
            <div><dt>{c.qualLabel}</dt><dd>{state.basis.qualification}</dd></div>
            <div><dt>{c.refSpot}</dt><dd>{exact(state.basis.referenceSpot)}</dd></div>
            <div><dt>{c.gexBasis}</dt><dd>{fmtScenarioMn(state.basis.gexMn, 3)}</dd></div>
            <div><dt>{c.vexBasis}</dt><dd>{fmtScenarioMn(state.basis.vexMn, 3)}</dd></div>
            <div><dt>{c.cexBasis}</dt><dd>{fmtScenarioMn(state.basis.cexMn, 3)}</dd></div>
            <div><dt>{c.emLabel}</dt><dd>{state.basis.emPct === null ? "—" : `${state.basis.emPct}%`}</dd></div>
            <div><dt>{c.moveLabel}</dt><dd>{fmtMovePct(state.result.moveFraction)}</dd></div>
            <div><dt>{c.spotTerm}</dt><dd>{fmtScenarioMn(state.result.terms.spotMn, 3)}</dd></div>
            <div><dt>{c.volTerm}</dt><dd>{fmtScenarioMn(state.result.terms.volMn, 3)}</dd></div>
            <div><dt>{c.timeTerm}</dt><dd>{fmtScenarioMn(state.result.terms.timeMn, 3)}</dd></div>
            <div><dt>{c.totalLabel}</dt><dd><strong>{fmtScenarioMn(state.result.totalMn, 3)}</strong></dd></div>
          </dl>
          <p className={styles.note}>{c.readOnlyNote}</p>
        </>
      ) : null}
    </div>
  );
}

/** Complete, exact resolve context — or none. A partial or malformed context stays metadata-only. */
const resolutionContext = (revision: Props["revision"], parsed: ScenarioCapture | null, userId: string):
  ResolutionContext | null => {
  if (!parsed || !userId) return null;
  const investigationId = revision?.investigationId ?? revision?.id;
  if (typeof investigationId !== "string" || !UUID_RE.test(investigationId)) return null;
  const rev = revision?.revision;
  if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 1) return null;
  const grantId = revision?.grantId;
  if (grantId != null && (typeof grantId !== "string" || !UUID_RE.test(grantId))) return null;
  return { investigationId, revision: rev, grantId: grantId ?? null };
};

export default function SavedScenarioRead({ capture, lang, revision, identity }: Props) {
  const c = COPY[lang];
  const zh = lang === "zh";
  const parsed = useMemo(() => parseScenarioCapture(capture), [capture]);
  if (!parsed) {
    // The one honest answer for an absent, malformed or legacy full-value payload: say so,
    // paint nothing else, and keep no cached values behind it.
    return (
      <div className={styles.read} data-testid="saved-scenario-read" data-state="unavailable" role="status">
        <p className={styles.boundary}>{c.unavailable}</p>
      </div>
    );
  }
  const { inputs, source } = parsed;
  // Resolve is offered only for a current account with a complete exact context; everything else
  // keeps the metadata-only read and its truthful unverified line.
  const userId = identityUserId(identity);
  const ctx = resolutionContext(revision, parsed, userId);
  // The key binds the resolution to ONE exact context+capture: any change remounts the child in
  // the same render, clearing its private basis/results synchronously and aborting its request.
  const resolveKey = ctx ? `${userId}|${ctx.investigationId}|${ctx.revision}|${ctx.grantId ?? "owner"}|${JSON.stringify(parsed)}` : "";
  return (
    <div className={styles.read} data-testid="saved-scenario-read" data-state="ok">
      <p className={styles.boundary} role="note">{c.boundary}</p>

      <span className={styles.eyebrow}>{c.head}</span>
      <dl className={styles.facts}>
        <div><dt>{c.model}</dt><dd>{parsed.model_version}</dd></div>
        <div><dt>{c.sourceOwner}</dt><dd>{source.owner}</dd></div>
        <div><dt>{c.root}</dt><dd>{source.root}</dd></div>
        <div><dt>{c.session}</dt><dd>{source.session}</dd></div>
        <div><dt>{c.sourceAsOf}</dt><dd>{source.source_as_of ?? c.unknownClock}</dd></div>
        <div><dt>{c.evaluatedAt}</dt><dd>{source.evaluated_at}</dd></div>
        <div><dt>{c.lens}</dt><dd>{lensText(source.lens)}</dd></div>
        <div><dt>{c.selection}</dt><dd>{source.selection_key}</dd></div>
        <div><dt>{c.digest}</dt><dd>{source.basis_sha256}</dd></div>
        <div><dt>{c.gexRef}</dt><dd>{digestText(source.gex, c.bytes)}</dd></div>
        <div><dt>{c.movesRef}</dt><dd>{source.moves === null ? c.movesNone : digestText(source.moves, c.bytes)}</dd></div>
        {revision?.revision != null && <div><dt>{zh ? "快照" : "Snapshot"}</dt><dd>{`r${revision.revision}`}</dd></div>}
      </dl>

      <span className={styles.eyebrow}>{c.inputs}</span>
      <dl className={styles.facts}>
        <div><dt>{c.targetSpot}</dt><dd>{exact(inputs.targetSpot)}</dd></div>
        <div><dt>{c.deltaSigmaPts}</dt><dd>{exact(inputs.deltaSigmaPts)}</dd></div>
        <div><dt>{c.days}</dt><dd>{exact(inputs.days)}</dd></div>
      </dl>

      {ctx && parsed
        ? <SavedScenarioResolve key={resolveKey} ctx={ctx} capture={parsed} lang={lang} />
        : <p className={styles.status} role="status" data-testid="scenario-resolution" data-state="unverified">
            {`${c.resolution}: ${c.resolutionValue}`}
          </p>}
    </div>
  );
}
