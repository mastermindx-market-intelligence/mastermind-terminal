"use client";

/*
 * IntlInvestigationPanel — IM09-T2 presentational selected detail (PATCH_ONLY).
 *
 * Pure React 19 presentational child: props in → JSX out. Zero hooks, state,
 * effects, network, storage, auth, database, persistence or retry logic.
 * The parent workspace owns selection, auth, revision URLs and every callback;
 * this component never mounts itself and never writes.
 *
 * Bilingual (en|zh) fixed UI copy lives here; all data strings (question,
 * labels, notes, clock labels, unmet requirement labels) arrive from the
 * parent already localized and are rendered verbatim, React-escaped only —
 * no dangerouslySetInnerHTML anywhere.
 *
 * Contract repair r2 (im08-im09-contract-repair-r2): comparison failures keep
 * their exact visible status (denied / invalid / scope_changed join the status
 * set — a failure never silently becomes "unchecked" or "no changes");
 * read-ok-but-unqualified and not-applicable rows keep availability states
 * distinct from "unknown"; and the optional `evidenceChanges` rows render ONE
 * row per stable measure id with every concurrent kernel dimension (membership,
 * version, qualification, correction, exclusion, comparable prior/current/delta
 * with unit, or the exact non-comparable reason). The legacy per-dimension
 * `changedItems` list still renders when `evidenceChanges` is absent. Existing
 * sections, CSS classes and token geometry only — no new stylesheet system.
 *
 * Dark-only Terminal shell: IntlInvestigationPanel.module.css consumes
 * existing global tokens only (GLOBAL_TOKEN_EXCERPT.css). Health semantics
 * never ride the locale-flipping --up/--down family.
 */

import s from "./IntlInvestigationPanel.module.css";

export type IntlLang = "en" | "zh";

export type IntlMeasureAvailability =
  | "qualified"
  | "stale"
  | "excluded"
  | "denied"
  | "unavailable"
  | "not_qualified"
  | "not_applicable"
  | "unknown";

export interface IntlSelectedMeasure {
  stableId: string;
  label: string;
  availability: IntlMeasureAvailability;
  value: number | null;
  unit: string | null;
  /** Parent-supplied safe explanatory text; rendered as React-escaped text. */
  note: string;
  observedAt: string | null;
}

export type IntlChangedKind =
  | "revised"
  | "qualification_changed"
  | "added"
  | "removed";

export interface IntlChangedItem {
  id: string;
  label: string;
  kind: IntlChangedKind;
  /** Parent-supplied safe explanatory text; rendered as React-escaped text. */
  note: string;
}

/* ── lossless evidence-change rows (contract repair r2) ────────────────────
 * One row per stable measure id carrying every kernel comparison dimension
 * concurrently, so a revision is never confused with a numeric change or a
 * qualification change, and limitation states keep their exact reasons. */

/** Exact kernel membership verdict. `not_observed`/`not_previously_observed` are
 * partial-membership limitations and are never relabelled added/removed. */
export type IntlEvidenceMembership =
  | "present"
  | "added"
  | "removed"
  | "not_observed"
  | "not_previously_observed";

export type IntlEvidenceVersion = "initial" | "unchanged" | "revised" | "unknown";
export type IntlEvidenceQualification = "unchanged" | "changed" | "unknown";

/** Exact kernel reason a numeric comparison was not possible. */
export type IntlNonComparableReason =
  | "unavailable"
  | "not_applicable"
  | "missing"
  | "incompatible";

/** Comparable numeric dimension with the row's legitimate unit. */
export interface IntlEvidenceNumeric {
  prior: number;
  current: number;
  delta: number;
  unit: string;
}

/** Current-row availability as the kernel sees it (includes "available"). */
export type IntlEvidenceRowAvailability =
  | "available"
  | "stale"
  | "denied"
  | "unavailable"
  | "not_applicable";

export interface IntlEvidenceChange {
  stableId: string;
  label: string;
  membership: IntlEvidenceMembership;
  version: IntlEvidenceVersion;
  qualification: IntlEvidenceQualification;
  availability: IntlEvidenceRowAvailability;
  correction: boolean;
  excluded: boolean;
  /** Exact comparable prior/current/delta with unit; null when not comparable. */
  numeric: IntlEvidenceNumeric | null;
  /** Exact kernel reason the numeric comparison was not possible; null when
   * comparable (or when membership already implies no comparison exists). */
  nonComparableReason: IntlNonComparableReason | null;
}

