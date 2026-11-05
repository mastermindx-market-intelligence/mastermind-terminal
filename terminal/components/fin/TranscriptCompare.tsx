"use client";

/**
 * Two-call transcript comparison (E12). Reads two exact calls of one company
 * through the revision-verified loader, filters both with the same literal
 * topic / exact speaker / verified section filter, and shows every passage
 * beside the call, revision and segment it was quoted from. The optional
 * "shared wording" view pairs passages by content-word overlap only; it never
 * claims a change, a cause, or that a speaker is the same person.
 *
 * Nothing here stores corpus text: links and receipts carry IDs, revision
 * fingerprints and offsets, and "Re-verify" rebuilds the comparison from the
 * receipt alone against the live archive.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fmtDate } from "../../lib/finFormat";
import type { TranscriptIndexCall } from "../../lib/transcripts";
import {
  getRevisionVerifiedTranscripts,
  type RevisionVerifiedTranscript,
  type TranscriptOpenTarget,
  type TranscriptRevisionResult,
  type TranscriptSpan,
} from "../../lib/transcriptSearch";
import {
  alignComparePassages,
  buildTranscriptComparisonReceipt,
  comparePassageSpan,
  compareSpeakers,
  MAX_COMPARE_QUERY_CHARS,
  MAX_RECEIPT_SPANS_PER_SIDE,
  normalizeCompareFilter,
  reconstructTranscriptComparison,
  selectComparePassages,
  writeTranscriptCompareParams,
  type CompareFilter,
  type CompareMode,
  type ComparePassage,
  type ComparePassageSection,
  type ComparePassageSelection,
  type CompareSection,
  type CompareSide,
  type TranscriptCompareLink,
  type TranscriptCompareLinkCall,
  type TranscriptComparisonReceipt,
  type TranscriptReconstructionProblem,
} from "../../lib/transcriptCompare";
import { useTranscriptCompareT, type TranscriptCompareVars } from "../../lib/transcriptCompareLex";
import styles from "./TranscriptCompare.module.css";

export interface TranscriptCompareProps {
  sym: string;
  /** The archive list the Transcripts page already shows (newest first). */
  calls: readonly TranscriptIndexCall[];
  /** A comparison link from the URL; applied only when it names this ticker. */
  initialLink: TranscriptCompareLink | null;
  onOpenTx: (target: TranscriptOpenTarget) => void;
  onClose: () => void;
  /** The first user change after a link was applied: the URL no longer describes the view. */
  onDetachLink: () => void;
}

type Translate = (key: string, vars?: TranscriptCompareVars) => string;

type LoadState =
  | { key: string; status: "loading" }
  | { key: string; status: "unavailable" }
  | { key: string; status: "ready"; generated_at: string; results: Record<string, TranscriptRevisionResult> };

type VerifyState =
  | { key: string; status: "running" }
  | { key: string; status: "verified"; passages: number; pairs: number }
  | { key: string; status: "failed"; problems: TranscriptReconstructionProblem[] }
  | { key: string; status: "blocked"; reason: "unavailable" | "too_many" };

const SIDES = ["a", "b"] as const;
const SIDE_TAG: Record<CompareSide, string> = { a: "A", b: "B" };
const SECTION_KEY: Record<ComparePassageSection, string> = {
  prepared: "tcSecPrepared",
  qa: "tcSecQa",
  qa_transition: "tcSecHandoff",
  unknown: "tcSecUnknown",
};
const SECTION_FILTERS: Array<{ value: CompareSection; key: string }> = [
  { value: "all", key: "tcSectionAll" },
  { value: "prepared", key: "tcSectionPrepared" },
  { value: "qa", key: "tcSectionQa" },
];

/** Latest call as B; the same quarter a year earlier as A when listed, else the previous call. */
function defaultPair(calls: readonly TranscriptIndexCall[]): { a: string; b: string } {
  const ids = [...new Set(calls.map((call) => call.id))].sort((x, y) => y.localeCompare(x));
  const latest = ids[0] ?? "";
  const yearEarlier = latest ? `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}` : "";
  return { a: ids.includes(yearEarlier) ? yearEarlier : ids[1] ?? latest, b: latest };
}

