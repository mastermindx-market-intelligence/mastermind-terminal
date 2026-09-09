"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { subjectKindLabel } from "@/lib/plainLabels";
import { parseAnalysisSearchParams } from "@/lib/analysisRoute";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { isUuid, normalizeThesisContent, normalizeThesisSubject } from "@/lib/theses";
import type {
  ThesisAction,
  ThesisContent,
  ThesisDetail,
  ThesisHorizon,
  ThesisLifecycle,
  ThesisSubjectRef,
  ThesisSummary,
  ThesisVersion,
} from "@/lib/theses";
import {
  RMS_VIEWS,
  RMS_DEFAULT_VIEW,
  RMS_HYDRATION_BATCH,
  RMS_COPY,
  BUILTIN_VIEWS,
  MAX_SAVED_VIEWS,
  coverageRows,
  ideaRows,
  thesisRows,
  reviewRows,
  catalystRows,
  riskRows,
  noteRows,
  fireStatusBatches,
  selectHydrationIds,
  hydrationScope,
  formatScopeSentence,
  conditionLine,
  readConditionStates,
  applyViewFilter,
} from "@/lib/rmsViews";
import type {
  BuiltinViewId,
  ConditionState,
  CoverageRow,
  RmsViewDef,
  RmsViewId,
  SavedView,
  ViewFilter,
} from "@/lib/rmsViews";
import styles from "./ThesisWorkspace.module.css";

export interface ThesisWorkspaceProps {
  ownerKey: string;
  initialSymbol?: string;
  initialThesisId?: string;
  invalidLink?: boolean;
}

type Draft = {
  title: string;
  statement: string;
  catalysts: string;
  falsifiers: string;
  risks: string;
  horizon: ThesisHorizon;
  effectiveAt: string;
  revisionNote: string;
};
type Conflict = { currentVersion: number; lifecycleState: ThesisLifecycle };
type Pending = {
  schema: "mastermind.thesis-pending/v2";
  ownerKey: string;
  action: ThesisAction;
  clientRequestId: string;
  serializedBody: string;
};
type LoadState = "loading" | "ready" | "unavailable" | "session_expired";
type DetailState = "idle" | "loading" | "ready" | "not_found" | "unavailable";
type MobilePane = "list" | "detail";

const EMPTY_DRAFT: Draft = {
  title: "", statement: "", catalysts: "", falsifiers: "", risks: "",
  horizon: "unspecified", effectiveAt: "", revisionNote: "",
};
const PENDING_SCHEMA = "mastermind.thesis-pending/v2" as const;
const PENDING_STORAGE_PREFIX = "mm.thesis.pending.v2:";
const LEGACY_PENDING_STORAGE_PREFIX = "mm.thesis.pending.v1:";
const HISTORY_POSITION_KEY = "__mmThesisHistoryPosition";
const PENDING_ACTIONS = new Set<ThesisAction>(["create", "revise", "archive", "invalidate", "reopen"]);

const COPY = {
  en: {
    eyebrow: "RESEARCH WORKSPACE", title: "Thesis workspace", newThesis: "New thesis", list: "Your theses",
    loading: "Loading your theses…", unavailable: "Your thesis store did not answer", retry: "Try again",
    unavailableBody: "Nothing has been changed. This is not an empty workspace.", expired: "Your session expired",
    expiredBody: "Sign in again before reading or changing private theses.", invalidLink: "This thesis link is invalid",
    invalidLinkBody: "No thesis was requested. Open the Thesis workspace or use a complete UUID link.",
    notFound: "Thesis not found", notFoundBody: "That thesis does not exist or belongs to another account.",
    subject: "Subject", listingScoped: "Listing-scoped identity", titleLabel: "Title", statement: "Thesis statement",
    catalysts: "Catalysts", falsifiers: "What would prove this wrong", risks: "Risks", onePerLine: "One item per line",
    horizon: "Horizon", effective: "Effective as of (optional)", effectiveHistory: "Effective as of", revision: "Revision note",
    save: "Save", saving: "Saving…", archive: "Archive", invalidate: "Invalidate", reopen: "Reopen",
    copyLink: "Copy link", copied: "Link copied", version: "Version", current: "Current",
    active: "Active", archived: "Archived", invalidated: "Invalidated", history: "Version history",
    conflict: "A newer version was saved elsewhere", conflictBody: "Your draft is still here. Nothing was overwritten.",
    reload: "Reload current", copyDraft: "Copy draft", draftCopied: "Draft copied",
    confirmReload: "Discard this local draft and load the current saved version?",
    invalid: "Check the required fields. Nothing was saved.", transition: "That lifecycle change is not allowed.",
    ambiguous: "The response was interrupted. Retry sends the exact same request ID and payload.",
    retrySame: "Retry same request", saved: "Saved as version", replayed: "replayed", lines: "Complete snapshot",
    pendingRecoveries: "Pending recovery requests",
    moreTheses: "More theses exist; refine this workspace before continuing.",
    historyTruncated: "History is truncated; no versions were silently discarded.", backToList: "Back to list",
    carrierUnavailable: "This browser could not safely preserve the request. Nothing was sent.",
    unsaved: "Unsaved changes", unsavedBody: "This draft has not been sent. Copy it or confirm before leaving or switching.",
    confirmDiscard: "Discard this unsaved draft? This cannot be undone.",
    saveBeforeTransition: "Save or discard substantive edits before changing lifecycle.",
    inspectVersion: "Inspect version", historicalSnapshot: "Historical snapshot", currentSnapshot: "Current snapshot",
    previousVersion: "Previous version", origin: "Origin", recordedBy: "Recorded by", you: "You",
    subjectOwner: "Subject owner", subjectKind: "Subject kind", listing: "Listing", transitionLabel: "Transition",
    systemRecorded: "System recorded", none: "None",
  },
  zh: {
    eyebrow: "研究工作区", title: "研究论点工作区", newThesis: "新建论点", list: "你的论点",
    loading: "正在加载你的论点…", unavailable: "论点存储未响应", retry: "重试",
    unavailableBody: "没有任何更改。这并不代表工作区为空。", expired: "登录会话已过期",
    expiredBody: "请重新登录，再读取或修改你的私人论点。", invalidLink: "论点链接无效",
    invalidLinkBody: "系统没有请求任何论点。请打开研究论点工作区，或使用完整 UUID 链接。",
    notFound: "未找到论点", notFoundBody: "该论点不存在，或属于另一个账户。",
    subject: "标的", listingScoped: "上市代码范围身份", titleLabel: "标题", statement: "论点陈述",
    catalysts: "催化因素", falsifiers: "什么情况会推翻这个判断", risks: "风险", onePerLine: "每行一项",
    horizon: "时间范围", effective: "生效时间（可选）", effectiveHistory: "生效时间", revision: "修订说明",
    save: "保存", saving: "保存中…", archive: "归档", invalidate: "判定失效", reopen: "重新打开",
    copyLink: "复制链接", copied: "链接已复制", version: "版本", current: "当前",
    active: "有效", archived: "已归档", invalidated: "已失效", history: "版本历史",
    conflict: "其他位置已保存更新版本", conflictBody: "你的草稿仍在这里，没有内容被覆盖。",
    reload: "载入当前版本", copyDraft: "复制草稿", draftCopied: "草稿已复制",
    confirmReload: "放弃本地草稿并载入当前已保存版本？",
    invalid: "请检查必填字段。没有保存任何内容。", transition: "不允许执行该生命周期变更。",
    ambiguous: "响应中断。重试会发送完全相同的请求 ID 和内容。",
    retrySame: "重试同一请求", saved: "已保存为版本", replayed: "已重放", lines: "完整快照",
    pendingRecoveries: "待恢复请求",
    moreTheses: "还有更多论点；请先缩小工作区范围。", historyTruncated: "历史记录已截断；没有静默丢弃任何版本。",
    backToList: "返回列表",
    carrierUnavailable: "此浏览器无法安全保留该请求。请求尚未发送。",
    unsaved: "有未保存的更改", unsavedBody: "此草稿尚未发送。请先复制，或在离开和切换前确认放弃。",
    confirmDiscard: "放弃这份未保存的草稿？此操作无法撤销。",
    saveBeforeTransition: "更改生命周期前，请先保存或放弃内容修改。",
    inspectVersion: "查看版本", historicalSnapshot: "历史快照", currentSnapshot: "当前快照",
    previousVersion: "上一版本", origin: "起始版本", recordedBy: "记录者", you: "你",
    subjectOwner: "标的所有者", subjectKind: "标的类型", listing: "上市代码", transitionLabel: "变更类型",
    systemRecorded: "系统记录时间", none: "无",
  },
} as const;

const HORIZON_LABELS: Record<"en" | "zh", Record<ThesisHorizon, string>> = {
  en: { unspecified: "Unspecified", days: "Days", weeks: "Weeks", months: "Months", quarters: "Quarters", years: "Years" },
  zh: { unspecified: "未指定", days: "天", weeks: "周", months: "月", quarters: "季度", years: "年" },
};

const TRANSITION_LABELS: Record<"en" | "zh", Record<ThesisAction, string>> = {
  en: { create: "Created", revise: "Revised", archive: "Archived", invalidate: "Invalidated", reopen: "Reopened" },
  zh: { create: "创建", revise: "修订", archive: "归档", invalidate: "判定失效", reopen: "重新打开" },
};

function draftFromDetail(detail: ThesisDetail): Draft {
  const content = detail.current.content;
  return {
    title: content.title,
    statement: content.statement,
    catalysts: content.catalysts.join("\n"),
    falsifiers: content.falsifiers.join("\n"),
    risks: content.risks.join("\n"),
    horizon: content.horizon,
    effectiveAt: content.effectiveAt ? utcInstantToLocalInput(content.effectiveAt) : "",
    revisionNote: "",
  };
}

const trimCanonicalSpaces = (value: string) => value.replace(/\r\n?/g, "\n").replace(/^ +| +$/g, "");
const lines = (value: string) => value.split("\n").map(trimCanonicalSpaces).filter(Boolean);
const pad2 = (value: number) => String(value).padStart(2, "0");
const pad3 = (value: number) => String(value).padStart(3, "0");
const LOCAL_DATE_TIME = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]{1,3}))?)?$/;

function utcInstantToLocalInput(value: string): string {
  const instant = new Date(value);
  return `${String(instant.getFullYear()).padStart(4, "0")}-${pad2(instant.getMonth() + 1)}-${pad2(instant.getDate())}`
    + `T${pad2(instant.getHours())}:${pad2(instant.getMinutes())}:${pad2(instant.getSeconds())}.${pad3(instant.getMilliseconds())}`;
}

function localInputToUtcInstant(value: string): string | undefined {
  const match = value.match(LOCAL_DATE_TIME);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", fraction = ""] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const milliseconds = Number(fraction.padEnd(3, "0") || "0");
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  const candidate = new Date(year, month - 1, day, hour, minute, second, milliseconds);
  const sameWallClock = (instant: Date) => instant.getFullYear() === year
    && instant.getMonth() === month - 1
    && instant.getDate() === day
    && instant.getHours() === hour
    && instant.getMinutes() === minute
    && instant.getSeconds() === second
    && instant.getMilliseconds() === milliseconds;
  // A nonexistent spring-forward wall clock is normalized by Date; reject that normalization.
  if (!sameWallClock(candidate)) return undefined;
  // Date chooses one side of a repeated fall-back clock. Search the full practical DST window and
  // reject if another instant renders as the same local control value.
  for (let deltaMinutes = 1; deltaMinutes <= 180; deltaMinutes += 1) {
    if (sameWallClock(new Date(candidate.getTime() - deltaMinutes * 60_000))
      || sameWallClock(new Date(candidate.getTime() + deltaMinutes * 60_000))) return undefined;
  }
  return candidate.toISOString();
}

