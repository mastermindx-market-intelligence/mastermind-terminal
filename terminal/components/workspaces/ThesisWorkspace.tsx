"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
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
    empty: "No theses yet", emptyBody: "Start with a view you could be wrong about. Every save becomes part of its history.",
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
    empty: "暂无论点", emptyBody: "从一个你可能判断错的观点开始。每次保存都会进入历史记录。",
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
  const detailRequest = useRef(0);
  const routeDiscardAuthorized = useRef(false);
  const historyPositionRef = useRef(0);
  const restoringPop = useRef(false);
  const pending = pendingQueue[0] ?? null;
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
    if (initialThesisId) {
      const token = ++detailRequest.current;
      void Promise.resolve().then(() => loadDetail(initialThesisId, token));
    }
  }, [initialThesisId, invalidLink, loadDetail, loadList, ownerKey]);

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

  const lifecycle = detail?.lifecycleState ?? "active";
  const editable = !detail || lifecycle === "active";
  const ambiguous = pendingQueue.length > 0 && !saving;
  const carrierLocked = !pendingHydrated || carrierBlocked || pendingQueue.length > 0;
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
            <div className={styles.railHeading}><h2>{copy.list}</h2><span>{theses.length}</span></div>
            {listState === "loading" && <p className={styles.muted} role="status">{copy.loading}</p>}
            {listState === "unavailable" && <div className={styles.railState} role="status"><strong>{copy.unavailable}</strong><p>{copy.unavailableBody}</p><button onClick={() => { setListState("loading"); void loadList(); }}>{copy.retry}</button></div>}
            {listState === "ready" && theses.length === 0 && <div className={styles.railState} data-testid="thesis-empty"><strong>{copy.empty}</strong><p>{copy.emptyBody}</p></div>}
            <div className={styles.thesisList}>
              {theses.map((thesis) => (
                <button key={thesis.id} type="button" disabled={carrierLocked} className={selectedId === thesis.id ? styles.selected : ""} onClick={() => beginDetailLoad(thesis.id)}>
                  <span><b>{thesis.subject.key}</b><i data-state={thesis.lifecycleState}>{statusLabel(thesis.lifecycleState, copy)}</i></span>
                  <strong>{thesis.title}</strong><small>{copy.version} {thesis.currentVersion}</small>
                </button>
              ))}
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
                              <div><dt>{copy.subjectKind}</dt><dd>{entry.subject.kind}</dd></div>
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