export type IntlComparisonStatus =
  | "changed"
  | "unchanged"
  | "incomplete"
  | "unavailable"
  | "denied"
  | "invalid"
  | "scope_changed"
  | "unchecked";

export type IntlReadinessState = "incomplete" | "ready";

export interface IntlReadiness {
  state: IntlReadinessState;
  /** Unmet requirement labels (parent-localized), shown verbatim when incomplete. */
  unmet: string[];
}

export interface IntlInvestigationPanelProps {
  lang: IntlLang;
  /** Exact saved question; whitespace preserved via pre-wrap, React-escaped. */
  question: string;
  marketLabel: string;
  toolLabel: string;
  periodLabel: string;
  basisLabel: string;
  selectedMeasures: IntlSelectedMeasure[];
  /** Legacy per-dimension change list (compatibility). Rendered only when
   * `evidenceChanges` is absent; superseded by the lossless rows below. */
  changedItems: IntlChangedItem[];
  /** Lossless comparison rows: exactly one per stable measure id, carrying all
   * concurrent kernel dimensions. When present (array), this is the rendered
   * path — never alongside the legacy per-dimension list. */
  evidenceChanges?: readonly IntlEvidenceChange[];
  comparisonStatus: IntlComparisonStatus;
  /** Clocks are exact parent-supplied display strings; null = explicit unavailable. */
  savedAt: string | null;
  updatedAt: string | null;
  sourceGenerationAt: string | null;
  rightsAt: string | null;
  readiness: IntlReadiness;
  onInspect?: (measureId: string) => void;
  onContinue?: () => void;
  onEdit?: () => void;
}

/* ── fixed bilingual UI copy (data strings come from props) ─────────────── */

interface Dict {
  eyebrow: string;
  savedContext: string;
  selectedChip: (n: number) => string;
  qualifiedChip: (n: number) => string;
  savedNotConclusion: string;
  evidenceUpdated: string;
  unavailable: string;
  comparedHeading: string;
  changeCount: (n: number) => string;
  statusIncomplete: string;
  statusUnchanged: string;
  statusUnavailable: string;
  statusDenied: string;
  statusInvalid: string;
  statusScopeChanged: string;
  statusUnchecked: string;
  limitationIncomplete: string;
  noteUnavailable: string;
  noteDenied: string;
  noteInvalid: string;
  noteScopeChanged: string;
  noteUnchecked: string;
  noteUnchanged: string;
  readEyebrow: string;
  readScope: string;
  readState: Record<IntlReadinessState, string>;
  headline: Record<IntlReadinessState, string>;
  bodyReady: string;
  stillNeeded: string;
  coverageNotConfidence: string;
  measuresHeading: string;
  measuresCaption: string;
  noMeasures: string;
  inspect: string;
  availability: Record<IntlMeasureAvailability, string>;
  kind: Record<IntlChangedKind, string>;
  /** Fixed vocabulary for the lossless evidence-change rows. Contains no data
   * strings: numbers arrive only through `evidence.numeric` as formatted values
   * of comparable qualified rows. */
  evidence: {
    membership: Record<Exclude<IntlEvidenceMembership, "present">, string>;
    version: Record<IntlEvidenceVersion, string>;
    qualification: Record<IntlEvidenceQualification, string>;
    valueChanged: string;
    correction: string;
    numeric: (prior: string, current: string, delta: string) => string;
    nonComparable: Record<IntlNonComparableReason, string>;
    noteNotObserved: string;
    noteNotPreviouslyObserved: string;
  };
  observedAt: (v: string) => string;
  healthHeading: string;
  healthState: Record<"all" | "partial" | "none" | "empty", string>;
  healthOf: (n: number) => string;
  clocksHeading: string;
  clockSaved: string;
  clockUpdated: string;
  clockSourceGen: string;
  clockRights: string;
  clocksFootnote: string;
  continueLabel: string;
  editLabel: string;
  reopenTitle: string;
  reopenBody: string;
}