function statusLabel(state: ThesisLifecycle, copy: typeof COPY.en | typeof COPY.zh): string {
  return state === "active" ? copy.active : state === "archived" ? copy.archived : copy.invalidated;
}

function builtinLabel(id: BuiltinViewId, rms: (typeof RMS_COPY)["en"]): string {
  if (id === "mine") return rms["builtin.mine"];
  if (id === "stale_30") return rms["builtin.stale30"];
  return rms["builtin.windowClosed"];
}

function isSavableFilter(filter: ViewFilter | null): boolean {
  if (!filter) return false;
  return !!filter.staleDays || !!filter.windowClosed || !!filter.subjectGroupKey || filter.lifecycle !== "active";
}

type ActivePreset = { kind: "builtin"; id: BuiltinViewId } | { kind: "saved"; id: string };

function buildContent(draft: Draft, baselineEffectiveAt: string | null, effectiveEdited: boolean): ThesisContent | null {
  const effectiveAt = effectiveEdited
    ? (draft.effectiveAt ? localInputToUtcInstant(draft.effectiveAt) : null)
    : baselineEffectiveAt;
  if (effectiveAt === undefined) return null;
  return {
    schema: "mastermind.thesis-content/v1",
    title: draft.title,
    statement: draft.statement,
    catalysts: lines(draft.catalysts),
    falsifiers: lines(draft.falsifiers),
    risks: lines(draft.risks),
    horizon: draft.horizon,
    effectiveAt,
    revisionNote: trimCanonicalSpaces(draft.revisionNote) || null,
  };
}

function transitionContent(current: ThesisContent, revisionNote: string): ThesisContent {
  return {
    ...current,
    revisionNote: trimCanonicalSpaces(revisionNote) || null,
  };
}

function draftEquals(left: Draft, right: Draft, includeRevisionNote = true): boolean {
  return left.title === right.title
    && left.statement === right.statement
    && left.catalysts === right.catalysts
    && left.falsifiers === right.falsifiers
    && left.risks === right.risks
    && left.horizon === right.horizon
    && left.effectiveAt === right.effectiveAt
    && (!includeRevisionNote || left.revisionNote === right.revisionNote);
}

function listingSubject(symbol: string): ThesisSubjectRef {
  return {
    schema: "mastermind.thesis-subject-ref/v1",
    kind: "issuer",
    owner: "terminal.analysis_symbol",
    key: symbol,
    identityState: "listing_scoped",
    listing: { symbol, mic: null, securityId: null },
    companyId: null,
    display: `${symbol} · listing scoped`,
  };
}

function exactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  const keys = new Set(expected);
  return actual.length === expected.length && actual.every((key) => keys.has(key));
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameJsonValue(item, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && sameJsonValue(leftRecord[key], rightRecord[key]));
}

function pendingKey(ownerKey: string, clientRequestId: string): string {
  return `${PENDING_STORAGE_PREFIX}${encodeURIComponent(ownerKey)}:${clientRequestId}`;
}

function validSerializedMutation(serializedBody: string, action: ThesisAction, clientRequestId: string): boolean {
  try {
    const parsed = JSON.parse(serializedBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const body = parsed as Record<string, unknown>;
    const expected = action === "create"
      ? ["action", "clientRequestId", "subject", "content"]
      : ["action", "id", "expectedVersion", "clientRequestId", "subject", "content"];
    if (!exactObjectKeys(body, expected) || body.action !== action || body.clientRequestId !== clientRequestId
      || !isUuid(clientRequestId) || clientRequestId !== clientRequestId.toLowerCase()) return false;
    if (action !== "create" && (!isUuid(body.id) || body.id !== body.id.toLowerCase()
      || typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1)) return false;
    const subject = normalizeThesisSubject(body.subject);
    const content = normalizeThesisContent(body.content);
    return !!subject && !!content && sameJsonValue(body.subject, subject) && sameJsonValue(body.content, content)
      && JSON.stringify(body) === serializedBody;
  } catch {
    return false;
  }
}

function decodePending(value: string | null, expectedOwner: string, expectedKey: string): Pending | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const envelope = candidate as Record<string, unknown>;
    if (!exactObjectKeys(envelope, ["schema", "ownerKey", "action", "clientRequestId", "serializedBody"])
      || envelope.schema !== PENDING_SCHEMA || envelope.ownerKey !== expectedOwner
      || typeof envelope.action !== "string" || !PENDING_ACTIONS.has(envelope.action as ThesisAction)
      || typeof envelope.clientRequestId !== "string" || typeof envelope.serializedBody !== "string") return null;
    const pending = envelope as Pending;
    if (pendingKey(expectedOwner, pending.clientRequestId) !== expectedKey
      || !validSerializedMutation(pending.serializedBody, pending.action, pending.clientRequestId)) return null;
    return pending;
  } catch {
    return null;
  }
}

function encodePending(pending: Pending): string {
  return JSON.stringify(pending);
}

function storePending(pending: Pending): boolean {
  try {
    const key = pendingKey(pending.ownerKey, pending.clientRequestId);
    const encoded = encodePending(pending);
    const existing = window.localStorage.getItem(key);
    if (existing !== null && existing !== encoded) return false;
    window.localStorage.setItem(key, encoded);
    return window.localStorage.getItem(key) === encoded;
  } catch {
    return false;
  }
}

function clearPending(pending: Pending): boolean {
  try {
    const key = pendingKey(pending.ownerKey, pending.clientRequestId);
    if (window.localStorage.getItem(key) !== encodePending(pending)) return false;
    window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === null;
  } catch {
    return false;
  }
}

function legacyPending(value: string | null, ownerKey: string): Pending | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (!exactObjectKeys(candidate, ["action", "body"])
      || typeof candidate.action !== "string" || !PENDING_ACTIONS.has(candidate.action as ThesisAction)
      || !candidate.body || typeof candidate.body !== "object" || Array.isArray(candidate.body)) return null;
    const body = candidate.body as Record<string, unknown>;
    if (typeof body.clientRequestId !== "string") return null;
    const serializedBody = JSON.stringify(body);
    if (!validSerializedMutation(serializedBody, candidate.action as ThesisAction, body.clientRequestId)) return null;
    return {
      schema: PENDING_SCHEMA,
      ownerKey,
      action: candidate.action as ThesisAction,
      clientRequestId: body.clientRequestId,
      serializedBody,
    };
  } catch {
    return null;
  }
}

function historyPosition(state: unknown): number | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const value = (state as Record<string, unknown>)[HISTORY_POSITION_KEY];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function historyState(position: number): Record<string, unknown> {
  const current = window.history.state;
  return {
    ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
    [HISTORY_POSITION_KEY]: position,
  };
}

