"use client";

/**
 * ScreenAssumptionPreview (J6 candidate) — the panel's per-screen "Compare" surface.
 *
 * One saved screen (A) against one unsaved trial copy (B) whose single numeric threshold the
 * user changes here, both evaluated over the rows the panel captured the moment Compare was
 * opened. The capture never refreshes itself: a newer scan (or a same-date republication, or a
 * scan that stopped loading) is DISCLOSED as drift while the comparison keeps its captured
 * rows, and restarting means closing and reopening — always a deliberate act.
 *
 * Local-only by construction: nothing here saves, reviews, deletes, fetches, persists or
 * queues. All EN/ZH copy is component-local (no global lex, no store); the surrounding panel's
 * styles, tokens and its own `t()` vocabulary are reused untouched.
 */

import { useId, useMemo, useState } from "react";
import {
  buildTrialDefinition, checkSupportedGrammar, compareDefinitions, listNumericLeaves,
  MAX_THRESHOLD_ABS, PREVIEW_LIST_CAP,
  type AssumptionCapture, type PreviewBucket, type PreviewRefusal,
} from "@/lib/smartScreen/assumptionPreview";
import type { LeafTrace, ScreenField, ScreenDefinition } from "@/lib/smartScreen/predicate";
import styles from "./SmartScreensPanel.module.css";

export type PreviewLang = "en" | "zh";

/** Component-local EN/ZH tuples for this surface only. Keys are preview-local words, not the
 *  panel's `ss*` namespace, so nothing here can collide with or alter the shared lexicon. */
const PREVIEW_LEX = {
  open: ["Compare thresholds", "对比阈值"],
  close: ["Close compare", "关闭对比"],
  title: ["Threshold check — A (saved) vs B (trial)", "阈值检查——A（已保存）对比 B（试用）"],
  notHistory: [
    "One captured scan, two recipes. A-only/B-only are threshold differences, not entries or exits in time.",
    "同一次捕获扫描、两套条件。仅A/仅B 表示阈值差异，不是时间上的进出。",
  ],
  source: ["Captured {n} rows at {asOf} — both recipes classify exactly these rows.", "已在 {asOf} 捕获 {n} 行——两套条件只对这些行分类。"],
  driftNotReady: [
    "The scan is no longer loaded. This comparison still uses the {asOf} capture; close and reopen Compare to start over.",
    "扫描已不在加载中。此对比仍使用 {asOf} 的捕获；如需重来，请关闭并重新打开对比。",
  ],
  driftGeneration: [
    "The table now shows {live} data. This comparison keeps its {asOf} capture — close and reopen Compare to use the newer scan.",
    "表格当前为 {live} 数据。此对比保留 {asOf} 的捕获——如需使用新扫描，请关闭并重新打开对比。",
  ],
  driftRepublished: [
    "The scan was republished under the same data date. This comparison keeps its original capture — close and reopen Compare to re-capture.",
    "扫描在同一数据日期下重新发布。此对比保留原始捕获——如需重新捕获，请关闭并重新打开对比。",
  ],
  leafLabel: ["Change one threshold", "修改一个阈值"],
  opGte: ["at least", "不低于"],
  opLte: ["at most", "不高于"],
  thresholdLabel: ["New threshold", "新阈值"],
  apply: ["Compare with this threshold", "按此阈值对比"],
  defA: ["A (saved)", "A（已保存）"],
  defB: ["B (trial)", "B（试用）"],
  changed: ["Changed condition", "修改的条件"],
  summary: ["Both {both} · A-only {aOnly} · B-only {bOnly}", "两者匹配 {both} · 仅A {aOnly} · 仅B {bOnly}"],
  both: ["Matched by both", "两者都匹配"],
  aOnly: ["A matches; B fails", "A匹配；B不成立"],
  bOnly: ["B matches; A fails", "B匹配；A不成立"],
  coverage: ["Also in the capture (never entries or exits)", "捕获中的其余标的（不属于进出）"],
  unknown: ["Unknown — data missing, not evaluated as false", "未知——数据缺失，不按不成立处理"],
  failed: ["Failed both recipes", "两套条件都不匹配"],
  unpriced: ["Unpriced in the capture", "捕获时无价格"],
  outOfScope: ["Outside this screen's scope", "在此筛选范围之外"],
  more: ["+{n} more", "另有 {n} 个"],
  none: ["None.", "无。"],
  closeLabel: ["Close the threshold comparison", "关闭阈值对比"],
  refuseGrammar: [
    "This screen was written in a newer format — this version cannot preview its thresholds.",
    "此筛选由较新格式保存——当前版本无法预览其阈值。",
  ],
  refuseNoNumeric: [
    "This screen has no numeric threshold to change, so there is nothing to compare.",
    "此筛选没有可修改的数值阈值，无法对比。",
  ],
  refuseBadThreshold: [
    "Enter a finite number within ±{limit}.",
    "请输入 ±{limit} 以内的有限数值。",
  ],
  refuseOther: [
    "This threshold cannot be applied to this screen.",
    "无法将此阈值应用于此筛选。",
  ],
} as const;