const EN: Dict = {
  eyebrow: "Saved question",
  savedContext: "Saved context",
  selectedChip: (n) => `${n} selected`,
  qualifiedChip: (n) => `${n} qualified`,
  savedNotConclusion: "The question was saved. The conclusion was not.",
  evidenceUpdated: "Evidence updated",
  unavailable: "Unavailable",
  comparedHeading: "Compared with saved evidence",
  changeCount: (n) => `${n} material evidence change${n === 1 ? "" : "s"}`,
  statusIncomplete: "Comparison incomplete",
  statusUnchanged: "No material changes",
  statusUnavailable: "Comparison unavailable",
  statusDenied: "Comparison denied",
  statusInvalid: "Comparison invalid",
  statusScopeChanged: "Comparison scope changed",
  statusUnchecked: "Not yet compared",
  limitationIncomplete:
    "These changes do not cover the full saved baseline — the comparison is still incomplete.",
  noteUnavailable:
    "No baseline comparison is available right now. This is not a zero-change result and must not be read as one.",
  noteDenied:
    "The evidence read was denied, so no baseline comparison could be made. This is not a zero-change result and must not be read as one.",
  noteInvalid:
    "The comparison inputs were invalid, so nothing was compared. This is not a zero-change result and must not be read as one.",
  noteScopeChanged:
    "The current evidence was read under a different scope than the saved baseline, so the two cannot be compared. This is not a zero-change result and must not be read as one.",
  noteUnchecked: "Current evidence has not yet been compared with the saved baseline.",
  noteUnchanged: "No material evidence changes against the saved baseline.",
  readEyebrow: "Current research read",
  readScope: "Based on qualified evidence only",
  readState: { incomplete: "Incomplete", ready: "Ready" },
  headline: {
    incomplete: "The comparison remains open.",
    ready: "Declared evidence requirements are satisfied.",
  },
  bodyReady:
    "The evidence requirements declared for this saved question are satisfied. Coverage is not investment confidence.",
  stillNeeded: "Still needed:",
  coverageNotConfidence: "Evidence health is coverage — not a confidence score or risk label.",
  measuresHeading: "Selected measures",
  measuresCaption: "Value · observation · qualification",
  noMeasures: "No measures selected.",
  inspect: "Inspect",
  availability: {
    qualified: "Qualified",
    stale: "Stale",
    excluded: "Excluded",
    denied: "Denied",
    unavailable: "Unavailable",
    not_qualified: "Not qualified",
    not_applicable: "Not applicable",
    unknown: "Unknown",
  },
  kind: {
    revised: "Revised",
    qualification_changed: "Qualification changed",
    added: "Added",
    removed: "Removed",
  },
  evidence: {
    membership: {
      added: "Added",
      removed: "Removed",
      not_observed: "Not observed now",
      not_previously_observed: "Not previously observed",
    },
    version: {
      initial: "Initial",
      revised: "Revised",
      unchanged: "Content unchanged",
      unknown: "Version unknown",
    },
    qualification: {
      changed: "Qualification changed",
      unchanged: "Qualification unchanged",
      unknown: "Qualification unknown",
    },
    valueChanged: "Value changed",
    correction: "Correction",
    numeric: (prior, current, delta) => `${prior} → ${current} (Δ ${delta})`,
    nonComparable: {
      unavailable: "Numeric comparison unavailable",
      not_applicable: "Numeric comparison not applicable",
      missing: "Numeric comparison missing usable values",
      incompatible: "Numeric comparison incompatible — unit, basis or cohort differ",
    },
    noteNotObserved: "Not observed in the current evidence read — this is not a removal.",
    noteNotPreviouslyObserved:
      "Not observed in the saved evidence read — prior coverage was incomplete, so this is not proof of absence and not an addition.",
  },
  observedAt: (v) => `Observed ${v}`,
  healthHeading: "Evidence health",
  healthState: {
    all: "All qualified",
    partial: "Partial",
    none: "None qualified",
    empty: "No measures",
  },
  healthOf: (n) => `of ${n} selected measures\ncurrently qualify`,
  clocksHeading: "Evidence clocks",
  clockSaved: "Saved (baseline)",
  clockUpdated: "Evidence updated (refresh)",
  clockSourceGen: "Source generation",
  clockRights: "Rights check",
  clocksFootnote:
    "Saved time is the baseline clock; updated time is the latest evidence refresh. They are independent.",
  continueLabel: "Continue the research",
  editLabel: "Edit saved question",
  reopenTitle: "What reopening does",
  reopenBody:
    "It refreshes evidence for this saved question. It does not create an alert, monitor, task, trade, or live investment signal.",
};