export default function ThesisWorkspace({ ownerKey, initialSymbol, initialThesisId, invalidLink = false }: ThesisWorkspaceProps) {
  const { lang } = useLang();
  const copy = COPY[lang];
  const seededSymbol = normalizeAnalysisSymbol(initialSymbol) ?? "";
  const [listState, setListState] = useState<LoadState>(invalidLink ? "ready" : "loading");
  const [detailState, setDetailState] = useState<DetailState>(initialThesisId ? "loading" : "idle");
  const [theses, setTheses] = useState<ThesisSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialThesisId ?? null);
  const [detail, setDetail] = useState<ThesisDetail | null>(null);
  const [subjectDraft, setSubjectDraft] = useState(seededSymbol);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState<{ subject: string; draft: Draft }>(() => ({
    subject: seededSymbol,
    draft: EMPTY_DRAFT,
  }));
  const [effectiveBaselineUtc, setEffectiveBaselineUtc] = useState<string | null>(null);
  const [effectiveEdited, setEffectiveEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pendingQueue, setPendingQueue] = useState<Pending[]>([]);
  const [pendingHydrated, setPendingHydrated] = useState(false);
  const [carrierBlocked, setCarrierBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inspectedVersion, setInspectedVersion] = useState<number | null>(null);
  const [routeInvalid, setRouteInvalid] = useState(invalidLink);
  const [mobilePane, setMobilePane] = useState<MobilePane>(initialThesisId || seededSymbol ? "detail" : "list");
  const [view, setView] = useState<RmsViewId>(RMS_DEFAULT_VIEW);
  const [subjectFilterKey, setSubjectFilterKey] = useState<string | null>(null);
  // Stored alongside subjectFilterKey at the moment of selection (never re-derived by
  // looking the key back up in the current row set) — round-2 review MAJOR: deriving
  // it via `allThesesViewRows.find(...)` returned `null` on a miss (the filtered
  // subject's last thesis edited/removed after the filter was applied), which fell
  // back to the forbidden "Everything you have written." sentence and a bare
  // " · Show everything" chip while the filter was still active.
  const [subjectFilterLabel, setSubjectFilterLabel] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewsUnavailable, setSavedViewsUnavailable] = useState(false);
  const [activePreset, setActivePreset] = useState<ActivePreset | null>(null);
  const [namingOpen, setNamingOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [savedViewsLimit, setSavedViewsLimit] = useState(false);
  const [fireStates, setFireStates] = useState<Map<string, ConditionState>>(new Map());
  // Round-2 review (Opus MAJOR 1): a failed fire-status read used to collapse into an
  // empty map, which the Window closed preset then reported as the positive claim
  // "nothing has a closed window". An unread condition is unknown, not absent.
  const [fireStatusUnavailable, setFireStatusUnavailable] = useState(false);
  const [hydratedDetails, setHydratedDetails] = useState<Map<string, ThesisDetail>>(new Map());
  const [hydrating, setHydrating] = useState(false);
  const [hydrationUnavailable, setHydrationUnavailable] = useState(false);
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set());
  const lensRefs = useRef<Partial<Record<RmsViewId, HTMLButtonElement | null>>>({});
  const detailRequest = useRef(0);
  const routeDiscardAuthorized = useRef(false);
  const historyPositionRef = useRef(0);
  const restoringPop = useRef(false);
  /** M4 (round-2 review): hydration is one automatic batch, ever, per mount — never a
   *  chain. Without this, a batch that comes back all-`missing` (hydratedDetails stays
   *  empty) kept re-firing the effect because `missingIds` grew and was in its deps.
   *  Reset per-owner (round-2 review minor): otherwise switching `ownerKey` within one
   *  mount permanently skips the automatic batch for the new owner. */
  // This round's review minor 2 (Meta-CEO B ruling): the per-owner reset below must
  // be keyed on `ownerKey` ALONE. With `invalidLink` also in its dependency array,
  // any `invalidLink` transition (true<->false) with NO owner change re-ran the
  // whole per-owner reset, wiping hydration state, subject filters, etc. that
  // belonged to the CURRENT, unchanged owner — a false-to-false (or true-to-true)
  // re-render never reaches the effect at all now, but neither does a genuine
  // false<->true flip on its own. `invalidLink` is still read below (via this ref,
  // so reading it never re-adds it to the effect's dependency array) purely to
  // decide what `listState` should become for the owner the reset just landed on;
  // the effect that actually PERFORMS the fetch (`if (invalidLink) return; ...
  // loadList()`, further down) is invalidLink's own effect and is unchanged.
  const invalidLinkRef = useRef(invalidLink);
  useEffect(() => {
    invalidLinkRef.current = invalidLink;
  }, [invalidLink]);
  const autoHydrationAttempted = useRef(false);
  useEffect(() => {
    autoHydrationAttempted.current = false;
    // Round-2 review r3 minor 5: a prior owner's stale fault must not survive into a
    // new owner's hydration — otherwise switching `ownerKey` within one mount could
    // render the fault notice before that owner's own first batch has even run.
    setHydrationUnavailable(false);
    // Meta-CEO B ruling r4 MAJOR: an `ownerKey` change with no remount must reset
    // EVERY per-owner piece of state, not only the fault flag above — otherwise a
    // previous owner's hydrated thesis details, missing-id set, or an active subject
    // filter survive into the new owner's workspace (a stale subject filter label in
    // particular used to keep naming the PREVIOUS owner's subject while resolving
    // against the new owner's rows).
    setHydratedDetails(new Map());
    setMissingIds(new Set());
    setSubjectFilterKey(null);
    setSubjectFilterLabel(null);
    setSavedViews([]);
    setSavedViewsUnavailable(false);
    setActivePreset(null);
    setNamingOpen(false);
    setNameDraft("");
    setRenamingId(null);
    setSavedViewsLimit(false);
    setFireStates(new Map());
    // This round's review (minor 5): the MAJOR fix above resets every per-owner
    // HYDRATION field, but `theses` itself (the id set the defensive membership
    // filter in `detailListRows` checks against) and `listState` were left holding
    // the PREVIOUS owner's values until the new owner's own `loadList()` fetch
    // resolves. A stale Owner-A response landing inside that window — before Owner
    // B's list request completes — would still pass the membership check, because
    // Owner A's ids were still sitting in `theses`. Clearing both synchronously here
    // (same effect, same tick as the `ownerKey` swap) closes that window entirely:
    // by the time any hydration response for either owner can resolve, `theses` is
    // already empty for the new owner, so nothing can match by membership until the
    // new owner's own rows actually arrive.
    //
    // This round's review (minor 3): `theses` and `listState` must reset TOGETHER,
    // never one without the other. The previous code cleared `theses`
    // unconditionally but set `listState` to "loading" only when `!invalidLink` —
    // under an invalid link, `listState` was left holding whatever the PREVIOUS
    // owner's value happened to be (e.g. a stale "unavailable" or "ready"), a state
    // that was never actually true for the new owner, since nothing is ever fetched
    // for an invalid link. Both are now derived together, in the same tick.
    setTheses([]);
    setListState(invalidLinkRef.current ? "ready" : "loading");
  }, [ownerKey]);
  // Round-2 review r3 minor 1/2: the rail's ARIA orientation must track the same
  // 600px breakpoint the CSS switches the tablist to a horizontal scroller at — read
  // via `matchMedia` state, not recomputed ad hoc only inside the keydown handler.
  const [narrowRail, setNarrowRail] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 600px)");
    const update = () => setNarrowRail(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);
  // Meta-CEO B ruling r4 minor 6: at the narrow (<=600px) breakpoint the tablist
  // becomes a horizontal scroller (CSS above), and it must carry a visible edge-fade
  // affordance whenever its content actually overflows the visible width, so a user
  // knows there is more to scroll to. `narrowRail` flipping true is the one signal
  // that the rail just became (or already is) the horizontal layout, so re-check
  // then.
  const lensListRef = useRef<HTMLUListElement | null>(null);
  const [railOverflowing, setRailOverflowing] = useState(false);
  const [railOverflowLeft, setRailOverflowLeft] = useState(false);
  const measureRailOverflow = useRef<() => void>(() => {});
  useEffect(() => {
    const el = lensListRef.current;
    if (!narrowRail || !el) {
      setRailOverflowing(false);
      setRailOverflowLeft(false);
      measureRailOverflow.current = () => {};
      return;
    }
    const check = () => {
      setRailOverflowing(el.scrollWidth > el.clientWidth + 1);
      setRailOverflowLeft(el.scrollLeft > 0);
    };
    measureRailOverflow.current = check;
    check();
    el.addEventListener("scroll", check, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", check);
      return () => {
        el.removeEventListener("scroll", check);
        window.removeEventListener("resize", check);
      };
    }
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      observer.disconnect();
    };
  }, [narrowRail]);
  // This round's review MAJOR 2 (Meta-CEO B ruling): the previous hard
  // `el.scrollLeft = 0` reset always left the rail showing its first few tabs
  // regardless of which lens was actually selected — at 390 with a non-first lens
  // selected (e.g. a page reload restoring a lens from
  // `mm.thesis.lens.v1:<ownerKey>`), the active lens had no on-screen representation
  // at all. Ruling r4 minor 6's literal "start at scroll 0 in the crop" applies only
  // to the case where the FIRST lens is selected; for every other lens, the rail
  // must instead scroll the SELECTED tab into view — on mount and on every lens
  // change. `scrollIntoView` on the first lens is a no-op that leaves the rail at
  // scroll 0 anyway (nothing precedes it in the list), so both requirements hold at
  // once: "start at 0" for the first lens, "selected lens visible" for every lens.
  useEffect(() => {
    if (!narrowRail) return;
    // jsdom (the unit-test environment) has no `scrollIntoView` implementation —
    // real browsers all do, but guard the call rather than crash a test render.
    lensRefs.current[view]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    // scrollIntoView does not reliably fire a `scroll` event (or a ResizeObserver
    // entry) in every engine — re-run the same overflow check so `data-overflow-left`
    // tracks the post-scroll scrollLeft.
    measureRailOverflow.current();
    const frame = window.requestAnimationFrame(() => measureRailOverflow.current());
    return () => window.cancelAnimationFrame(frame);
  }, [narrowRail, view]);
  // Round-2 review r3 minor 6: `reviewRows` reads a 90-day staleness window off `now`
  // — frozen at the last time `theses`/`conditions` changed, a thesis crossed into
  // "stale" only when something ELSE happened to reload the list, sometimes days
  // late. Recompute on a slow interval and whenever the tab regains focus.
  const [reviewNow, setReviewNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setReviewNow(new Date());
    const id = window.setInterval(tick, 5 * 60 * 1000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, []);
  const pending = pendingQueue[0] ?? null;
  // Computed early (round-2 review minor) so the lens rail's keyboard handler below can
  // read it: a locked carrier already disables every tab button, but the keydown
  // listener lives on the enclosing <ul> and previously kept switching lenses via
  // keyboard even while every tab was `disabled`.
  const carrierLocked = !pendingHydrated || carrierBlocked || pendingQueue.length > 0;
  const isDirty = useMemo(
    () => subjectDraft !== baseline.subject || !draftEquals(draft, baseline.draft),
    [baseline, draft, subjectDraft],
  );
  const substantiveDirty = useMemo(
    () => subjectDraft !== baseline.subject || !draftEquals(draft, baseline.draft, false),
    [baseline, draft, subjectDraft],
  );
  const confirmDiscard = useCallback(
    () => !isDirty || window.confirm(copy.confirmDiscard),
    [copy.confirmDiscard, isDirty],
  );

  useEffect(() => {
    const existing = historyPosition(window.history.state);
    historyPositionRef.current = existing ?? 0;
    if (existing === null) {
      window.history.replaceState(historyState(0), "", window.location.href);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const restored: Pending[] = [];
      let blocked = false;
      try {
        const ownerPrefix = `${PENDING_STORAGE_PREFIX}${encodeURIComponent(ownerKey)}:`;
        for (const key of Object.keys(window.localStorage).filter((candidate) => candidate.startsWith(ownerPrefix)).sort()) {
          const decoded = decodePending(window.localStorage.getItem(key), ownerKey, key);
          if (!decoded) blocked = true;
          else restored.push(decoded);
        }

        // Bounded one-key migration from the pre-F11 session-only envelope. It is deleted only
        // after the v2 owner/request key has passed the same synchronous write/read fence.
        const legacyKey = `${LEGACY_PENDING_STORAGE_PREFIX}${ownerKey}`;
        const legacyRaw = window.sessionStorage.getItem(legacyKey);
        if (legacyRaw !== null) {
          const migrated = legacyPending(legacyRaw, ownerKey);
          if (!migrated || !storePending(migrated)) blocked = true;
          else {
            window.sessionStorage.removeItem(legacyKey);
            if (!restored.some((candidate) => candidate.clientRequestId === migrated.clientRequestId)) restored.push(migrated);
          }
        }
      } catch {
        blocked = true;
      }
      if (!active) return;
      setPendingQueue(restored);
      setCarrierBlocked(blocked);
      if (blocked) setMessage(copy.carrierUnavailable);
      else if (restored.length) {
        setMessage(copy.ambiguous);
        setMobilePane("detail");
      }
      setPendingHydrated(true);
    });
    return () => { active = false; };
  }, [copy.ambiguous, copy.carrierUnavailable, ownerKey]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`mm.thesis.lens.v1:${ownerKey}`);
      if (stored && RMS_VIEWS.some((v) => v.id === stored)) setView(stored as RmsViewId);
      else setView(RMS_DEFAULT_VIEW);
    } catch {
      setView(RMS_DEFAULT_VIEW);
    }
  }, [ownerKey]);

  const selectView = useCallback((id: RmsViewId) => {
    setView(id);
    setSubjectFilterKey(null);
    setSubjectFilterLabel(null);
    // Round-2 review r3 minor 5: a fault on the PREVIOUS lens must not bleed into the
    // next one — the new lens gets its own fresh read of the hydration state.
    setHydrationUnavailable(false);
    try {
      window.localStorage.setItem(`mm.thesis.lens.v1:${ownerKey}`, id);
    } catch {
      /* per-viewer convenience only */
    }
  }, [ownerKey]);

  const filterBySubject = useCallback((row: CoverageRow) => {
    setSubjectFilterKey(row.key);
    // Captured at the moment of selection — never re-derived by looking `row.key` back
    // up in a later row snapshot (round-2 review MAJOR; see the state declaration above).
    setSubjectFilterLabel(row.display);
    setView("theses");
    try {
      window.localStorage.setItem(`mm.thesis.lens.v1:${ownerKey}`, "theses");
    } catch {
      /* per-viewer convenience only */
    }
  }, [ownerKey]);

  const onLensKeyDown = useCallback((event: React.KeyboardEvent<HTMLUListElement>) => {
    // Round-2 review minor: every tab is `disabled={carrierLocked}`, but the keydown
    // listener lives on the enclosing <ul>, not the (disabled) buttons — without this
    // guard, arrow/Home/End keys could still switch lenses while the carrier is locked.
    if (carrierLocked) return;
    const idx = RMS_VIEWS.findIndex((v) => v.id === view);
    if (idx < 0) return;
    let nextIdx = idx;
    if (event.key === "ArrowDown" || (narrowRail && event.key === "ArrowRight")) nextIdx = (idx + 1) % RMS_VIEWS.length;
    else if (event.key === "ArrowUp" || (narrowRail && event.key === "ArrowLeft")) nextIdx = (idx - 1 + RMS_VIEWS.length) % RMS_VIEWS.length;
    else if (event.key === "Home") nextIdx = 0;
    else if (event.key === "End") nextIdx = RMS_VIEWS.length - 1;
    else return;
    event.preventDefault();
    const nextId = RMS_VIEWS[nextIdx].id;
    selectView(nextId);
    requestAnimationFrame(() => lensRefs.current[nextId]?.focus());
  }, [carrierLocked, narrowRail, selectView, view]);

  const hydrateBatch = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setHydrating(true);
    try {
      const params = new URLSearchParams();
      ids.forEach((id) => params.append("ids", id));
      const response = await fetch(`/api/theses?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        setHydrationUnavailable(true);
        return;
      }
      const payload = await response.json();
      // The batch branch answers under a `batch` key, distinct from the list branch's
      // `theses` (m4, round-2 review) — the two carry different item shapes.
      if (!Array.isArray(payload.batch)) {
        setHydrationUnavailable(true);
        return;
      }
      setHydratedDetails((prev) => {
        const next = new Map(prev);
        for (const item of payload.batch as ThesisDetail[]) next.set(item.id, item);
        return next;
      });
      if (Array.isArray(payload.missing) && payload.missing.length > 0) {
        setMissingIds((prev) => {
          const next = new Set(prev);
          for (const id of payload.missing as string[]) next.add(id);
          return next;
        });
      }
      setHydrationUnavailable(false);
    } catch {
      setHydrationUnavailable(true);
    } finally {
      setHydrating(false);
    }
  }, []);

  // m5 (round-2 review): catalystRows/riskRows/noteRows only ever surface `active`
  // theses, so spending hydration budget on archived/invalidated rows returns details
  // that can never add a line row while still advancing the scope sentence. Bound both
  // the automatic batch and "Show more" to the active subset.
  const activeTheses = useMemo(() => theses.filter((t) => t.lifecycleState === "active"), [theses]);

  useEffect(() => {
    const def = RMS_VIEWS.find((v) => v.id === view);
    if (!def?.requiresContent || activeTheses.length === 0) return;
    if (autoHydrationAttempted.current) return;
    autoHydrationAttempted.current = true;
    void hydrateBatch(selectHydrationIds(activeTheses, new Set([...hydratedDetails.keys(), ...missingIds])));
    // Deliberately NOT depending on hydratedDetails/missingIds: this effect fires the
    // one automatic batch (M4) and the ref above makes every later run a no-op —
    // including a batch that comes back all-`missing`, which must never chain into a
    // second automatic fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeTheses, hydrateBatch]);

  const rms = RMS_COPY[lang];
  const activeViewDef: RmsViewDef = RMS_VIEWS.find((v) => v.id === view) ?? RMS_VIEWS[0];
  // Meta-CEO B ruling r4 MAJOR (defensive half): the reset above closes the ordinary
  // path, but a hydration request already in flight when `ownerKey` swaps can still
  // resolve AFTER the reset and merge the PREVIOUS owner's thesis details back in via
  // `hydrateBatch`'s functional `setHydratedDetails` update. Every content lens reads
  // through `detailListRows`, so gating it on membership in the CURRENT owner's own
  // `theses` list is the one choke point that keeps a foreign thesis's lines from ever
  // rendering, regardless of which stale async response lands when.
  const thesesIdSet = useMemo(() => new Set(theses.map((t) => t.id)), [theses]);
  const detailListRows = useMemo(
    () => Array.from(hydratedDetails.values()).filter((d) => thesesIdSet.has(d.id)),
    [hydratedDetails, thesesIdSet],
  );
  // minor 2 (round-2 review) — considered, not changed: `missingIds` are ids the batch
  // API reported `not_found` for a thesis this workspace's own list just returned, i.e.
  // confirmed gone (deleted between list and hydrate), never a transient fault (a fault
  // is a 503 for the whole batch, handled separately by `hydrationUnavailable`). Content
  // lenses (catalystRows/riskRows/noteRows) read only from `hydratedDetails`, so a
  // missing id contributes zero rows either way — counting it toward `scope.complete`
  // reaches an honest 100% instead of one that can never complete for a thesis that no
  // longer exists, and reports no rows as loaded that were actually dropped.
  const conditions = useMemo(
    () => readConditionStates(theses.map((t) => t.id), (id) => fireStates.get(id)),
    [theses, fireStates],
  );
  const presetFilter = useMemo<ViewFilter | null>(() => {
    if (!activePreset) return null;
    if (activePreset.kind === "builtin") {
      return BUILTIN_VIEWS.find((item) => item.id === activePreset.id)?.filter ?? null;
    }
    return savedViews.find((item) => item.id === activePreset.id)?.filter ?? null;
  }, [activePreset, savedViews]);
  const filteredSummaries = useMemo(
    () => (presetFilter ? applyViewFilter(theses, presetFilter, conditions, reviewNow) : theses),
    [theses, presetFilter, conditions, reviewNow],
  );
  const viewIdSet = useMemo(() => new Set(filteredSummaries.map((t) => t.id)), [filteredSummaries]);
  // The active subset of what the CURRENT view holds. The scope sentence and "Show N
  // more" count this set, not the workspace, so that under a saved view the sentence
  // still describes the lines actually on screen (Grok minor 2's other half — the
  // content lenses now respect the view, so the hydration budget must follow it).
  const viewActiveTheses = useMemo(
    () => filteredSummaries.filter((t) => t.lifecycleState === "active"),
    [filteredSummaries],
  );
  const scope = useMemo(
    () => hydrationScope(viewActiveTheses, new Set([...hydratedDetails.keys(), ...missingIds])),
    [viewActiveTheses, hydratedDetails, missingIds],
  );
  const hydrateMore = useCallback(() => {
    void hydrateBatch(selectHydrationIds(viewActiveTheses, new Set([...hydratedDetails.keys(), ...missingIds])));
  }, [viewActiveTheses, hydratedDetails, missingIds, hydrateBatch]);
  // Grok minor 2 (round-2 review): the Coverage rail used to count EVERY thesis while a
  // saved view or preset was active, so the rail disagreed with the list under it.
  const coverageViewRows = useMemo(() => coverageRows(filteredSummaries), [filteredSummaries]);
  const ideaViewRows = useMemo(() => ideaRows(filteredSummaries), [filteredSummaries]);
  const allThesesViewRows = useMemo(() => thesisRows(filteredSummaries), [filteredSummaries]);
  const thesesViewRows = useMemo(
    () => (subjectFilterKey ? allThesesViewRows.filter((r) => r.subjectGroupKey === subjectFilterKey) : allThesesViewRows),
    [allThesesViewRows, subjectFilterKey],
  );
  // M3 (round-2 review, MAJOR fix): the subject a Coverage row filtered to, for the
  // chip + the lens-head sentence + the filtered-empty message. This used to be
  // re-derived by looking `subjectFilterKey` back up in `allThesesViewRows` — which
  // returned `null` (falling back to the forbidden "Everything you have written."
  // sentence and a bare " · Show everything" chip) the moment the filtered subject's
  // last thesis was edited to a different subject or removed from the loaded list
  // while the filter stayed active. `subjectFilterLabel` is captured once, at the
  // moment of selection, and never re-looked-up.
  const filteredSubjectDisplay = subjectFilterKey ? subjectFilterLabel : null;
  const clearSubjectFilter = useCallback(() => {
    setSubjectFilterKey(null);
    setSubjectFilterLabel(null);
  }, []);
  const filterToSave = useMemo<ViewFilter>(() => {
    const base: ViewFilter = presetFilter ? { ...presetFilter } : { lifecycle: "active" };
    if (subjectFilterKey) base.subjectGroupKey = subjectFilterKey;
    return base;
  }, [presetFilter, subjectFilterKey]);
  const canSaveView = isSavableFilter(filterToSave) && !savedViewsUnavailable;
  // Round-2 review BLOCKERs 2 and 3 and MAJOR 1, which are one defect: whatever emptied
  // the list has to be what the empty state names. A saved view used to fall through to
  // `empty.theses` ("No theses yet.") — false while theses exist, and the exact string
  // the spec forbids for a filtered slice; the Stale preset printed `builtin.staleWhat`
  // ("No changes in 30 days."), the inverse of the truth; and a fire-status read that
  // never landed was reported as "nothing has a closed window". This applies on every
  // lens that renders thesis rows, not only Theses.
  const presetEmptyCopy = useMemo(() => {
    if (!activePreset || subjectFilterKey) return null;
    if (activePreset.kind === "saved") return rms["savedViews.viewEmpty"];
    if (activePreset.id === "window_closed") {
      // Spec 2.8: a failed thesis-fire-status read falls back to the already-frozen
      // condition.unavailable copy — no new error string for this one read path.
      return fireStatusUnavailable ? rms["condition.unavailable"] : rms["builtin.windowClosedEmpty"];
    }
    if (activePreset.id === "mine") return rms["builtin.mineEmpty"];
    if (activePreset.id === "stale_30") return rms["builtin.staleEmpty"];
    return null;
  }, [activePreset, subjectFilterKey, rms, fireStatusUnavailable]);

  const saveCurrentView = useCallback(async () => {
    if (savedViews.length >= MAX_SAVED_VIEWS) {
      setSavedViewsLimit(true);
      return;
    }
    const name = nameDraft;
    try {
      const response = await fetch("/api/thesis-saved-views", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", name, filter: filterToSave }),
      });
      if (response.status === 409) {
        setSavedViewsLimit(true);
        return;
      }
      if (!response.ok) {
        setSavedViewsUnavailable(true);
        return;
      }
      const payload = await response.json();
      if (payload.view) {
        setSavedViews((current) => [payload.view, ...current].slice(0, MAX_SAVED_VIEWS));
        setActivePreset({ kind: "saved", id: payload.view.id });
      }
      setNamingOpen(false);
      setNameDraft("");
      setSavedViewsLimit(false);
    } catch {
      setSavedViewsUnavailable(true);
    }
  }, [filterToSave, nameDraft, savedViews.length]);

  const renameView = useCallback(async (id: string, name: string) => {
    try {
      const response = await fetch("/api/thesis-saved-views", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rename", id, name }),
      });
      if (!response.ok) {
        setSavedViewsUnavailable(true);
        return;
      }
      const payload = await response.json();
      if (payload.view) {
        setSavedViews((current) => current.map((view) => (view.id === id ? payload.view : view)));
      }
      setRenamingId(null);
      setNameDraft("");
    } catch {
      setSavedViewsUnavailable(true);
    }
  }, []);

  const deleteView = useCallback(async (id: string) => {
    if (!window.confirm(rms["savedViews.confirmDelete"])) return;
    try {
      const response = await fetch("/api/thesis-saved-views", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      if (!response.ok) {
        setSavedViewsUnavailable(true);
        return;
      }
      setSavedViews((current) => current.filter((view) => view.id !== id));
      setActivePreset((current) => (current?.kind === "saved" && current.id === id ? null : current));
      setSavedViewsLimit(false);
    } catch {
      setSavedViewsUnavailable(true);
    }
  }, [rms]);
  const reviewViewRows = useMemo(() => reviewRows(filteredSummaries, reviewNow, conditions), [filteredSummaries, conditions, reviewNow]);
  // Grok minor 2 (round-2 review): the three content lenses used to read every hydrated
  // thesis, so their rows and rail counts ignored the active view. `detailListRows`
  // stays workspace-wide — the hydration-fault panels below deliberately gate on it.
  const viewDetailRows = useMemo(
    () => (presetFilter ? detailListRows.filter((d) => viewIdSet.has(d.id)) : detailListRows),
    [detailListRows, viewIdSet, presetFilter],
  );
  const catalystViewRows = useMemo(() => catalystRows(viewDetailRows), [viewDetailRows]);
  const riskViewRows = useMemo(() => riskRows(viewDetailRows), [viewDetailRows]);
  const noteViewRows = useMemo(() => noteRows(viewDetailRows), [viewDetailRows]);
  const lensCount = useCallback((v: RmsViewDef): number | string => {
    // m1 (round-2 review): once hydration scope is complete, the content-lens counts
    // are exactly knowable — stop showing "—" forever.
    if (v.requiresContent) {
      if (!scope.complete) return rms.countUnknown;
      switch (v.id) {
        case "catalysts": return catalystViewRows.length;
        case "risks": return riskViewRows.length;
        case "notes": return noteViewRows.length;
        default: return rms.countUnknown;
      }
    }
    switch (v.id) {
      case "coverage": return coverageViewRows.length;
      case "ideas": return ideaViewRows.length;
      case "theses": return thesesViewRows.length;
      case "reviews": return reviewViewRows.length;
      default: return 0;
    }
  }, [rms.countUnknown, coverageViewRows, ideaViewRows, thesesViewRows, reviewViewRows, scope.complete, catalystViewRows, riskViewRows, noteViewRows]);
  const scopeSentence = formatScopeSentence(scope.loaded, scope.total, scope.complete, rms);
  // Meta-CEO B ruling r4 minor 2 (the frozen "10" strings are withdrawn): the pending
  // increment is never larger than the actual remaining count, so "Show 10 more"/"The
  // next 10 could not be loaded" read false the moment fewer than 10 theses are left.
  const pendingCount = Math.max(0, Math.min(RMS_HYDRATION_BATCH, scope.total - scope.loaded));
  // Round-2 review minor: memoized (was recomputed on every render via an inline call),
  // and `null` rather than a fabricated `{source:"unavailable"}` when there is no
  // `detail` yet — an unsaved NEW thesis is not an object whose condition can be
  // "not connected"; it does not exist. The render site below gates on `detail`.
  const detailCondition = useMemo(
    () => (detail ? (conditions.get(detail.id) ?? { source: "unavailable" as const }) : null),
    [detail, conditions],
  );

  useEffect(() => {
    if (!isDirty && !pending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending && routeDiscardAuthorized.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const protectRouteClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (pending) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (window.confirm(copy.confirmDiscard)) {
        routeDiscardAuthorized.current = true;
        window.setTimeout(() => { routeDiscardAuthorized.current = false; }, 1000);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", protectRouteClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", protectRouteClick, true);
    };
  }, [copy.confirmDiscard, isDirty, pending]);

  const loadSavedViews = useCallback(async () => {
    try {
      const response = await fetch("/api/thesis-saved-views", { cache: "no-store" });
      if (!response.ok) {
        setSavedViewsUnavailable(true);
        return;
      }
      const payload = await response.json();
      if (!Array.isArray(payload.views)) {
        setSavedViewsUnavailable(true);
        return;
      }
      setSavedViews(payload.views);
      setSavedViewsUnavailable(false);
      // `truncated` (round-2 review, Opus minor 3): more rows exist than this answer
      // carries, so say so in words instead of dropping them silently.
      setSavedViewsLimit(payload.truncated === true || payload.views.length >= MAX_SAVED_VIEWS);
    } catch {
      setSavedViewsUnavailable(true);
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const response = await fetch("/api/theses", { cache: "no-store" });
      if (response.status === 401) return setListState("session_expired");
      if (!response.ok) {
        setListState("unavailable");
        setMobilePane("list");
        return;
      }
      const payload = await response.json();
      if (!Array.isArray(payload.theses)) {
        setListState("unavailable");
        setMobilePane("list");
        return;
      }
      setTheses(payload.theses);
      setTruncated(payload.truncated === true);
      setListState("ready");
    } catch {
      setListState("unavailable");
      setMobilePane("list");
    }
  }, []);

  const loadDetail = useCallback(async (id: string, token = ++detailRequest.current) => {
    try {
      const response = await fetch(`/api/theses?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (token !== detailRequest.current) return;
      if (response.status === 401) {
        setListState("session_expired");
        setDetailState("idle");
        return;
      }
      if (response.status === 404) return setDetailState("not_found");
      if (!response.ok) return setDetailState("unavailable");
      const payload = await response.json();
      if (token !== detailRequest.current) return;
      if (!payload.thesis) return setDetailState("unavailable");
      const loadedDraft = draftFromDetail(payload.thesis);
      setDetail(payload.thesis);
      setDraft(loadedDraft);
      setSubjectDraft(payload.thesis.subject.key);
      setBaseline({ subject: payload.thesis.subject.key, draft: loadedDraft });
      setEffectiveBaselineUtc(payload.thesis.current.content.effectiveAt);
      setEffectiveEdited(false);
      setInspectedVersion(null);
      setDetailState("ready");
    } catch {
      if (token !== detailRequest.current) return;
      setDetailState("unavailable");
    }
  }, []);

  const writeRoute = useCallback((url: URL, mode: "push" | "replace") => {
    if (url.href === window.location.href) return;
    if (mode === "push") {
      const next = historyPositionRef.current + 1;
      window.history.pushState(historyState(next), "", url.toString());
      historyPositionRef.current = next;
      return;
    }
    window.history.replaceState(historyState(historyPositionRef.current), "", url.toString());
  }, []);

  const openDetail = useCallback((id: string, historyMode: "push" | "none" = "push") => {
    const token = ++detailRequest.current;
    setRouteInvalid(false);
    setSelectedId(id);
    setDetail(null);
    setSubjectDraft("");
    setDraft(EMPTY_DRAFT);
    setBaseline({ subject: "", draft: EMPTY_DRAFT });
    setEffectiveBaselineUtc(null);
    setEffectiveEdited(false);
    setConflict(null);
    setMessage(null);
    setInspectedVersion(null);
    setDetailState("loading");
    setMobilePane("detail");
    if (historyMode === "push") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "theses");
      url.searchParams.set("thesis", id);
      url.searchParams.delete("symbol");
      writeRoute(url, "push");
    }
    void loadDetail(id, token);
  }, [loadDetail, writeRoute]);

  const beginDetailLoad = useCallback((id: string, discardConfirmed = false) => {
    if (pending || (!discardConfirmed && !confirmDiscard())) return;
    openDetail(id);
  }, [confirmDiscard, openDetail, pending]);

  useEffect(() => {
    if (invalidLink) return;
    // Start external synchronization in a microtask: the effect itself performs no synchronous
    // React state transition, and both loaders update only after their first network boundary.
    void Promise.resolve().then(() => loadList());
    void Promise.resolve().then(() => loadSavedViews());
    if (initialThesisId) {
      const token = ++detailRequest.current;
      void Promise.resolve().then(() => loadDetail(initialThesisId, token));
    }
  }, [initialThesisId, invalidLink, loadDetail, loadList, loadSavedViews, ownerKey]);

  useEffect(() => {
    // Round-2 review (Opus MAJOR 2 / Grok minor 1): this used to `.slice(0, 50)` while
    // the list carries up to 200, so a thesis at index 50+ whose window had actually
    // closed was silently dropped from the one preset that exists to surface it. Every
    // id is asked about, in batches of the route's own cap — the same bounded shape
    // `RMS_HYDRATION_BATCH` uses for content hydration.
    const ids = theses.map((row) => row.id).filter((id) => isUuid(id));
    if (ids.length === 0) {
      setFireStates(new Map());
      setFireStatusUnavailable(false);
      return;
    }
    let cancelled = false;
    const batches = fireStatusBatches(ids);
    void Promise.all(batches.map(async (batch) => {
      const response = await fetch(
        `/api/thesis-fire-status?${batch.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("unavailable");
      return response.json();
    }))
      .then((payloads) => {
        if (cancelled) return;
        const next = new Map<string, ConditionState>();
        for (const payload of payloads) {
          const states = payload && typeof payload === "object"
            ? (payload as { states?: Record<string, ConditionState> }).states
            : undefined;
          if (!states || typeof states !== "object") continue;
          for (const id of ids) {
            const state = states[id];
            if (state) next.set(id, state);
          }
        }
        setFireStates(next);
        setFireStatusUnavailable(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Not an empty map dressed as an answer: nothing is known, and the preset's
        // empty state says so.
        setFireStates(new Map());
        setFireStatusUnavailable(true);
      });
    return () => { cancelled = true; };
  }, [theses]);

  const resetToNew = useCallback((symbol: string, historyMode: "push" | "none" = "push") => {
    detailRequest.current += 1;
    setRouteInvalid(false);
    setSelectedId(null);
    setDetail(null);
    setDetailState("idle");
    setSubjectDraft(symbol);
    setDraft(EMPTY_DRAFT);
    setBaseline({ subject: symbol, draft: EMPTY_DRAFT });
    setEffectiveBaselineUtc(null);
    setEffectiveEdited(false);
    setConflict(null);
    setMessage(null);
    setInspectedVersion(null);
    setMobilePane("detail");
    if (historyMode === "push") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "theses");
      url.searchParams.delete("thesis");
      if (symbol) url.searchParams.set("symbol", symbol);
      else url.searchParams.delete("symbol");
      writeRoute(url, "push");
    }
  }, [writeRoute]);

  const startNew = useCallback(() => {
    if (pending || !confirmDiscard()) return;
    resetToNew(seededSymbol);
  }, [confirmDiscard, pending, resetToNew, seededSymbol]);

  const resetToList = useCallback((historyMode: "push" | "none" = "push") => {
    detailRequest.current += 1;
    setRouteInvalid(false);
    setSelectedId(null);
    setDetail(null);
    setDetailState("idle");
    setSubjectDraft("");
    setDraft(EMPTY_DRAFT);
    setBaseline({ subject: "", draft: EMPTY_DRAFT });
    setEffectiveBaselineUtc(null);
    setEffectiveEdited(false);
    setConflict(null);
    setMessage(null);
    setInspectedVersion(null);
    setMobilePane("list");
    if (historyMode === "push") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "theses");
      url.searchParams.delete("thesis");
      url.searchParams.delete("symbol");
      writeRoute(url, "push");
    }
  }, [writeRoute]);

  const backToList = useCallback(() => {
    if (pending || !confirmDiscard()) return;
    resetToList();
  }, [confirmDiscard, pending, resetToList]);

  useEffect(() => {
    const handlePop = (event: PopStateEvent) => {
      if (restoringPop.current) {
        restoringPop.current = false;
        return;
      }
      const priorPosition = historyPositionRef.current;
      const nextPosition = historyPosition(event.state);
      const restore = () => {
        event.stopImmediatePropagation();
        restoringPop.current = true;
        if (nextPosition === null) window.history.forward();
        else window.history.go(priorPosition - nextPosition);
      };
      if (pending) return restore();
      if (isDirty && !window.confirm(copy.confirmDiscard)) return restore();
      if (isDirty) {
        routeDiscardAuthorized.current = true;
        window.setTimeout(() => { routeDiscardAuthorized.current = false; }, 1000);
      }
      if (nextPosition !== null) historyPositionRef.current = nextPosition;
      if (window.location.pathname !== "/analysis") return;
      const route = parseAnalysisSearchParams(new URLSearchParams(window.location.search));
      if (route.kind === "invalid_thesis") {
        detailRequest.current += 1;
        setRouteInvalid(true);
        setSelectedId(null);
        setDetail(null);
        setDetailState("idle");
        return;
      }
      if (route.kind !== "theses") return;
      if (route.thesisId) return openDetail(route.thesisId, "none");
      const symbol = normalizeAnalysisSymbol(route.symbol) ?? "";
      if (symbol) return resetToNew(symbol, "none");
      resetToList("none");
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [copy.confirmDiscard, isDirty, openDetail, pending, resetToList, resetToNew]);

  const changeDraft = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }, []);

  const mutationBody = useCallback((action: ThesisAction, requestId: string): Record<string, unknown> | null => {
    const symbol = detail?.subject.key ?? normalizeAnalysisSymbol(subjectDraft);
    const content = normalizeThesisContent(
      action === "create" || action === "revise" || !detail
        ? buildContent(draft, effectiveBaselineUtc, effectiveEdited)
        : transitionContent(detail.current.content, draft.revisionNote),
    );
    if (!symbol || !content
      || ((action === "invalidate" || (action === "reopen" && detail?.lifecycleState === "invalidated"))
        && !content.revisionNote)) return null;
    return {
      action,
      ...(selectedId ? { id: selectedId, expectedVersion: detail?.currentVersion ?? 0 } : {}),
      clientRequestId: requestId,
      subject: detail?.subject ?? listingSubject(symbol),
      content,
    };
  }, [detail, draft, effectiveBaselineUtc, effectiveEdited, selectedId, subjectDraft]);

  const removeTerminalPending = useCallback((pendingMutation: Pending): boolean => {
    if (!clearPending(pendingMutation)) {
      setCarrierBlocked(true);
      setMessage(copy.carrierUnavailable);
      return false;
    }
    setPendingQueue((current) => current.filter((candidate) =>
      candidate.clientRequestId !== pendingMutation.clientRequestId));
    return true;
  }, [copy.carrierUnavailable]);

  const consumeResponse = useCallback(async (response: Response, pendingMutation: Pending) => {
    let payload: Record<string, unknown>;
    try {
      const decoded = await response.json();
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("non-object response");
      payload = decoded as Record<string, unknown>;
    } catch {
      setSaving(false);
      setMessage(copy.ambiguous);
      return;
    }
    setSaving(false);
    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      setMessage(copy.ambiguous);
      return;
    }
    if (response.status === 401) {
      if (exactObjectKeys(payload, ["error"]) && payload.error === "unauthenticated") {
        setListState("session_expired");
      } else {
        setMessage(copy.ambiguous);
      }
      return;
    }
    if (response.status === 409 && exactObjectKeys(payload, ["error", "currentVersion", "lifecycleState"])
      && payload.error === "version_conflict") {
      const currentVersion = payload.currentVersion;
      const lifecycleState = payload.lifecycleState;
      if (typeof currentVersion !== "number" || !Number.isInteger(currentVersion) || currentVersion < 1
        || (lifecycleState !== "active" && lifecycleState !== "archived" && lifecycleState !== "invalidated")) {
        setMessage(copy.ambiguous);
        return;
      }
      if (!removeTerminalPending(pendingMutation)) return;
      setConflict({ currentVersion, lifecycleState });
      return;
    }
    if (!response.ok) {
      const expectedErrors = response.status === 409 ? new Set(["idempotency_conflict"])
        : response.status === 404 ? new Set(["thesis_not_found"])
          : response.status === 422 ? new Set(["invalid_transition"])
            : response.status === 413 ? new Set(["request_too_large"])
              : response.status === 400
                ? new Set(["invalid_payload", "invalid_json", "unsupported_action"])
                : new Set<string>();
      if (!exactObjectKeys(payload, ["error"]) || typeof payload.error !== "string" || !expectedErrors.has(payload.error)) {
        setMessage(copy.ambiguous);
        return;
      }
      if (!removeTerminalPending(pendingMutation)) return;
      setMessage(payload.error === "invalid_transition" ? copy.transition : copy.invalid);
      return;
    }
    const id = payload.thesisId;
    const version = payload.version;
    const lifecycleState = payload.lifecycleState;
    if (!exactObjectKeys(payload, ["thesisId", "version", "lifecycleState", "replayed"])
      || !isUuid(id) || id !== id.toLowerCase()
      || typeof version !== "number" || !Number.isInteger(version) || version < 1
      || (lifecycleState !== "active" && lifecycleState !== "archived" && lifecycleState !== "invalidated")
      || typeof payload.replayed !== "boolean") {
      setMessage(copy.ambiguous);
      return;
    }
    if (!removeTerminalPending(pendingMutation)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "theses");
    url.searchParams.set("thesis", id);
    url.searchParams.delete("symbol");
    writeRoute(url, "replace");
    setSelectedId(id);
    setMobilePane("detail");
    setMessage(`${copy.saved} ${version}${payload.replayed ? ` · ${copy.replayed}` : ""}`);
    await loadList();
    await loadDetail(id);
  }, [copy.ambiguous, copy.invalid, copy.replayed, copy.saved, copy.transition, loadDetail, loadList, removeTerminalPending, writeRoute]);

  const send = useCallback(async (pendingMutation: Pending) => {
    if (!storePending(pendingMutation)) {
      setSaving(false);
      setCarrierBlocked(true);
      setMessage(copy.carrierUnavailable);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/theses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: pendingMutation.serializedBody,
      });
      await consumeResponse(response, pendingMutation);
    } catch {
      setSaving(false);
      setMessage(copy.ambiguous);
    }
  }, [consumeResponse, copy.ambiguous, copy.carrierUnavailable]);

  const submit = useCallback((action: ThesisAction) => {
    if (action !== "create" && action !== "revise" && substantiveDirty) {
      setMessage(copy.saveBeforeTransition);
      return;
    }
    const clientRequestId = crypto.randomUUID();
    const body = mutationBody(action, clientRequestId);
    if (!body) return setMessage(copy.invalid);
    const next: Pending = {
      schema: PENDING_SCHEMA,
      ownerKey,
      action,
      clientRequestId,
      serializedBody: JSON.stringify(body),
    };
    if (!storePending(next)) {
      setCarrierBlocked(true);
      setMessage(copy.carrierUnavailable);
      return;
    }
    setPendingQueue((current) => current.some((candidate) => candidate.clientRequestId === clientRequestId)
      ? current : [...current, next]);
    void send(next);
  }, [copy.carrierUnavailable, copy.invalid, copy.saveBeforeTransition, mutationBody, ownerKey, send, substantiveDirty]);

  const copyDraft = useCallback(async () => {
    await navigator.clipboard.writeText(JSON.stringify({ subject: detail?.subject ?? subjectDraft, ...draft }, null, 2));
    setMessage(copy.draftCopied);
  }, [copy.draftCopied, detail?.subject, draft, subjectDraft]);

  const reloadAfterConflict = useCallback(() => {
    if (!selectedId || !window.confirm(copy.confirmReload)) return;
    openDetail(selectedId, "none");
    void loadList();
  }, [copy.confirmReload, loadList, openDetail, selectedId]);

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setMessage(copy.copied);
  }, [copy.copied]);

  // Round-2 review r3 MAJOR-1: rows already hydrated must stay on screen through a
  // LATER batch's fault — computed once so both the "already have rows" branch and
  // the inline fault notice below read the exact same list.
  const contentRows = view === "catalysts" ? catalystViewRows : view === "risks" ? riskViewRows : noteViewRows;
  const lifecycle = detail?.lifecycleState ?? "active";
  const editable = !detail || lifecycle === "active";
  const ambiguous = pendingQueue.length > 0 && !saving;
  const history = useMemo(() => detail?.history ?? [], [detail?.history]);
  const inspected = useMemo<ThesisVersion | null>(
    () => history.find((entry) => entry.version === inspectedVersion) ?? null,
    [history, inspectedVersion],
  );

  if (routeInvalid) {
    return (
      <main className={`main2 ws-shell ${styles.root}`} data-testid="thesis-workspace">
        <section className={styles.centerState} role="status" data-testid="thesis-invalid-link">
          <span className={styles.stateMark}>!</span><h1>{copy.invalidLink}</h1><p>{copy.invalidLinkBody}</p>
          <a className={styles.primaryButton} href="/analysis?view=theses">{copy.title}</a>
        </section>
      </main>
    );
  }

  return (
    <main className={`main2 ws-shell ${styles.root}`} data-testid="thesis-workspace" data-list-state={listState} data-mobile-pane={mobilePane}>
      <header className={styles.contextBar}>
        <div><small>{copy.eyebrow}</small><h1>{copy.title}</h1><span className={styles.contextSubject}>{(detail?.subject.key ?? subjectDraft) || "—"}</span></div>
        <div className={styles.contextActions}>
          {detail && <button type="button" onClick={() => void copyLink()}>{copy.copyLink}</button>}
          <button type="button" className={styles.primaryButton} disabled={carrierLocked} onClick={startNew}>{copy.newThesis}</button>
        </div>
      </header>

      {listState === "session_expired" ? (
        <section className={styles.centerState} role="status"><span className={styles.stateMark}>↗</span><h1>{copy.expired}</h1><p>{copy.expiredBody}</p></section>
      ) : (
        <div className={styles.workspaceGrid}>
          <aside className={styles.rail} aria-label={copy.list} data-testid="thesis-list-pane">
            <nav className={styles.lensRail} aria-label={rms.lensRailLabel} data-testid="thesis-lens-rail" data-overflow={railOverflowing || undefined} data-overflow-left={railOverflowLeft || undefined}>
              <ul ref={lensListRef} role="tablist" aria-orientation={narrowRail ? "horizontal" : "vertical"} onKeyDown={onLensKeyDown}>
                {RMS_VIEWS.map((v) => {
                  // Round-2 review r3 minor 7: the Theses lens badge already shows the
                  // FILTERED count (thesesViewRows is pre-filtered) — it needs a marker
                  // so it never reads as the total while a subject filter is active.
                  const filteredBadge = v.id === "theses" && !!subjectFilterKey;
                  return (
                    <li key={v.id} role="presentation">
                      <button type="button" role="tab" id={`rms-lens-${v.id}`} aria-controls="rms-lens-panel"
                        aria-selected={view === v.id} tabIndex={view === v.id ? 0 : -1}
                        ref={(el) => { lensRefs.current[v.id] = el; }}
                        className={styles.lens} data-selected={view === v.id || undefined}
                        data-grain={v.grain} data-view={v.id} disabled={carrierLocked}
                        onClick={() => selectView(v.id)}>
                        <span>{rms.name[v.id]}</span>
                        <span className={styles.lensCount} data-filtered={filteredBadge || undefined}>
                          {lensCount(v)}
                          {filteredBadge && <span className={styles.srOnly}> ({rms.filteredMarker})</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section className={styles.savedViews} data-testid="rms-saved-views" aria-label={rms["savedViews.title"]}>
              <p className={styles.savedViewsTitle}>{rms["savedViews.title"]}</p>
              {/* Round-2 review (Opus MAJOR 5): these were `<button role="listitem">`,
                  so an explicit ARIA role replaced the implicit one and the packet's
                  primary new controls stopped announcing themselves as actionable.
                  Plain buttons in a container with no list role — the saved-view rows
                  below are wrappers, not list items, for the same reason. */}
              <div className={styles.savedViewChips}>
                {BUILTIN_VIEWS.map((item) => {
                  const selected = activePreset?.kind === "builtin" && activePreset.id === item.id;
                  return (
                    <button key={item.id} type="button" className={styles.savedViewChip}
                      data-builtin={item.id} data-selected={selected || undefined}
                      // Opus minor 4: `builtin.staleWhat` had no render site at all, so
                      // the Stale chip shipped with no plain-language explanation.
                      title={item.id === "stale_30" ? rms["builtin.staleWhat"] : undefined}
                      disabled={carrierLocked}
                      onClick={() => setActivePreset(selected ? null : { kind: "builtin", id: item.id })}>
                      {builtinLabel(item.id, rms)}
                    </button>
                  );
                })}
                {savedViews.map((view) => {
                  const selected = activePreset?.kind === "saved" && activePreset.id === view.id;
                  return (
                    <span key={view.id} className={styles.savedViewItem} data-saved-view={view.id}>
                      {renamingId === view.id ? (
                        <form className={styles.saveViewForm} onSubmit={(event) => { event.preventDefault(); void renameView(view.id, nameDraft); }}>
                          <input aria-label={rms["savedViews.namePlaceholder"]} value={nameDraft} maxLength={80}
                            onChange={(event) => setNameDraft(event.target.value)} />
                          <button type="submit" className={styles.primaryButton}>{rms["savedViews.save"]}</button>
                        </form>
                      ) : (
                        <>
                          <button type="button" className={styles.savedViewChip} data-selected={selected || undefined}
                            disabled={carrierLocked}
                            onClick={() => setActivePreset(selected ? null : { kind: "saved", id: view.id })}>
                            {view.name}
                          </button>
                          <button type="button" className={styles.savedViewAction} disabled={carrierLocked}
                            onClick={() => { setRenamingId(view.id); setNameDraft(view.name); }}>
                            {rms["savedViews.rename"]}
                          </button>
                          <button type="button" className={styles.savedViewAction} disabled={carrierLocked}
                            onClick={() => void deleteView(view.id)}>
                            {rms["savedViews.delete"]}
                          </button>
                        </>
                      )}
                    </span>
                  );
                })}
              </div>
              {savedViewsUnavailable && <p className={styles.savedViewsNote} role="status">{rms["savedViews.unavailable"]}</p>}
              {!savedViewsUnavailable && savedViews.length === 0 && (
                <p className={styles.savedViewsNote} data-testid="rms-saved-views-empty">{rms["savedViews.empty"]}</p>
              )}
              {savedViewsLimit && <p className={styles.savedViewsNote} role="status">{rms["savedViews.limitReached"]}</p>}
            </section>

            <div className={styles.lensHead}>
              <h2>{rms.name[view]}</h2>
              {/* M3 (round-2 review): under a subject filter this lens does not hold
                  "everything you have written" — say what is actually filtered, and
                  give a visible, labeled way back to the unfiltered lens. */}
              <p className={styles.lensWhat}>
                {view === "theses" && subjectFilterKey && filteredSubjectDisplay
                  ? rms.filteredBySubject.replace("{subject}", filteredSubjectDisplay)
                  : rms.what[view]}
              </p>
              {view === "theses" && subjectFilterKey && (
                <button type="button" className={styles.subjectChip} data-testid="rms-subject-chip" onClick={clearSubjectFilter}>
                  {filteredSubjectDisplay ?? ""} · {rms.clearFilter}
                </button>
              )}
              {canSaveView && !namingOpen && (
                <button type="button" className={styles.subjectChip} data-testid="rms-save-view"
                  disabled={carrierLocked || savedViewsLimit}
                  onClick={() => { setNamingOpen(true); setNameDraft(""); }}>
                  {rms["savedViews.newView"]}
                </button>
              )}
              {namingOpen && (
                <form className={styles.saveViewForm} onSubmit={(event) => { event.preventDefault(); void saveCurrentView(); }}>
                  <input aria-label={rms["savedViews.namePlaceholder"]} placeholder={rms["savedViews.namePlaceholder"]}
                    value={nameDraft} maxLength={80} onChange={(event) => setNameDraft(event.target.value)} />
                  <button type="submit" className={styles.primaryButton} disabled={carrierLocked || savedViewsLimit || !nameDraft.trim()}>
                    {rms["savedViews.save"]}
                  </button>
                </form>
              )}
              {activeViewDef.requiresContent && (
                <p className={styles.scopeNote} data-testid="rms-scope">{scopeSentence}</p>
              )}
            </div>

            <div id="rms-lens-panel" role="tabpanel" aria-labelledby={`rms-lens-${view}`}
              className={styles.lensPanel} data-grain={activeViewDef.grain} data-testid="rms-lens-panel">
              {listState === "loading" && <p className={styles.muted} role="status">{copy.loading}</p>}
              {listState === "unavailable" && (
                <div className={styles.railState} role="status" data-testid="rms-unavailable">
                  <strong>{copy.unavailable}</strong><p>{rms.unavailableLens}</p>
                  <button onClick={() => { setListState("loading"); void loadList(); }}>{copy.retry}</button>
                </div>
              )}
              {/* Round-2 review r3 MAJOR-1: a fault gates only the PENDING increment.
                  This terminal "nothing to show" panel may render only when there is
                  truly nothing hydrated yet — the moment any row exists it stays
                  mounted below instead, and the fault becomes the smaller inline
                  notice under the list (further down). Meta-CEO B ruling r4 minor 1:
                  "nothing hydrated" means ZERO theses hydrated for the WHOLE
                  workspace (`detailListRows`), never merely zero rows in the CURRENT
                  lens — a lens can legitimately have no lines of its own even while
                  other theses are hydrated; that case is the lens's own empty state
                  plus the inline fault notice below, not this panel. */}
              {listState === "ready" && activeViewDef.requiresContent && hydrationUnavailable && detailListRows.length === 0 && (
                <div className={styles.railState} role="status" data-testid="rms-hydration-unavailable">
                  <strong>{copy.unavailable}</strong><p>{rms.unavailableLens}</p>
                  {/* Round-2 review MAJOR: a faulted or malformed hydration batch used to
                      leave this the terminal state — the automatic effect only ever fires
                      once per mount (M4) and "Show N more" below is deliberately hidden
                      while this panel is showing, so there was no way back in. Retrying
                      is the same explicit user action as "Show N more" (ruling item 6:
                      further batches only ever via an explicit action, never automatic). */}
                  <button type="button" onClick={hydrateMore} disabled={hydrating}>{copy.retry}</button>
                </div>
              )}
              {listState === "ready" && view === "coverage" && (
                coverageViewRows.length === 0
                  ? <div className={styles.emptyLens} data-testid="rms-empty"><p>{rms.empty.coverage}</p></div>
                  : coverageViewRows.map((row) => (
                    <button key={row.key} type="button" className={styles.subjectRow} onClick={() => filterBySubject(row)}>
                      <span><strong>{row.display}</strong><i data-state={row.active > 0 ? "active" : "idle"} /></span>
                      {/* m3 (round-2 review): words, not a bare ratio (plain-language law). */}
                      <small>{rms.coverageRatio.replace("{active}", String(row.active)).replace("{theses}", String(row.theses))}</small>
                    </button>
                  ))
              )}
              {listState === "ready" && (view === "ideas" || view === "theses" || view === "reviews") && (
                (view === "ideas" ? ideaViewRows : view === "reviews" ? reviewViewRows : thesesViewRows).length === 0
                  // The Theses lens is the default view a fresh workspace lands on, and
                  // master's own e2e contract (terminal/e2e/thesis-workspace.spec.ts)
                  // asserts `getByTestId("thesis-empty")` for that exact first-run empty
                  // state (a sibling repair on this branch caught this PR's rail rewrite
                  // silently dropping it) — every other lens still reads "rms-empty".
                  // Round-2 review MAJOR: a subject filter that resolves to zero rows is
                  // NOT the first-run empty state — the workspace is not empty, only the
                  // filtered slice is — so it never reuses `rms.empty.theses` ("No theses
                  // yet.", false while theses exist) and never claims `thesis-empty`.
                  // Round-2 review BLOCKER 3: `presetEmptyCopy` applies on ALL THREE of
                  // these lenses now (it used to be Theses only), and it covers saved
                  // views as well as built-ins — a view that matched nothing says so,
                  // and never borrows a lens-wide claim ("No theses yet.", "Every thesis
                  // has been revisited at least once.") that is false while the
                  // workspace holds theses the view filtered out.
                  ? (view === "theses" && subjectFilterKey
                    ? <div className={styles.emptyLens} data-testid="rms-filtered-empty">
                      <p>{rms.filteredEmpty.replace("{subject}", filteredSubjectDisplay ?? "")}</p>
                    </div>
                    : presetEmptyCopy
                      ? <div className={styles.emptyLens} data-testid="rms-empty"><p>{presetEmptyCopy}</p></div>
                    : <div className={styles.emptyLens} data-testid={view === "theses" ? "thesis-empty" : "rms-empty"}><p>{rms.empty[view]}</p></div>)
                  : <div className={styles.thesisList}>
                    {(view === "ideas" ? ideaViewRows : view === "reviews" ? reviewViewRows : thesesViewRows).map((row) => (
                      <button key={row.id} type="button" disabled={carrierLocked} className={selectedId === row.id ? styles.selected : ""} onClick={() => beginDetailLoad(row.id)}>
                        <span><b>{row.subjectKey}</b><i data-state={row.lifecycleState}>{statusLabel(row.lifecycleState, copy)}</i></span>
                        <strong>{row.title}</strong><small>{copy.version} {row.currentVersion}</small>
                        {row.reason && <em className={styles.rowReason}>{rms.reason[row.reason]}</em>}
                      </button>
                    ))}
                  </div>
              )}
              {/* Round-2 review r3 MAJOR-1: rows already hydrated stay mounted through a
                  LATER batch's fault — this branch no longer gates on `!hydrationUnavailable`
                  (a fault when `contentRows` is empty still falls through to the
                  `rms-hydration-unavailable` panel above, which is the ONLY place that
                  panel may render, per the guard on it). Meta-CEO B ruling r4 minor 1:
                  that panel now gates on `detailListRows` (workspace-wide), not
                  `contentRows` (this lens only) — so when OTHER theses are already
                  hydrated but this lens has none of its own, render this lens's own
                  empty copy here (never `null`); the inline fault notice below still
                  renders alongside it. */}
              {listState === "ready" && (view === "catalysts" || view === "risks" || view === "notes") && (
                contentRows.length === 0
                  ? (hydrationUnavailable && detailListRows.length === 0
                    ? null
                    : (hydrating && detailListRows.length === 0
                      ? <p className={styles.muted} role="status">{copy.loading}</p>
                      : <div className={styles.emptyLens} data-testid="rms-empty"><p>{rms.empty[view]}</p></div>))
                  : contentRows.map((row) => (
                    <article key={`${row.thesisId}-${row.index}`} className={styles.lineRow} data-testid="rms-line-row">
                      <p className={styles.lineText}>{row.text}</p>
                      <button type="button" className={styles.lineOwner} disabled={carrierLocked} onClick={() => beginDetailLoad(row.thesisId)}>
                        <b>{row.subjectKey}</b><span>{row.thesisTitle}</span><time dateTime={row.at}>{new Date(row.at).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-CA")}</time>
                      </button>
                    </article>
                  ))
              )}
              {/* Round-2 review r3 MAJOR-1: the inline, row-level fault notice — shown
                  UNDER the still-visible list, never replacing it. Meta-CEO B ruling r4
                  minor 1: reachable whenever ANY thesis is already hydrated workspace-
                  wide (`detailListRows.length > 0`), not only when THIS lens has rows —
                  a lens with its own legitimate empty state still needs to show that a
                  later batch faulted. The terminal panel above is the only other case. */}
              {listState === "ready" && activeViewDef.requiresContent && hydrationUnavailable && detailListRows.length > 0 && (
                <div className={styles.railState} role="status" data-testid="rms-hydration-fault">
                  <p>{rms.hydrationFault.replace("{n}", String(pendingCount))}</p>
                  <button type="button" onClick={hydrateMore} disabled={hydrating}>{copy.retry}</button>
                </div>
              )}
              {activeViewDef.requiresContent && !scope.complete && !hydrationUnavailable && (
                <button type="button" className={styles.showMore} onClick={hydrateMore} disabled={hydrating}>{rms.showMore.replace("{n}", String(pendingCount))}</button>
              )}
            </div>
            {truncated && <p className={styles.muted}>{copy.moreTheses}</p>}
          </aside>

          <section className={styles.editorPane} data-testid="thesis-detail-pane">
            <button type="button" className={styles.mobileBack} disabled={carrierLocked} onClick={backToList}>{copy.backToList}</button>
            {detailState === "loading" ? <div className={styles.centerState} role="status"><p>{copy.loading}</p></div>
              : detailState === "not_found" ? <div className={styles.centerState} role="status" data-testid="thesis-not-found"><span className={styles.stateMark}>?</span><h1>{copy.notFound}</h1><p>{copy.notFoundBody}</p></div>
                : detailState === "unavailable" ? <div className={styles.centerState} role="status"><span className={styles.stateMark}>!</span><h1>{copy.unavailable}</h1><p>{copy.unavailableBody}</p>{selectedId && <button onClick={() => beginDetailLoad(selectedId)}>{copy.retry}</button>}</div>
                  : <>
                    <div className={styles.editorHeader}>
                      <div><small>{detail ? statusLabel(lifecycle, copy) : copy.newThesis}</small><h1>{detail ? (detail.subject.identityState === "listing_scoped" ? `${detail.subject.key} · ${copy.listingScoped}` : detail.subject.display) : (subjectDraft || copy.newThesis)}</h1><p>{detail?.subject.identityState === "listing_scoped" || !detail ? copy.listingScoped : detail.subject.owner}</p></div>
                      {detail && <span className={styles.versionBadge}>{copy.version} {detail.currentVersion} · {copy.current}</span>}
                    </div>
                    {detail && detailCondition && (
                      <p className={styles.conditionLine} data-testid="thesis-condition"
                        data-source={detailCondition.source}
                        data-state={detailCondition.source === "monitor" ? detailCondition.state : undefined}>
                        {conditionLine(detailCondition, lang)}
                      </p>
                    )}
                    {conflict && <div className={styles.conflict} role="alert" data-testid="thesis-conflict"><div><strong>{copy.conflict}</strong><p>{copy.conflictBody} {copy.current}: {copy.version} {conflict.currentVersion} · {statusLabel(conflict.lifecycleState, copy)}</p></div><div><button onClick={reloadAfterConflict}>{copy.reload}</button><button onClick={() => void copyDraft()}>{copy.copyDraft}</button></div></div>}
                    {message && <p className={styles.message} role="status">{message}</p>}
                    {isDirty && !pending && <div className={styles.dirtyDraft} role="status" data-testid="thesis-dirty-draft"><div><strong>{copy.unsaved}</strong><p>{copy.unsavedBody}</p></div><button type="button" onClick={() => void copyDraft()}>{copy.copyDraft}</button></div>}
                    {pendingQueue.length > 0 && <section className={styles.dirtyDraft} data-testid="thesis-pending-recovery">
                      <div><strong>{copy.pendingRecoveries}: {pendingQueue.length}</strong></div>
                      {pendingQueue.map((pendingMutation) => <div key={pendingMutation.clientRequestId} data-testid="thesis-pending-recovery-item">
                        <code>{pendingMutation.action} · {pendingMutation.clientRequestId}</code>
                        <button type="button" className={styles.retrySame} disabled={saving || carrierBlocked} onClick={() => void send(pendingMutation)}>{copy.retrySame}</button>
                      </div>)}
                    </section>}

                    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(selectedId ? "revise" : "create"); }}>
                      <label>{copy.subject}<input aria-label={copy.subject} value={detail?.subject.key ?? subjectDraft} disabled={!!detail || carrierLocked} onChange={(event) => { setSubjectDraft(event.target.value.toUpperCase()); setMessage(null); }} placeholder="NVDA" /></label>
                      <label>{copy.titleLabel}<input aria-label={copy.titleLabel} value={draft.title} disabled={!editable || carrierLocked} maxLength={160} onChange={(event) => changeDraft("title", event.target.value)} /></label>
                      <label className={styles.full}>{copy.statement}<textarea aria-label={copy.statement} value={draft.statement} disabled={!editable || carrierLocked} maxLength={12000} rows={8} onChange={(event) => changeDraft("statement", event.target.value)} /></label>
                      {(["catalysts", "falsifiers", "risks"] as const).map((field) => <label key={field}>{copy[field]}<small>{copy.onePerLine}</small><textarea aria-label={copy[field]} value={draft[field]} disabled={!editable || carrierLocked} rows={5} onChange={(event) => changeDraft(field, event.target.value)} /></label>)}
                      <label>{copy.horizon}<select aria-label={copy.horizon} value={draft.horizon} disabled={!editable || carrierLocked} onChange={(event) => changeDraft("horizon", event.target.value as ThesisHorizon)}>{(["unspecified", "days", "weeks", "months", "quarters", "years"] as ThesisHorizon[]).map((value) => <option key={value} value={value}>{HORIZON_LABELS[lang][value]}</option>)}</select></label>
                      <label>{copy.effective}<input aria-label={copy.effective} type="datetime-local" step="0.001" value={draft.effectiveAt} disabled={!editable || carrierLocked} onChange={(event) => { setEffectiveEdited(true); changeDraft("effectiveAt", event.target.value); }} /></label>
                      <label className={styles.full}>{copy.revision}<textarea aria-label={copy.revision} value={draft.revisionNote} disabled={carrierLocked} maxLength={1000} rows={3} onChange={(event) => changeDraft("revisionNote", event.target.value)} /></label>
                      <div className={`${styles.actions} ${styles.full}`}>
                        {editable && <button className={styles.primaryButton} type="submit" disabled={saving || ambiguous || carrierLocked}>{saving ? copy.saving : copy.save}</button>}
                        {detail && lifecycle === "active" && <><button type="button" disabled={saving || ambiguous || carrierLocked} onClick={() => submit("archive")}>{copy.archive}</button><button type="button" className={styles.dangerButton} disabled={saving || ambiguous || carrierLocked} onClick={() => submit("invalidate")}>{copy.invalidate}</button></>}
                        {detail && lifecycle !== "active" && <button type="button" className={styles.primaryButton} disabled={saving || ambiguous || carrierLocked} onClick={() => submit("reopen")}>{copy.reopen}</button>}
                      </div>
                    </form>

                    {detail && <section className={styles.history} aria-label={copy.history}>
                      <div className={styles.historyHeading}><h2>{copy.history}</h2><span>{detail.history.length}</span></div>
                      {history.map((entry) => {
                        const currentEntry = entry.version === detail.currentVersion;
                        const open = inspected?.id === entry.id;
                        return <article key={entry.id} data-version={entry.version} data-current={currentEntry}>
                          <div className={styles.historySummary}>
                            <div><b>v{entry.version}</b><span>{TRANSITION_LABELS[lang][entry.transition]}</span><i data-state={entry.lifecycleState}>{statusLabel(entry.lifecycleState, copy)}</i></div>
                            <time dateTime={entry.systemRecordedAt}>{new Date(entry.systemRecordedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}</time>
                            <strong>{entry.content.title}</strong>
                            <p>{entry.content.revisionNote || copy.lines}{entry.effectiveAt && <span className={styles.effectiveAt}>{copy.effectiveHistory}: <time dateTime={entry.effectiveAt}>{new Date(entry.effectiveAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}</time></span>}</p>
                            <button type="button" aria-label={`${copy.inspectVersion} ${entry.version}`} aria-expanded={open} onClick={() => setInspectedVersion(open ? null : entry.version)}>{copy.inspectVersion}</button>
                          </div>
                          {open && <div className={styles.versionInspector} data-testid="thesis-version-inspector" data-posture={currentEntry ? "current" : "historical"}>
                            <header><div><small>{copy.version} {entry.version}</small><h3>{currentEntry ? copy.currentSnapshot : copy.historicalSnapshot}</h3></div><span data-state={entry.lifecycleState}>{statusLabel(entry.lifecycleState, copy)}</span></header>
                            <dl className={styles.versionMeta}>
                              <div><dt>{copy.previousVersion}</dt><dd>{entry.previousVersion === null ? copy.origin : `${copy.version} ${entry.previousVersion}`}</dd></div>
                              <div><dt>{copy.recordedBy}</dt><dd>{copy.you}</dd></div>
                              <div><dt>{copy.transitionLabel}</dt><dd>{TRANSITION_LABELS[lang][entry.transition]}</dd></div>
                              <div><dt>{copy.systemRecorded}</dt><dd><time dateTime={entry.systemRecordedAt}>{new Date(entry.systemRecordedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}</time></dd></div>
                              <div><dt>{copy.subject}</dt><dd>{entry.subject.key}</dd></div>
                              <div><dt>{copy.subjectOwner}</dt><dd>{entry.subject.owner}</dd></div>
                              <div><dt>{copy.subjectKind}</dt><dd>{subjectKindLabel(entry.subject.kind, lang)}</dd></div>
                              <div><dt>{copy.listing}</dt><dd>{entry.subject.listing?.symbol ?? copy.none}</dd></div>
                            </dl>
                            <div className={styles.snapshotGrid}>
                              <section><h4>{copy.titleLabel}</h4><p>{entry.content.title}</p></section>
                              <section className={styles.snapshotFull}><h4>{copy.statement}</h4><p>{entry.content.statement}</p></section>
                              {(["catalysts", "falsifiers", "risks"] as const).map((field) => <section key={field}><h4>{copy[field]}</h4>{entry.content[field].length ? <ul>{entry.content[field].map((item) => <li key={item}>{item}</li>)}</ul> : <p>{copy.none}</p>}</section>)}
                              <section><h4>{copy.horizon}</h4><p>{HORIZON_LABELS[lang][entry.content.horizon]}</p></section>
                              <section><h4>{copy.effectiveHistory}</h4><p>{entry.content.effectiveAt ? new Date(entry.content.effectiveAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA") : copy.none}</p></section>
                              <section className={styles.snapshotFull}><h4>{copy.revision}</h4><p>{entry.content.revisionNote ?? copy.none}</p></section>
                            </div>
                          </div>}
                        </article>;
                      })}
                      {detail.historyTruncated && <p className={styles.muted}>{copy.historyTruncated}</p>}
                    </section>}
                  </>}
          </section>
        </div>
      )}
    </main>
  );
}