export type PreviewLexKey = keyof typeof PREVIEW_LEX;

/** Copy accessor the panel uses for the mount button — the only preview text outside this
 *  component, so the panel needs no new global lex entry. */
export const previewLabel = (lang: PreviewLang, key: PreviewLexKey): string =>
  PREVIEW_LEX[key][lang === "zh" ? 1 : 0];

type DescribeLeaf = (leaf: { f: ScreenField; op: LeafTrace["op"]; v?: LeafTrace["v"] }) => string;

type Props = {
  capture: AssumptionCapture;
  /** True when the panel's live scan has changed (newer generation, republication, or unload)
   *  since the capture. A disclosure only — never a re-capture. */
  drifted: boolean;
  /** The live generation, for drift wording. */
  liveAsOf: string;
  liveReady: boolean;
  lang: PreviewLang;
  describeLeaf: DescribeLeaf;
  describeDefinition: (def: ScreenDefinition) => string;
  onClose: () => void;
};

const OVERLAP_BUCKETS: PreviewBucket[] = ["both", "aOnly", "bOnly"];
const COVERAGE_BUCKETS: PreviewBucket[] = ["unknown", "failed", "unpriced", "outOfScope"];

export default function ScreenAssumptionPreview(props: Props) {
  const { capture, drifted, liveAsOf, liveReady, lang, describeLeaf, describeDefinition, onClose } = props;
  const t = (key: PreviewLexKey, values?: Record<string, string | number>): string => {
    const text = PREVIEW_LEX[key][lang === "zh" ? 1 : 0];
    if (!values) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
  };

  const leaves = useMemo(() => listNumericLeaves(capture.def), [capture.def]);
  const grammarRefusal = useMemo(() => checkSupportedGrammar(capture.def), [capture.def]);

  const [pathKey, setPathKey] = useState(leaves[0]?.path.key ?? "");
  const leafId = useId();
  const [threshold, setThreshold] = useState(leaves[0] ? String(leaves[0].leaf.v) : "");
  const [refusal, setRefusal] = useState<PreviewRefusal | null>(null);
  const [trial, setTrial] = useState<{ def: ScreenDefinition; aLeafText: string; bLeafText: string } | null>(null);

  const selected = leaves.find((ref) => ref.path.key === pathKey) ?? leaves[0] ?? null;

  const comparison = useMemo(
    () => (trial ? compareDefinitions(capture.def, trial.def, capture.rows) : null),
    [capture, trial],
  );

  const apply = () => {
    const text = threshold.trim();
    // Blank input must not become Number("") === 0. Accept explicit decimal/scientific
    // notation only; the owner normalizer still checks the numeric range of the trial.
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
      setTrial(null); setRefusal("bad_threshold"); return;
    }
    const value = Number(text);
    const op = selected?.leaf.op ?? "gte";
    const built = buildTrialDefinition(capture.def, selected?.path ?? { key: "", steps: [] }, op, value);
    if (!built.ok) {
      setTrial(null);
      setRefusal(built.reason);
      return;
    }
    setRefusal(null);
    setTrial({
      def: built.def,
      aLeafText: describeLeaf({ f: selected!.leaf.f, op: selected!.leaf.op, v: selected!.leaf.v }),
      bLeafText: describeLeaf({ f: selected!.leaf.f, op, v: value === 0 ? 0 : value }),
    });
  };

  const refusalText = (reason: PreviewRefusal): string => {
    if (reason === "grammar_newer" || reason === "grammar_invalid") return t("refuseGrammar");
    if (reason === "no_numeric_leaf") return t("refuseNoNumeric");
    if (reason === "bad_threshold") return t("refuseBadThreshold", { limit: MAX_THRESHOLD_ABS.toLocaleString("en-US") });
    return t("refuseOther");
  };

  const driftText = (): string => {
    if (!liveReady) return t("driftNotReady", { asOf: capture.asOf });
    if (liveAsOf !== capture.asOf) return t("driftGeneration", { live: liveAsOf, asOf: capture.asOf });
    return t("driftRepublished");
  };

  // Which kind of drift — the visible sentence is free text, the variant is a hook attribute.
  const driftKind = (): string => {
    if (!liveReady) return "not-ready";
    return liveAsOf !== capture.asOf ? "newer-generation" : "same-as-of-republish";
  };

  const symList = (bucket: PreviewBucket, attrs: Record<string, string>) => {
    const shown = comparison!.lists[bucket];
    return (
      <div key={bucket} className={styles.group} {...attrs}>
        <h4 className={styles.h4}>{t(bucket)} ({comparison!.counts[bucket]})</h4>
        {shown.length === 0 ? (
          <p className={styles.line}>{t("none")}</p>
        ) : (
          <ul className={styles.list}>
            {shown.map((sym) => <li key={sym} className={styles.change} data-ss-assumption-sym={sym}><b>{sym}</b></li>)}
          </ul>
        )}
        {comparison!.hidden[bucket] > 0 && <p className={styles.meta}>{t("more", { n: comparison!.hidden[bucket] })}</p>}
      </div>
    );
  };

  return (
    <div className={styles.diff} data-ss-assumption="open" data-ss-assumption-as-of={capture.asOf} data-ss-assumption-screen={capture.screenId}>
      <p className={styles.diffHead}>
        {t("title", { name: capture.name })}
        <button type="button" className={`chip ${styles.btn}`} onClick={onClose} aria-label={t("closeLabel")} data-ss-assumption-close>
          {t("close")}
        </button>
      </p>
      <p className={styles.line} data-ss-assumption-source>{t("source", { n: capture.rows.length, asOf: capture.asOf })}</p>
      {drifted && <p className={`${styles.line} ${styles.warnText}`} data-ss-assumption-drift={driftKind()}>{driftText()}</p>}
      <p className={styles.meta}>{t("notHistory")}</p>

      {grammarRefusal && <p className={styles.line} data-ss-assumption-refusal={grammarRefusal}>{refusalText(grammarRefusal)}</p>}
      {!grammarRefusal && leaves.length === 0 && (
        <p className={styles.line} data-ss-assumption-refusal="no_numeric_leaf">{refusalText("no_numeric_leaf")}</p>
      )}

      {!grammarRefusal && leaves.length > 0 && (
        <>
          <div className={styles.saveRow}>
            <label className={styles.meta} htmlFor={leafId}>{t("leafLabel")}</label>
            <select
              id={leafId}
              className={`${styles.input} ${styles.assumptionSelect}`}
              value={selected?.path.key ?? ""}
              onChange={(e) => {
                setPathKey(e.target.value);
                const next = leaves.find((ref) => ref.path.key === e.target.value);
                if (next) { setThreshold(String(next.leaf.v)); setTrial(null); setRefusal(null); }
              }}
              data-ss-assumption-leaf
            >
              {leaves.map((ref) => <option key={ref.path.key} value={ref.path.key}>{describeLeaf(ref.leaf)}</option>)}
            </select>
            <span className={styles.meta} data-ss-assumption-op>
              {selected?.leaf.op === "lte" ? `≤ ${t("opLte")}` : `≥ ${t("opGte")}`}
            </span>
            <input
              className={`${styles.input} ${styles.inputSm}`}
              value={threshold}
              inputMode="decimal"
              aria-label={t("thresholdLabel")}
              onChange={(e) => setThreshold(e.target.value)}
              data-ss-assumption-threshold
            />
            <button type="button" className={`chip ${styles.btn}`} onClick={apply} data-ss-assumption-apply>
              {t("apply")}
            </button>
          </div>
          {refusal && <p className={`${styles.line} ${styles.warnText}`} data-ss-assumption-refusal={refusal}>{refusalText(refusal)}</p>}

          {trial && comparison && (
            <>
              <p className={styles.line} data-ss-assumption-def-a>{t("defA")}: {describeDefinition(capture.def)}</p>
              <p className={styles.line} data-ss-assumption-def-b>{t("defB")}: {describeDefinition(trial.def)}</p>
              <p className={styles.line} data-ss-assumption-changed>{t("changed")}: {trial.aLeafText} → {trial.bLeafText}</p>
              <p className={styles.line} data-ss-assumption-summary>
                {t("summary", {
                  both: comparison.counts.both,
                  aOnly: comparison.counts.aOnly,
                  bOnly: comparison.counts.bOnly,
                })}
              </p>
              {OVERLAP_BUCKETS.map((bucket) => symList(bucket, { "data-ss-assumption-group": bucket }))}
              <div className={styles.group} data-ss-assumption-coverage>
                <h4 className={styles.h4}>{t("coverage")}</h4>
                {COVERAGE_BUCKETS.map((bucket) => (
                  <p key={bucket} className={styles.line} data-ss-assumption-coverage-bucket={bucket}>
                    {t(bucket)}: {comparison.counts[bucket]}
                    {comparison.lists[bucket].length > 0 && (
                      <> — {comparison.lists[bucket].slice(0, PREVIEW_LIST_CAP).join(", ")}
                        {comparison.hidden[bucket] > 0 && ` ${t("more", { n: comparison.hidden[bucket] })}`}
                      </>
                    )}
                  </p>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