const ZH: Dict = {
  eyebrow: "已保存问题",
  savedContext: "已保存背景",
  selectedChip: (n) => `已选 ${n} 项`,
  qualifiedChip: (n) => `${n} 项合格`,
  savedNotConclusion: "问题已保存；结论未保存。",
  evidenceUpdated: "证据已更新",
  unavailable: "不可用",
  comparedHeading: "与已保存证据对比",
  changeCount: (n) => `${n} 项实质证据变化`,
  statusIncomplete: "对比不完整",
  statusUnchanged: "无实质变化",
  statusUnavailable: "对比不可用",
  statusDenied: "对比被拒绝",
  statusInvalid: "对比无效",
  statusScopeChanged: "对比范围已变化",
  statusUnchecked: "尚未对比",
  limitationIncomplete: "以上变化并未覆盖完整的已保存基线——对比仍不完整。",
  noteUnavailable: "当前没有可用的基线对比。这不是零变化结果，也不应被当作零变化解读。",
  noteDenied: "证据读取被拒绝，因此无法进行基线对比。这不是零变化结果，也不应被当作零变化解读。",
  noteInvalid: "对比输入无效，因此未进行任何对比。这不是零变化结果，也不应被当作零变化解读。",
  noteScopeChanged: "当前证据的读取范围与已保存基线不同，因此无法对比。这不是零变化结果，也不应被当作零变化解读。",
  noteUnchecked: "当前证据尚未与已保存基线进行对比。",
  noteUnchanged: "与已保存基线相比，无实质性证据变化。",
  readEyebrow: "当前研究判读",
  readScope: "仅基于合格证据",
  readState: { incomplete: "不完整", ready: "就绪" },
  headline: {
    incomplete: "对比仍待完成。",
    ready: "已声明的证据要求均已满足。",
  },
  bodyReady: "该已保存问题声明的证据要求已满足。覆盖情况不等于投资信心。",
  stillNeeded: "仍需满足：",
  coverageNotConfidence: "证据健康度描述覆盖情况——不是信心评分，也不是风险标签。",
  measuresHeading: "所选指标",
  measuresCaption: "数值 · 观察 · 资格",
  noMeasures: "未选择任何指标。",
  inspect: "查看",
  availability: {
    qualified: "合格",
    stale: "过期",
    excluded: "已排除",
    denied: "无权限",
    unavailable: "不可用",
    not_qualified: "不合格",
    not_applicable: "不适用",
    unknown: "未知",
  },
  kind: {
    revised: "已修订",
    qualification_changed: "资格变化",
    added: "新增",
    removed: "已移除",
  },
  evidence: {
    membership: {
      added: "新增",
      removed: "已移除",
      not_observed: "当前未观察",
      not_previously_observed: "此前未观察到",
    },
    version: {
      initial: "初始",
      revised: "已修订",
      unchanged: "内容未变化",
      unknown: "版本未知",
    },
    qualification: {
      changed: "资格变化",
      unchanged: "资格未变化",
      unknown: "资格未知",
    },
    valueChanged: "数值变化",
    correction: "更正",
    numeric: (prior, current, delta) => `${prior} → ${current}（Δ ${delta}）`,
    nonComparable: {
      unavailable: "数值对比不可用",
      not_applicable: "数值对比不适用",
      missing: "数值对比缺少可用数值",
      incompatible: "数值对比不兼容——单位、基准或队列不同",
    },
    noteNotObserved: "本次证据读取中未观察到该指标——这不表示移除。",
    noteNotPreviouslyObserved: "已保存的证据读取中未观察到该指标——此前覆盖不完整，这既不证明不存在，也不表示新增。",
  },
  observedAt: (v) => `观察于 ${v}`,
  healthHeading: "证据健康度",
  healthState: {
    all: "全部合格",
    partial: "部分合格",
    none: "暂无合格",
    empty: "无指标",
  },
  healthOf: (n) => `所选 ${n} 项指标\n当前合格`,
  clocksHeading: "证据时钟",
  clockSaved: "保存（基线）",
  clockUpdated: "证据更新（刷新）",
  clockSourceGen: "数据源生成",
  clockRights: "权限核查",
  clocksFootnote: "保存时间是基线时钟；更新时间是最近一次证据刷新，二者相互独立。",
  continueLabel: "继续该研究",
  editLabel: "编辑已保存问题",
  reopenTitle: "重新打开会做什么",
  reopenBody:
    "它会刷新该已保存问题的证据；不会创建提醒、监控、任务、交易或实时投资信号。",
};