function spanKey(callId: string, bodySha: string, segmentIndex: number): string {
  return `${callId}|${bodySha}|${segmentIndex}`;
}

function sha12(value: string | null | undefined): string {
  return value ? value.slice(0, 12) : "";
}

function highlight(text: string, matches: ReadonlyArray<[number, number]>): ReactNode {
  if (!matches.length) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of matches) {
    if (start < cursor) continue;
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(<mark key={start}>{text.slice(start, end)}</mark>);
    cursor = end;
  }
  out.push(text.slice(cursor));
  return out;
}

function problemText(problem: TranscriptReconstructionProblem, t: Translate, callName: (side: CompareSide) => string): string {
  switch (problem.kind) {
    case "invalid_receipt":
      return t("tcProblem_invalid_receipt");
    case "archive_unavailable":
      return t("tcProblem_archive_unavailable");
    case "not_covered":
      return t("tcProblem_not_covered", { call: callName(problem.side) });
    case "stale_revision":
      return t("tcProblem_stale_revision", { call: callName(problem.side) });
    case "revision_changed":
      return t("tcProblem_revision_changed", {
        call: callName(problem.side),
        old: sha12(problem.receipt_body_sha256),
        new: sha12(problem.current_body_sha256),
      });
    case "segment_missing":
      return t("tcProblem_segment_missing", { call: callName(problem.side) });
    case "span_mismatch":
      return t("tcProblem_span_mismatch", { call: callName(problem.side) });
    case "pair_unsupported":
      return t("tcProblem_pair_unsupported");
  }
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

interface PassageCardProps {
  passage: ComparePassage;
  span: TranscriptSpan | undefined;
  callName: string;
  t: Translate;
  copied: { id: string; ok: boolean } | null;
  onOpen: (passage: ComparePassage) => void;
  onCopy: (id: string, value: string) => void;
}

function PassageCard({ passage, span, callName, t, copied, onOpen, onCopy }: PassageCardProps) {
  const n = passage.segment_index + 1;
  const speaker = passage.speaker.trim();
  const role = passage.role.trim();
  const copyId = span ? `ref:${span.span_id}` : "";
  return (
    <article
      className={styles.passage}
      data-compare-side={passage.side}
      data-call-id={passage.call_id}
      data-body-sha256={passage.body_sha256}
      data-segment-index={passage.segment_index}
      data-span-id={span?.span_id ?? ""}
    >
      <div className={styles.passageHead}>
        <span className={styles.sideDot} aria-hidden>{SIDE_TAG[passage.side]}</span>
        <span className={styles.speaker}>{speaker || t("tcUnknownSpeaker")}</span>
        {role && (
          <span className={styles.role} title={t("tcInferredTitle")}>
            {t("tcInferredRole")} · {role}
          </span>
        )}
        <span className={styles.sectionChip} data-passage-section={passage.section}>{t(SECTION_KEY[passage.section])}</span>
        <span className={styles.segment}>{t("tcSegment", { n })}</span>
      </div>
      <p className={styles.text}>{highlight(passage.text, passage.matches)}</p>
      <div className={styles.passageFoot}>
        <button
          type="button"
          className={styles.openSource}
          onClick={() => onOpen(passage)}
          aria-label={t("tcOpenSourceAria", { n, call: callName })}
        >
          {t("tcOpenSource")} ›
        </button>
        {span && (
          <details className={styles.reference}>
            <summary>{t("tcReference")}</summary>
            <div className={styles.referenceBody}>
              <code className={styles.spanId}>{span.span_id}</code>
              <span className={styles.locator}>
                {t("tcLocator", { key: span.document_key, sha: sha12(span.body_sha256), start: span.start_byte, end: span.end_byte })}
              </span>
              <span className={styles.referenceNote}>{t("tcReferenceNote")}</span>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => onCopy(copyId, JSON.stringify({
                  span_id: span.span_id,
                  document_key: span.document_key,
                  body_sha256: span.body_sha256,
                  segment_index: span.segment_index,
                  start_byte: span.start_byte,
                  end_byte: span.end_byte,
                  segment_text_sha256: span.segment_text_sha256,
                }))}
              >
                {copied?.id === copyId ? t(copied.ok ? "tcCopied" : "tcCopyFailed") : t("tcCopyReference")}
              </button>
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

export default function TranscriptCompare({ sym, calls, initialLink, onOpenTx, onClose, onDetachLink }: TranscriptCompareProps) {
  const t = useTranscriptCompareT();
  const ticker = sym.toUpperCase();
  const baseId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<CompareSide, HTMLButtonElement | null>>({ a: null, b: null });

  const appliedLink = initialLink && initialLink.ticker === ticker ? initialLink : null;
  const [invalidLinkTicker] = useState(initialLink && !appliedLink ? initialLink.ticker : null);
  // The fingerprints a link was made against; kept while the same call stays selected.
  const [linkedCalls] = useState<TranscriptCompareLinkCall[]>(appliedLink ? [appliedLink.a, appliedLink.b] : []);
  const linkAttachedRef = useRef(appliedLink !== null);
  const [selection, setSelection] = useState(() => appliedLink ? { a: appliedLink.a.id, b: appliedLink.b.id } : defaultPair(calls));
  const [filter, setFilter] = useState<CompareFilter>(() => appliedLink ? appliedLink.filter : normalizeCompareFilter(null));
  const [mode, setMode] = useState<CompareMode>(appliedLink?.mode ?? "side");
  const [activeSide, setActiveSide] = useState<CompareSide>("b");
  const [retryNonce, setRetryNonce] = useState(0);
  const [load, setLoad] = useState<LoadState>({ key: "", status: "loading" });
  const [spanState, setSpanState] = useState<{ key: string; spans: Map<string, TranscriptSpan> }>({ key: "", spans: new Map() });
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
  const [verify, setVerify] = useState<VerifyState | null>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, []);

  // The loader key is the UNORDERED pair, so swapping A and B never refetches.
  const sameCall = !selection.a || selection.a === selection.b;
  const pairKey = sameCall ? "" : [selection.a, selection.b].sort().join("|");
  const pairIds = useMemo(() => pairKey ? pairKey.split("|") : null, [pairKey]);
  const loadKey = pairKey ? `${ticker}|${pairKey}|${retryNonce}` : "";

  useEffect(() => {
    if (!pairIds || !loadKey) return;
    const controller = new AbortController();
    getRevisionVerifiedTranscripts(ticker, pairIds, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.status !== "ready") {
          setLoad({ key: loadKey, status: "unavailable" });
          return;
        }
        const results: Record<string, TranscriptRevisionResult> = {};
        pairIds.forEach((id, index) => {
          results[id] = result.results[index];
        });
        setLoad({ key: loadKey, status: "ready", generated_at: result.generated_at, results });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ key: loadKey, status: "unavailable" });
      });
    return () => controller.abort();
  }, [loadKey, pairIds, ticker]);

  const current = load.key === loadKey ? load : null;
  const loading = !sameCall && (!current || current.status === "loading");
  const archiveUnavailable = current?.status === "unavailable";
  // Each side reads ONLY the result for its own call ID; nothing falls back to another call.
  const results = useMemo<Record<CompareSide, TranscriptRevisionResult | null>>(() => {
    const ready = load.key === loadKey && load.status === "ready" ? load.results : null;
    return { a: ready?.[selection.a] ?? null, b: ready?.[selection.b] ?? null };
  }, [load, loadKey, selection.a, selection.b]);
  const resultA = results.a;
  const resultB = results.b;
  const docA = resultA?.status === "ready" ? resultA.document : null;
  const docB = resultB?.status === "ready" ? resultB.document : null;
  const docs: Record<CompareSide, RevisionVerifiedTranscript | null> = { a: docA, b: docB };

  const selectionA = useMemo(() => docA ? selectComparePassages(docA, "a", filter) : null, [docA, filter]);
  const selectionB = useMemo(() => docB ? selectComparePassages(docB, "b", filter) : null, [docB, filter]);
  const selections: Record<CompareSide, ComparePassageSelection | null> = { a: selectionA, b: selectionB };
  const bothOk = selectionA?.status === "ok" && selectionB?.status === "ok";
  const alignment = useMemo(
    () => mode === "align" && selectionA?.status === "ok" && selectionB?.status === "ok"
      ? alignComparePassages(selectionA.passages, selectionB.passages)
      : null,
    [mode, selectionA, selectionB],
  );
  const speakers = useMemo(() => compareSpeakers(docA, docB), [docA, docB]);

  // Every segment's revision-bound span reference, derived once per loaded body.
  const spansKey = `${docA?.revision.id ?? ""}:${docA?.revision.body_sha256 ?? ""}|${docB?.revision.id ?? ""}:${docB?.revision.body_sha256 ?? ""}`;
  useEffect(() => {
    let alive = true;
    const documents = [docA, docB].filter((doc): doc is RevisionVerifiedTranscript => Boolean(doc?.revision.body_sha256));
    Promise.all(documents.flatMap((doc) => doc.transcript.segments.map(async (segment, index) => {
      const bodySha = doc.revision.body_sha256!;
      const span = await comparePassageSpan({ ticker: doc.revision.ticker, call_id: doc.revision.id, body_sha256: bodySha, segment_index: index, text: segment.text });
      return span ? [spanKey(doc.revision.id, bodySha, index), span] as const : null;
    }))).then((entries) => {
      if (!alive) return;
      const spans = new Map<string, TranscriptSpan>();
      for (const entry of entries) if (entry) spans.set(entry[0], entry[1]);
      setSpanState({ key: spansKey, spans });
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [docA, docB, spansKey]);
  const spans = spanState.key === spansKey ? spanState.spans : null;
  const spanOf = (passage: ComparePassage) => spans?.get(spanKey(passage.call_id, passage.body_sha256, passage.segment_index));

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const listed = useMemo(() => new Map(calls.map((call) => [call.id, call])), [calls]);
  const options = useMemo(() => {
    const ids = new Set(calls.map((call) => call.id));
    for (const id of [selection.a, selection.b]) if (id) ids.add(id);
    return [...ids].sort((x, y) => y.localeCompare(x));
  }, [calls, selection.a, selection.b]);
  const callName = (id: string): string => listed.get(id)?.period
    ?? (docA?.revision.id === id ? docA.transcript.period : docB?.revision.id === id ? docB.transcript.period : id);
  const sideName = (side: CompareSide) => `${SIDE_TAG[side]} · ${callName(selection[side])}`;
  const optionLabel = (id: string): string => {
    const call = listed.get(id);
    if (!call) return t("tcNotListed", { id });
    return call.date ? `${call.period} · ${fmtDate(call.date)}` : call.period;
  };

  const corrections = SIDES.flatMap((side) => {
    const doc = docs[side];
    const linked = linkedCalls.find((call) => call.id === selection[side]);
    const now = sha12(doc?.revision.body_sha256);
    return doc && linked?.sha12 && now && now !== linked.sha12 ? [{ side, old: linked.sha12, now }] : [];
  });

  const comparisonKey = `${loadKey}|${selection.a}|${selection.b}|${filter.query}|${filter.speaker ?? ""}|${filter.section}|${mode}`;
  const verifyNow = verify && verify.key === comparisonKey ? verify : null;
  const trimmedQuery = filter.query.trim();

  const detach = () => {
    if (!linkAttachedRef.current) return;
    linkAttachedRef.current = false;
    onDetachLink();
  };
  const changeCall = (side: CompareSide, id: string) => {
    detach();
    setSelection((prev) => ({ ...prev, [side]: id }));
  };
  const swap = () => {
    detach();
    setSelection((prev) => ({ a: prev.b, b: prev.a }));
  };
  const changeFilter = (patch: Partial<CompareFilter>) => {
    detach();
    setFilter((prev) => normalizeCompareFilter({ ...prev, ...patch }));
  };
  const changeMode = (next: CompareMode) => {
    detach();
    setMode(next);
  };
  const retry = () => setRetryNonce((value) => value + 1);

  const openPassage = (passage: ComparePassage) => {
    onOpenTx({
      id: passage.call_id,
      segment_index: passage.segment_index,
      expected_document_sha256: passage.body_sha256,
      query: trimmedQuery || undefined,
    });
  };
  const copy = async (id: string, value: string) => {
    const ok = await writeClipboard(value);
    setCopied({ id, ok });
  };

  const comparisonUrl = (): string => {
    const url = new URL(window.location.href);
    // The Analysis workspace routes by `page`; the chart overlay keeps its `pane` contract.
    if (url.pathname.startsWith("/analysis")) {
      url.searchParams.set("page", "transcripts");
      url.searchParams.delete("pane");
    } else {
      url.searchParams.set("pane", "transcripts");
    }
    url.searchParams.delete("tx");
    writeTranscriptCompareParams(url.searchParams, {
      ticker,
      a: { id: selection.a, sha12: sha12(docA?.revision.body_sha256) || null },
      b: { id: selection.b, sha12: sha12(docB?.revision.body_sha256) || null },
      filter,
      mode,
    });
    return url.toString();
  };

  const tooMany = bothOk && (
    (selectionA?.status === "ok" && selectionA.passages.length > MAX_RECEIPT_SPANS_PER_SIDE)
    || (selectionB?.status === "ok" && selectionB.passages.length > MAX_RECEIPT_SPANS_PER_SIDE)
  );
  const buildReceipt = async (): Promise<TranscriptComparisonReceipt | "unavailable" | "too_many"> => {
    if (current?.status !== "ready" || !docA || !docB || selectionA?.status !== "ok" || selectionB?.status !== "ok") return "unavailable";
    if (tooMany) return "too_many";
    const receipt = await buildTranscriptComparisonReceipt({
      archive_generated_at: current.generated_at,
      a: { document: docA, passages: selectionA.passages },
      b: { document: docB, passages: selectionB.passages },
      filter,
      alignment: mode === "align" ? alignment : null,
    });
    return receipt ?? "unavailable";
  };
  const copyReceipt = async () => {
    const receipt = await buildReceipt();
    if (typeof receipt === "string") {
      setVerify({ key: comparisonKey, status: "blocked", reason: receipt });
      return;
    }
    await copy("receipt", JSON.stringify(receipt, null, 2));
  };
  const reverify = async () => {
    const key = comparisonKey;
    setVerify({ key, status: "running" });
    const receipt = await buildReceipt();
    if (typeof receipt === "string") {
      setVerify({ key, status: "blocked", reason: receipt });
      return;
    }
    // Round-trip through JSON: the rebuild sees only what a shared receipt carries.
    const rebuilt = await reconstructTranscriptComparison(JSON.parse(JSON.stringify(receipt)));
    if (rebuilt.status === "verified") {
      setVerify({
        key,
        status: "verified",
        passages: rebuilt.sides.a.passages.length + rebuilt.sides.b.passages.length,
        pairs: rebuilt.pairs.length,
      });
    } else {
      setVerify({ key, status: "failed", problems: rebuilt.problems });
    }
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next: CompareSide = event.key === "Home" ? "a" : event.key === "End" ? "b" : activeSide === "a" ? "b" : "a";
    setActiveSide(next);
    tabRefs.current[next]?.focus();
  };

  const card = (passage: ComparePassage) => (
    <PassageCard
      key={`${passage.side}:${passage.segment_index}`}
      passage={passage}
      span={spanOf(passage)}
      callName={callName(passage.call_id)}
      t={t}
      copied={copied}
      onOpen={openPassage}
      onCopy={copy}
    />
  );

  const sideState = (side: CompareSide): ReactNode => {
    const result = results[side];
    const name = callName(selection[side]);
    if (loading || !result) {
      return (
        <div role="status" aria-busy="true">
          <span className="fin-skel-sr">{t("tcLoading")}</span>
          <div className="fin-skel fin-skel-rows" aria-hidden />
        </div>
      );
    }
    if (result.status === "not_covered") {
      return (
        <div className="fin-empty" role="status" data-compare-state="not-covered">
          <div className="fin-empty-title">{t("tcNotCovered", { call: name })}</div>
          <div className="fin-empty-why">{t("tcNotCoveredWhy")}</div>
        </div>
      );
    }
    if (result.status === "stale_revision") {
      return (
        <div className="fin-empty" role="status" data-compare-state="stale">
          <div className="fin-empty-title">{t("tcStaleTitle", { call: name })}</div>
          <div className="fin-empty-why">{t(`tcStale_${result.reason}`)} {t("tcStaleWhy")}</div>
        </div>
      );
    }
    if (result.status === "unavailable") {
      return (
        <div className="fin-empty" role="alert" data-compare-state="unavailable">
          <div className="fin-empty-title">{t("tcSideUnavailable", { call: name })}</div>
          <button type="button" className="fin-tx-retry" onClick={retry}>{t("tcRetry")}</button>
        </div>
      );
    }
    const chosen = selections[side];
    if (!chosen) return null;
    if (chosen.status === "speaker_absent") {
      return (
        <div className="fin-empty" role="status" data-compare-state="speaker-absent">
          <div className="fin-empty-title">{t("tcSpeakerAbsent", { speaker: filter.speaker ?? "", call: name })}</div>
          <div className="fin-empty-why">{t("tcSpeakerAbsentWhy")}</div>
        </div>
      );
    }
    if (chosen.status === "section_unidentified") {
      return (
        <div className="fin-empty" role="status" data-compare-state="section-unidentified">
          <div className="fin-empty-title">{t("tcSectionUnidentified", { call: name })}</div>
          <div className="fin-empty-why">{t("tcSectionUnidentifiedWhy")}</div>
        </div>
      );
    }
    if (!chosen.passages.length) {
      return (
        <div className="fin-empty" role="status" data-compare-state="no-match">
          <div className="fin-empty-title">{chosen.total ? t("tcNoMatch", { call: name }) : t("tcEmptyDoc", { call: name })}</div>
          {chosen.total > 0 && <div className="fin-empty-why">{t("tcNoMatchWhy")}</div>}
        </div>
      );
    }
    return chosen.passages.map(card);
  };

  const columnHead = (side: CompareSide) => {
    const doc = docs[side];
    const id = selection[side];
    const chosen = selections[side];
    const call = listed.get(id);
    const date = doc?.transcript.date ?? call?.date ?? null;
    return (
      <header className={styles.columnHead}>
        <div className={styles.columnTitle}>
          <span className={styles.sideTag}>{SIDE_TAG[side]}</span>
          <b>{callName(id)}</b>
          {date && <time dateTime={date}>{fmtDate(date)}</time>}
        </div>
        <div className={styles.columnMeta}>
          <span>{ticker} · {id}</span>
          {doc?.revision.body_sha256 && <span>{t("tcRevision", { sha: sha12(doc.revision.body_sha256) })}</span>}
          {doc && <span className={styles.rawChip}>{t("tcRawLabel")}</span>}
        </div>
        {chosen?.status === "ok" && (
          <div className={styles.columnCount} aria-live="polite">
            {t("tcPassageCount", { n: chosen.passages.length, total: chosen.total })}
          </div>
        )}
      </header>
    );
  };

  const speakerFilterListed = !filter.speaker || speakers.some((speaker) => speaker.name === filter.speaker);
  const showAlign = mode === "align" && alignment !== null;

  return (
    <section className={styles.panel} aria-labelledby={`${baseId}-title`} data-testid="transcript-compare">
      <div className={styles.head}>
        <div>
          <div className="fin-eyebrow">{t("tcEyebrow")}</div>
          <h3 id={`${baseId}-title`} ref={headingRef} tabIndex={-1} className={styles.title}>{t("tcTitle")}</h3>
          <p className={styles.intro}>{t("tcIntro")}</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose}>{t("tcClose")}</button>
      </div>

      {invalidLinkTicker && (
        <div className="fin-tx-notice warn" role="status">
          <span>{t("tcLinkInvalid", { ticker: invalidLinkTicker, current: ticker })}</span>
        </div>
      )}
      {corrections.map((correction) => (
        <div key={correction.side} className="fin-tx-notice warn" role="status" data-compare-state="link-corrected">
          <span>{t("tcLinkCorrected", { call: sideName(correction.side), old: correction.old, new: correction.now })}</span>
        </div>
      ))}

      <div className={styles.picker}>
        {SIDES.map((side, index) => (
          <label key={side} className={styles.pickerField} style={{ order: index * 2 }}>
            <span>{t(side === "a" ? "tcCallA" : "tcCallB")}</span>
            <select className={styles.select} value={selection[side]} onChange={(event) => changeCall(side, event.target.value)}>
              {options.map((id) => <option key={id} value={id}>{optionLabel(id)}</option>)}
            </select>
          </label>
        ))}
        <button type="button" className={styles.swap} style={{ order: 1 }} onClick={swap} aria-label={t("tcSwap")} title={t("tcSwap")}>⇄</button>
      </div>

      <div className={styles.filters} role="search" aria-label={t("tcFilters")}>
        <label className={`fin-tx-search ${styles.topic}`}>
          <span aria-hidden>⌕</span>
          <span className="fin-skel-sr">{t("tcTopic")}</span>
          <input
            value={filter.query}
            maxLength={MAX_COMPARE_QUERY_CHARS}
            onChange={(event) => changeFilter({ query: event.target.value })}
            placeholder={t("tcTopicPlaceholder")}
            aria-label={t("tcTopic")}
          />
          {filter.query && (
            <button type="button" className={styles.clear} onClick={() => changeFilter({ query: "" })} aria-label={t("tcClearTopic")}>×</button>
          )}
        </label>
        <label className={styles.speakerField}>
          <span className="fin-skel-sr">{t("tcSpeaker")}</span>
          <select
            className={styles.select}
            value={filter.speaker ?? ""}
            onChange={(event) => changeFilter({ speaker: event.target.value || null })}
            aria-label={t("tcSpeaker")}
          >
            <option value="">{t("tcAllSpeakers")}</option>
            {!speakerFilterListed && filter.speaker && <option value={filter.speaker}>{filter.speaker}</option>}
            {speakers.map((speaker) => (
              <option key={speaker.name} value={speaker.name}>
                {t(speaker.in_a && speaker.in_b ? "tcSpeakerInBoth" : speaker.in_a ? "tcSpeakerOnlyA" : "tcSpeakerOnlyB", { name: speaker.name })}
              </option>
            ))}
          </select>
        </label>
        <div className="fin-tx-filters" role="group" aria-label={t("tcSection")}>
          {SECTION_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter.section === option.value ? "on" : ""}
              aria-pressed={filter.section === option.value}
              onClick={() => changeFilter({ section: option.value })}
            >
              {t(option.key)}
            </button>
          ))}
        </div>
        <div className="fin-tx-filters" role="group" aria-label={t("tcMode")}>
          <button type="button" className={mode === "side" ? "on" : ""} aria-pressed={mode === "side"} onClick={() => changeMode("side")}>{t("tcModeSide")}</button>
          <button type="button" className={mode === "align" ? "on" : ""} aria-pressed={mode === "align"} onClick={() => changeMode("align")}>{t("tcModeAlign")}</button>
        </div>
      </div>

      {sameCall ? (
        <div className="fin-empty" role="status">
          <div className="fin-empty-title">{t("tcSameCall")}</div>
          <div className="fin-empty-why">{t("tcSameCallWhy")}</div>
        </div>
      ) : archiveUnavailable ? (
        <div className="fin-empty fin-empty-lg fin-tx-error" role="alert" data-compare-state="archive-unavailable">
          <div className="fin-empty-title">{t("tcUnavailable")}</div>
          <div className="fin-empty-why">{t("tcUnavailableWhy")}</div>
          <button type="button" className="fin-tx-retry" onClick={retry}>{t("tcRetry")}</button>
        </div>
      ) : showAlign && alignment ? (
        <div className={styles.align} data-compare-view="align">
          <div className="fin-tx-notice" role="note">
            <span>{t("tcAlignCaveat")}</span>
          </div>
          <div className={styles.alignHeads}>
            {columnHead("a")}
            {columnHead("b")}
          </div>
          <div className={styles.alignSummary} aria-live="polite">
            {alignment.pairs.length ? t("tcPairs", { n: alignment.pairs.length }) : t("tcNoPairs")}
          </div>
          {!alignment.pairs.length && <div className={styles.muted}>{t("tcNoPairsWhy")}</div>}
          <ol className={styles.pairs}>
            {alignment.pairs.map((pair) => (
              <li key={`${pair.a.segment_index}:${pair.b.segment_index}`} className={styles.pair} data-pair-score={pair.score}>
                <div className={styles.pairMeta}>
                  <span>{t("tcPairScore", { n: pair.shared_count, pct: Math.round(pair.score * 100) })}</span>
                  <span className={styles.terms} aria-label={t("tcSharedTerms")}>
                    {pair.shared_terms.map((term) => <span key={term} className={styles.term}>{term}</span>)}
                  </span>
                  {pair.shared_count > pair.shared_terms.length && (
                    <span className={styles.termMore} aria-label={t("tcMoreTerms", { n: pair.shared_count - pair.shared_terms.length })}>
                      +{pair.shared_count - pair.shared_terms.length}
                    </span>
                  )}
                </div>
                <div className={styles.pairCards}>
                  {card(pair.a)}
                  {card(pair.b)}
                </div>
              </li>
            ))}
          </ol>
          {SIDES.map((side) => {
            const unmatched = side === "a" ? alignment.unmatched_a : alignment.unmatched_b;
            if (!unmatched.length) return null;
            return (
              <details key={side} className={styles.unmatched} data-unmatched-side={side}>
                <summary>{t("tcUnmatched", { call: sideName(side), n: unmatched.length })}</summary>
                <div className={styles.unmatchedList}>{unmatched.map(card)}</div>
              </details>
            );
          })}
        </div>
      ) : (
        <>
          <div className={styles.tabs} role="tablist" aria-label={t("tcColumns")}>
            {SIDES.map((side) => (
              <button
                key={side}
                ref={(node) => {
                  tabRefs.current[side] = node;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${side}`}
                aria-selected={activeSide === side}
                aria-controls={`${baseId}-col-${side}`}
                tabIndex={activeSide === side ? 0 : -1}
                className={activeSide === side ? styles.tabOn : styles.tab}
                onClick={() => setActiveSide(side)}
                onKeyDown={onTabKey}
              >
                {sideName(side)}
              </button>
            ))}
          </div>
          <div className={styles.columns} data-compare-view="side">
            {SIDES.map((side) => (
              <section
                key={side}
                id={`${baseId}-col-${side}`}
                className={styles.column}
                data-compare-column={side}
                data-active={activeSide === side ? "true" : "false"}
                aria-label={sideName(side)}
              >
                {columnHead(side)}
                <div className={styles.columnBody}>{sideState(side)}</div>
              </section>
            ))}
          </div>
        </>
      )}

      <footer className={styles.footer}>
        <div className={styles.rights}>
          <b>{t("tcRightsTitle")}</b>
          <span>{t("tcRights")}</span>
        </div>
        <div className={styles.share}>
          <button type="button" className={styles.shareButton} disabled={sameCall} onClick={() => void copy("link", comparisonUrl())}>
            {copied?.id === "link" ? t(copied.ok ? "tcCopied" : "tcCopyFailed") : t("tcCopyLink")}
          </button>
          <button type="button" className={styles.shareButton} disabled={!bothOk} onClick={() => void copyReceipt()}>
            {copied?.id === "receipt" ? t(copied.ok ? "tcCopied" : "tcCopyFailed") : t("tcCopyReceipt")}
          </button>
          <button
            type="button"
            className={styles.shareButton}
            disabled={!bothOk || verifyNow?.status === "running"}
            onClick={() => void reverify()}
          >
            {t("tcVerify")}
          </button>
        </div>
        {!bothOk && !sameCall && !loading && <div className={styles.muted}>{t("tcReceiptUnavailable")}</div>}
        <div className={styles.verify} role="status" aria-live="polite" data-compare-verify={verifyNow?.status ?? ""}>
          {verifyNow?.status === "running" && <span>{t("tcVerifying")}</span>}
          {verifyNow?.status === "verified" && (
            <span className={styles.verified}>
              {t("tcVerified", { n: verifyNow.passages })}
              {mode === "align" && ` ${t("tcVerifiedPairs", { n: verifyNow.pairs })}`}
            </span>
          )}
          {verifyNow?.status === "blocked" && (
            <span>{t(verifyNow.reason === "too_many" ? "tcTooManyPassages" : "tcReceiptUnavailable")}</span>
          )}
          {verifyNow?.status === "failed" && (
            <div className={styles.failed}>
              <b>{t("tcVerifyFailed")}</b>
              <ul>
                {verifyNow.problems.map((problem, index) => (
                  <li key={index}>{problemText(problem, t, sideName)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </footer>
    </section>
  );
}