/* ── semantic accent maps (module class names; health colors only) ──────── */

const AVAIL_COLOR: Record<IntlMeasureAvailability, string> = {
  qualified: "cOk",
  stale: "cStale",
  excluded: "cExcluded",
  denied: "cDenied",
  unavailable: "cMuted",
  not_qualified: "cMuted",
  not_applicable: "cMuted",
  unknown: "cMuted",
};

const AVAIL_DOT: Record<IntlMeasureAvailability, string> = {
  qualified: "dOk",
  stale: "dStale",
  excluded: "dExcluded",
  denied: "dDenied",
  unavailable: "dMuted",
  not_qualified: "dMuted",
  not_applicable: "dMuted",
  unknown: "dMuted",
};

const KIND_TEXT: Record<IntlChangedKind, string> = {
  revised: "cOk",
  qualification_changed: "cWarn",
  added: "cSignal",
  removed: "cMuted",
};

const KIND_BORDER: Record<IntlChangedKind, string> = {
  revised: "bOk",
  qualification_changed: "bWarn",
  added: "bSignal",
  removed: "bMuted",
};

const HEALTH_STATE_COLOR: Record<"all" | "partial" | "none" | "empty", string> = {
  all: "cOk",
  partial: "cWarn",
  none: "cMuted",
  empty: "cMuted",
};

/* ── evidence-row accents (module class names; existing utilities only) ──── */

const EVIDENCE_MEMBER_COLOR: Record<Exclude<IntlEvidenceMembership, "present">, string> = {
  added: "cSignal",
  removed: "cMuted",
  not_observed: "cWarn",
  not_previously_observed: "cWarn",
};

const EVIDENCE_VERSION_COLOR: Record<IntlEvidenceVersion, string> = {
  initial: "cSignal",
  revised: "cOk",
  unchanged: "cMuted",
  unknown: "cWarn",
};

const EVIDENCE_QUAL_COLOR: Record<IntlEvidenceQualification, string> = {
  changed: "cWarn",
  unchanged: "cMuted",
  unknown: "cWarn",
};

/** Left-border accent follows the most significant dimension: removal is muted,
 * addition is signal, revision/value change is ok, everything else (qualification
 * change or a limitation-only row) is a warning. */
function evidenceBorder(c: IntlEvidenceChange): string {
  if (c.membership === "removed") return "bMuted";
  if (c.membership === "added") return "bSignal";
  if (c.version === "revised") return "bOk";
  if (c.numeric !== null && c.numeric.delta !== 0) return "bOk";
  return "bWarn";
}

/** A row is material when any dimension changed; rows carried only for their
 * limitation (not observed, unknowns, non-comparable) are not material. */
function isMaterialEvidenceRow(c: IntlEvidenceChange): boolean {
  return (
    c.membership === "added" ||
    c.membership === "removed" ||
    c.version === "revised" ||
    c.qualification === "changed" ||
    (c.numeric !== null && c.numeric.delta !== 0)
  );
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/**
 * A numeric value is shown only when availability is "qualified", the value is
 * a finite number, and a unit is present. Everything else — including "denied"
 * values and their observation details — must be absent, never a stale
 * fallback or a zero reading.
 */
function visibleValue(m: IntlSelectedMeasure): { value: number; unit: string } | null {
  if (m.availability !== "qualified") return null;
  if (typeof m.value !== "number" || !Number.isFinite(m.value)) return null;
  if (typeof m.unit !== "string" || m.unit.trim() === "") return null;
  return { value: m.value, unit: m.unit };
}

/** Value + unit joined without invented formatting; "%" / "‰" attach directly. */
function formatMeasureValue(value: number, unit: string): string {
  const u = unit.trim();
  return /^[%‰]/.test(u) ? `${value}${u}` : `${value} ${u}`;
}

/** Exact kernel delta with an explicit "+" for positive movement; no rounding. */
function formatDelta(delta: number, unit: string): string {
  return `${delta > 0 ? "+" : ""}${formatMeasureValue(delta, unit)}`;
}

/* ── component ──────────────────────────────────────────────────────────── */

export function IntlInvestigationPanel(props: IntlInvestigationPanelProps) {
  const {
    lang,
    question,
    marketLabel,
    toolLabel,
    periodLabel,
    basisLabel,
    selectedMeasures,
    changedItems,
    evidenceChanges,
    comparisonStatus,
    savedAt,
    updatedAt,
    sourceGenerationAt,
    rightsAt,
    readiness,
    onInspect,
    onContinue,
    onEdit,
  } = props;

  const t = lang === "zh" ? ZH : EN;

  const selectedCount = selectedMeasures.length;
  const qualifiedCount = selectedMeasures.filter((m) => m.availability === "qualified").length;
  const healthState: "all" | "partial" | "none" | "empty" =
    selectedCount === 0
      ? "empty"
      : qualifiedCount === 0
        ? "none"
        : qualifiedCount === selectedCount
          ? "all"
          : "partial";

  /* Lossless path: when evidence rows are supplied they are authoritative for the
     comparison section and its counts; the legacy per-dimension list is not
     rendered alongside them (no duplicate per-dimension item counts). */
  const hasEvidenceRows = Array.isArray(evidenceChanges);
  const materialChangeCount = hasEvidenceRows
    ? evidenceChanges!.filter(isMaterialEvidenceRow).length
    : changedItems.length;

  const statusMeta =
    comparisonStatus === "changed"
      ? t.changeCount(materialChangeCount)
      : comparisonStatus === "incomplete"
        ? t.statusIncomplete
        : comparisonStatus === "unchanged"
          ? t.statusUnchanged
          : comparisonStatus === "unavailable"
            ? t.statusUnavailable
            : comparisonStatus === "denied"
              ? t.statusDenied
              : comparisonStatus === "invalid"
                ? t.statusInvalid
                : comparisonStatus === "scope_changed"
                  ? t.statusScopeChanged
                  : t.statusUnchecked;

  /** One row per stable measure id: every concurrent kernel dimension renders as
      its own badge, and the exact numeric or limitation reason as note lines. */
  const evidenceList =
    hasEvidenceRows && evidenceChanges!.length > 0 ? (
      <ul className={s.changeList}>
        {evidenceChanges!.map((c: IntlEvidenceChange) => {
          const numericLine =
            c.numeric !== null
              ? t.evidence.numeric(
                  formatMeasureValue(c.numeric.prior, c.numeric.unit),
                  formatMeasureValue(c.numeric.current, c.numeric.unit),
                  formatDelta(c.numeric.delta, c.numeric.unit),
                )
              : c.membership === "present" && c.nonComparableReason !== null
                ? t.evidence.nonComparable[c.nonComparableReason]
                : null;
          return (
            <li key={c.stableId} className={`${s.changeItem} ${s[evidenceBorder(c)]}`}>
              <div className={s.changeHead}>
                <span className={s.changeLabel}>{c.label}</span>
                <span className={s.chips}>
                  {c.membership !== "present" ? (
                    <span
                      className={`${s.changeKind} ${s[EVIDENCE_MEMBER_COLOR[c.membership]]}`}
                    >
                      {t.evidence.membership[c.membership]}
                    </span>
                  ) : null}
                  <span className={`${s.changeKind} ${s[EVIDENCE_VERSION_COLOR[c.version]]}`}>
                    {t.evidence.version[c.version]}
                  </span>
                  <span
                    className={`${s.changeKind} ${s[EVIDENCE_QUAL_COLOR[c.qualification]]}`}
                  >
                    {t.evidence.qualification[c.qualification]}
                  </span>
                  {c.numeric !== null && c.numeric.delta !== 0 ? (
                    <span className={`${s.changeKind} ${s.cOk}`}>{t.evidence.valueChanged}</span>
                  ) : null}
                  {c.correction ? (
                    <span className={`${s.changeKind} ${s.cWarn}`}>{t.evidence.correction}</span>
                  ) : null}
                  {c.excluded ? (
                    <span className={`${s.changeKind} ${s.cWarn}`}>{t.availability.excluded}</span>
                  ) : null}
                </span>
              </div>
              {numericLine !== null ? <p className={s.changeNote}>{numericLine}</p> : null}
              {c.membership === "not_observed" ? (
                <p className={s.changeNote}>{t.evidence.noteNotObserved}</p>
              ) : null}
              {c.membership === "not_previously_observed" ? (
                <p className={s.changeNote}>{t.evidence.noteNotPreviouslyObserved}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    ) : null;

  const changeList =
    changedItems.length > 0 ? (
      <ul className={s.changeList}>
        {changedItems.map((c) => (
          <li key={c.id} className={`${s.changeItem} ${s[KIND_BORDER[c.kind]]}`}>
            <div className={s.changeHead}>
              <span className={s.changeLabel}>{c.label}</span>
              <span className={`${s.changeKind} ${s[KIND_TEXT[c.kind]]}`}>{t.kind[c.kind]}</span>
            </div>
            <p className={s.changeNote}>{c.note}</p>
          </li>
        ))}
      </ul>
    ) : null;

  const comparisonList = hasEvidenceRows ? evidenceList : changeList;
  const comparisonListCount = hasEvidenceRows ? evidenceChanges!.length : changedItems.length;

  return (
    <section className={s.root} lang={lang} data-lang={lang}>
      <div className={s.layout}>
        <div className={s.main}>
          <div className={s.head}>
            <div className={s.headTop}>
              <p className={s.eyebrow}>
                {t.eyebrow} · {marketLabel} · {toolLabel}
              </p>
              <p className={updatedAt ? `${s.refresh} ${s.refreshOn}` : s.refresh}>
                <span className={s.refreshDot} aria-hidden="true" />
                {updatedAt ? t.evidenceUpdated : t.unavailable}
              </p>
            </div>
            <h2 className={s.question}>{question}</h2>
            <p className={s.contextLine}>
              <span className={s.contextLabel}>{t.savedContext}: </span>
              {marketLabel} · {periodLabel} · {basisLabel} · {toolLabel}
            </p>
            <div className={s.chips}>
              <span className={`${s.chip} ${s.chipMuted}`}>{t.selectedChip(selectedCount)}</span>
              <span className={`${s.chip} ${s.chipOk}`}>{t.qualifiedChip(qualifiedCount)}</span>
              <span className={s.chipsNote}>{t.savedNotConclusion}</span>
            </div>
          </div>

          <section>
            <div className={s.secHead}>
              <h3 className={s.secTitle}>{t.comparedHeading}</h3>
              <span className={s.secMeta}>{statusMeta}</span>
            </div>
            <div className={s.secBody}>
              {comparisonStatus === "unavailable" ? (
                <p className={`${s.noteBox} ${s.noteWarn}`}>{t.noteUnavailable}</p>
              ) : comparisonStatus === "denied" ? (
                <p className={`${s.noteBox} ${s.noteWarn}`}>{t.noteDenied}</p>
              ) : comparisonStatus === "invalid" ? (
                <p className={`${s.noteBox} ${s.noteWarn}`}>{t.noteInvalid}</p>
              ) : comparisonStatus === "scope_changed" ? (
                <p className={`${s.noteBox} ${s.noteWarn}`}>{t.noteScopeChanged}</p>
              ) : comparisonStatus === "unchecked" ? (
                <p className={`${s.noteBox} ${s.noteMuted}`}>{t.noteUnchecked}</p>
              ) : (
                <>
                  {(comparisonStatus === "changed" || comparisonStatus === "incomplete") &&
                    (comparisonListCount > 0 ? (
                      comparisonList
                    ) : comparisonStatus === "changed" ? (
                      <p className={`${s.noteBox} ${s.noteMuted}`}>{t.changeCount(0)}</p>
                    ) : null)}
                  {comparisonStatus === "incomplete" ? (
                    <p className={`${s.noteBox} ${s.noteWarn}`}>{t.limitationIncomplete}</p>
                  ) : null}
                  {comparisonStatus === "unchanged" ? (
                    <p className={`${s.noteBox} ${s.noteBrand}`}>{t.noteUnchanged}</p>
                  ) : null}
                </>
              )}
            </div>
          </section>

          <section className={s.read}>
            <div className={s.readHead}>
              <p className={s.readEyebrow}>{t.readEyebrow}</p>
              <span className={s.readState}>{t.readState[readiness.state]}</span>
            </div>
            <p className={s.readHeadline}>{t.headline[readiness.state]}</p>
            {readiness.state === "ready" ? (
              <p className={s.readBody}>{t.bodyReady}</p>
            ) : readiness.unmet.length > 0 ? (
              <div className={s.readBody}>
                <p>{t.stillNeeded}</p>
                <ul className={s.unmetList}>
                  {readiness.unmet.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className={s.readScopeNote}>
              {t.readScope}. {t.coverageNotConfidence}
            </p>
          </section>

          <section>
            <div className={s.secHead}>
              <h3 className={s.secTitle}>{t.measuresHeading}</h3>
              <span className={s.secMeta}>
                <span className={s.countNum}>{selectedCount}</span> · {t.measuresCaption}
              </span>
            </div>
            {selectedCount === 0 ? (
              <p className={s.emptyMeasures}>{t.noMeasures}</p>
            ) : (
              <ul className={s.measureList}>
                {selectedMeasures.map((m) => {
                  const shown = visibleValue(m);
                  return (
                    <li key={m.stableId} className={s.measureItem}>
                      <button
                        type="button"
                        className={s.measureBtn}
                        disabled={!onInspect}
                        onClick={() => onInspect?.(m.stableId)}
                      >
                        <span className={s.measureInfo}>
                          <span className={s.measureLabel}>{m.label}</span>
                          <span className={s.measureNote}>{m.note}</span>
                          {shown && m.observedAt ? (
                            <span className={s.measureObserved}>{t.observedAt(m.observedAt)}</span>
                          ) : null}
                        </span>
                        <span className={s.measureSide}>
                          {shown ? (
                            <span className={s.measureValue}>
                              {formatMeasureValue(shown.value, shown.unit)}
                            </span>
                          ) : null}
                          <span className={`${s.avail} ${s[AVAIL_COLOR[m.availability]]}`}>
                            {t.availability[m.availability]}
                          </span>
                          {onInspect ? (
                            <span className={s.inspectHint} aria-hidden="true">
                              {t.inspect} →
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className={s.rail}>
          <div className={s.card}>
            <div className={s.railHead}>
              <h3 className={s.railTitle}>{t.healthHeading}</h3>
              <span className={`${s.railState} ${s[HEALTH_STATE_COLOR[healthState]]}`}>
                {t.healthState[healthState]}
              </span>
            </div>
            <p className={s.healthBig}>
              <span className={s.healthNum}>{qualifiedCount}</span>
              <span className={s.healthOf}>{t.healthOf(selectedCount)}</span>
            </p>
            <ul className={s.healthList}>
              {selectedMeasures.map((m) => (
                <li key={m.stableId} className={s.healthRow}>
                  <span className={s.healthName}>
                    <span
                      className={`${s.healthDot} ${s[AVAIL_DOT[m.availability]]}`}
                      aria-hidden="true"
                    />
                    {m.label}
                  </span>
                  <span className={`${s.avail} ${s[AVAIL_COLOR[m.availability]]}`}>
                    {t.availability[m.availability]}
                  </span>
                </li>
              ))}
            </ul>
            <p className={s.healthFoot}>{t.coverageNotConfidence}</p>
          </div>

          <div className={s.card}>
            <div className={s.railHead}>
              <h3 className={s.railTitle}>{t.clocksHeading}</h3>
            </div>
            <dl className={s.clockList}>
              {(
                [
                  [t.clockSaved, savedAt],
                  [t.clockUpdated, updatedAt],
                  [t.clockSourceGen, sourceGenerationAt],
                  [t.clockRights, rightsAt],
                ] as Array<[string, string | null]>
              ).map(([label, value]) => (
                <div key={label} className={s.clockRow}>
                  <dt className={s.clockTerm}>{label}</dt>
                  <dd className={s.clockVal}>
                    {value ?? <span className={s.clockUnavail}>{t.unavailable}</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <p className={s.clocksFoot}>{t.clocksFootnote}</p>
          </div>

          <div className={s.actions}>
            <button
              type="button"
              className={`${s.btn} ${s.btnPrimary}`}
              disabled={!onContinue}
              onClick={() => onContinue?.()}
            >
              <span>{t.continueLabel}</span>
              <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className={`${s.btn} ${s.btnGhost}`}
              disabled={!onEdit}
              onClick={() => onEdit?.()}
            >
              <span>{t.editLabel}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>

          <div className={s.reopen}>
            <p className={s.reopenTitle}>{t.reopenTitle}</p>
            <p className={s.reopenBody}>{t.reopenBody}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default IntlInvestigationPanel;
