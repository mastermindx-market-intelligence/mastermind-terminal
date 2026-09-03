"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { isUuid } from "@/lib/theses";
import type {
  ThesisAction,
  ThesisContent,
  ThesisDetail,
  ThesisHorizon,
  ThesisLifecycle,
  ThesisSubjectRef,
  ThesisSummary,
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
type Pending = { action: ThesisAction; body: Record<string, unknown> };
type LoadState = "loading" | "ready" | "unavailable" | "session_expired";
type DetailState = "idle" | "loading" | "ready" | "not_found" | "unavailable";
type MobilePane = "list" | "detail";

const EMPTY_DRAFT: Draft = {
  title: "", statement: "", catalysts: "", falsifiers: "", risks: "",
  horizon: "unspecified", effectiveAt: "", revisionNote: "",
};

const COPY = {
  en: {
    eyebrow: "RESEARCH WORKSPACE", title: "Thesis workspace", newThesis: "New thesis", list: "Your theses",
    empty: "No theses yet", emptyBody: "Start with a falsifiable view. Every save becomes part of its history.",
    loading: "Loading your theses…", unavailable: "Your thesis store did not answer", retry: "Try again",
    unavailableBody: "Nothing has been changed. This is not an empty workspace.", expired: "Your session expired",
    expiredBody: "Sign in again before reading or changing private theses.", invalidLink: "This thesis link is invalid",
    invalidLinkBody: "No thesis was requested. Open the Thesis workspace or use a complete UUID link.",
    notFound: "Thesis not found", notFoundBody: "That thesis does not exist or belongs to another account.",
    subject: "Subject", listingScoped: "Listing-scoped identity", titleLabel: "Title", statement: "Thesis statement",
    catalysts: "Catalysts", falsifiers: "Falsifiers", risks: "Risks", onePerLine: "One item per line",
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
    moreTheses: "More theses exist; refine this workspace before continuing.",
    historyTruncated: "History is truncated; no versions were silently discarded.", backToList: "Back to list",
  },
  zh: {
    eyebrow: "研究工作区", title: "研究论点工作区", newThesis: "新建论点", list: "你的论点",
    empty: "暂无论点", emptyBody: "从可证伪的观点开始。每次保存都会进入历史记录。",
    loading: "正在加载你的论点…", unavailable: "论点存储未响应", retry: "重试",
    unavailableBody: "没有任何更改。这并不代表工作区为空。", expired: "登录会话已过期",
    expiredBody: "请重新登录，再读取或修改你的私人论点。", invalidLink: "论点链接无效",
    invalidLinkBody: "系统没有请求任何论点。请打开研究论点工作区，或使用完整 UUID 链接。",
    notFound: "未找到论点", notFoundBody: "该论点不存在，或属于另一个账户。",
    subject: "标的", listingScoped: "上市代码范围身份", titleLabel: "标题", statement: "论点陈述",
    catalysts: "催化因素", falsifiers: "证伪条件", risks: "风险", onePerLine: "每行一项",
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
    moreTheses: "还有更多论点；请先缩小工作区范围。", historyTruncated: "历史记录已截断；没有静默丢弃任何版本。",
    backToList: "返回列表",
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
    effectiveAt: content.effectiveAt ? content.effectiveAt.slice(0, 16) : "",
    revisionNote: "",
  };
}

const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

function statusLabel(state: ThesisLifecycle, copy: typeof COPY.en | typeof COPY.zh): string {
  return state === "active" ? copy.active : state === "archived" ? copy.archived : copy.invalidated;
}

function buildContent(draft: Draft): ThesisContent {
  return {
    schema: "mastermind.thesis-content/v1",
    title: draft.title,
    statement: draft.statement,
    catalysts: lines(draft.catalysts),
    falsifiers: lines(draft.falsifiers),
    risks: lines(draft.risks),
    horizon: draft.horizon,
    effectiveAt: draft.effectiveAt ? new Date(draft.effectiveAt).toISOString() : null,
    revisionNote: draft.revisionNote.trim() || null,
  };
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
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>(initialThesisId || seededSymbol ? "detail" : "list");
  const detailRequest = useRef(0);

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
      setDetail(payload.thesis);
      setDraft(draftFromDetail(payload.thesis));
      setSubjectDraft(payload.thesis.subject.key);
      setDetailState("ready");
    } catch {
      if (token !== detailRequest.current) return;
      setDetailState("unavailable");
    }
  }, []);

  const beginDetailLoad = useCallback((id: string) => {
    const token = ++detailRequest.current;
    setSelectedId(id);
    setDetail(null);
    setDraft(EMPTY_DRAFT);
    setConflict(null);
    setPending(null);
    setMessage(null);
    setDetailState("loading");
    setMobilePane("detail");
    const url = new URL(window.location.href);
    url.searchParams.set("view", "theses");
    url.searchParams.set("thesis", id);
    url.searchParams.delete("symbol");
    window.history.replaceState(null, "", url.toString());
    void loadDetail(id, token);
  }, [loadDetail]);

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

  const startNew = useCallback(() => {
    detailRequest.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailState("idle");
    setSubjectDraft(seededSymbol);
    setDraft(EMPTY_DRAFT);
    setConflict(null);
    setPending(null);
    setMessage(null);
    setMobilePane("detail");
    const url = new URL(window.location.href);
    url.searchParams.set("view", "theses");
    url.searchParams.delete("thesis");
    window.history.replaceState(null, "", url.toString());
  }, [seededSymbol]);

  const backToList = useCallback(() => {
    detailRequest.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailState("idle");
    setSubjectDraft("");
    setDraft(EMPTY_DRAFT);
    setConflict(null);
    setPending(null);
    setMessage(null);
    setMobilePane("list");
    const url = new URL(window.location.href);
    url.searchParams.set("view", "theses");
    url.searchParams.delete("thesis");
    url.searchParams.delete("symbol");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const changeDraft = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPending(null);
    setConflict(null);
    setMessage(null);
  }, []);

  const mutationBody = useCallback((action: ThesisAction, requestId: string): Record<string, unknown> | null => {
    const symbol = detail?.subject.key ?? normalizeAnalysisSymbol(subjectDraft);
    if (!symbol || !draft.title.trim() || !draft.statement.trim()) return null;
    return {
      action,
      ...(selectedId ? { id: selectedId, expectedVersion: detail?.currentVersion ?? 0 } : {}),
      clientRequestId: requestId,
      subject: detail?.subject ?? listingSubject(symbol),
      content: buildContent(draft),
    };
  }, [detail, draft, selectedId, subjectDraft]);

  const consumeResponse = useCallback(async (response: Response, pendingMutation: Pending) => {
    let payload: Record<string, unknown>;
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      setSaving(false);
      setPending(pendingMutation);
      setMessage(copy.ambiguous);
      return;
    }
    setSaving(false);
    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      setPending(pendingMutation);
      setMessage(copy.ambiguous);
      return;
    }
    setPending(null);
    if (response.status === 401) return setListState("session_expired");
    if (response.status === 409 && payload.error === "version_conflict") {
      const currentVersion = payload.currentVersion;
      const lifecycleState = payload.lifecycleState;
      if (typeof currentVersion !== "number" || !Number.isInteger(currentVersion) || currentVersion < 1
        || (lifecycleState !== "active" && lifecycleState !== "archived" && lifecycleState !== "invalidated")) {
        setMessage(copy.invalid);
        return;
      }
      setConflict({ currentVersion, lifecycleState });
      return;
    }
    if (!response.ok) {
      setMessage(payload.error === "invalid_transition" ? copy.transition : copy.invalid);
      return;
    }
    const id = payload.thesisId;
    const version = payload.version;
    if (!isUuid(id) || typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      setPending(pendingMutation);
      setMessage(copy.ambiguous);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("view", "theses");
    url.searchParams.set("thesis", id);
    url.searchParams.delete("symbol");
    window.history.replaceState(null, "", url.toString());
    setSelectedId(id);
    setMobilePane("detail");
    setMessage(`${copy.saved} ${version}${payload.replayed ? ` · ${copy.replayed}` : ""}`);
    await loadList();
    await loadDetail(id);
  }, [copy.ambiguous, copy.invalid, copy.replayed, copy.saved, copy.transition, loadDetail, loadList]);

  const send = useCallback(async (pendingMutation: Pending) => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/theses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pendingMutation.body),
      });
      await consumeResponse(response, pendingMutation);
    } catch {
      setSaving(false);
      setPending(pendingMutation);
      setMessage(copy.ambiguous);
    }
  }, [consumeResponse, copy.ambiguous]);

  const submit = useCallback((action: ThesisAction) => {
    const body = mutationBody(action, crypto.randomUUID());
    if (!body) return setMessage(copy.invalid);
    const next = { action, body };
    setPending(next);
    void send(next);
  }, [copy.invalid, mutationBody, send]);

  const copyDraft = useCallback(async () => {
    await navigator.clipboard.writeText(JSON.stringify({ subject: detail?.subject ?? subjectDraft, ...draft }, null, 2));
    setMessage(copy.draftCopied);
  }, [copy.draftCopied, detail?.subject, draft, subjectDraft]);

  const reloadAfterConflict = useCallback(() => {
    if (!selectedId || !window.confirm(copy.confirmReload)) return;
    beginDetailLoad(selectedId);
    void loadList();
  }, [beginDetailLoad, copy.confirmReload, loadList, selectedId]);

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setMessage(copy.copied);
  }, [copy.copied]);

  const lifecycle = detail?.lifecycleState ?? "active";
  const editable = !detail || lifecycle === "active";
  const ambiguous = !!pending && !saving;
  const history = useMemo(() => detail?.history ?? [], [detail?.history]);

  if (invalidLink) {
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
          <button type="button" className={styles.primaryButton} onClick={startNew}>{copy.newThesis}</button>
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
                <button key={thesis.id} type="button" className={selectedId === thesis.id ? styles.selected : ""} onClick={() => beginDetailLoad(thesis.id)}>
                  <span><b>{thesis.subject.key}</b><i data-state={thesis.lifecycleState}>{statusLabel(thesis.lifecycleState, copy)}</i></span>
                  <strong>{thesis.title}</strong><small>{copy.version} {thesis.currentVersion}</small>
                </button>
              ))}
            </div>
            {truncated && <p className={styles.muted}>{copy.moreTheses}</p>}
          </aside>

          <section className={styles.editorPane} data-testid="thesis-detail-pane">
            <button type="button" className={styles.mobileBack} onClick={backToList}>{copy.backToList}</button>
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
                    {pending && !saving && <button className={styles.retrySame} onClick={() => void send(pending)}>{copy.retrySame}</button>}

                    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(selectedId ? "revise" : "create"); }}>
                      <label>{copy.subject}<input aria-label={copy.subject} value={detail?.subject.key ?? subjectDraft} disabled={!!detail || ambiguous} onChange={(event) => { setSubjectDraft(event.target.value.toUpperCase()); setPending(null); }} placeholder="NVDA" /></label>
                      <label>{copy.titleLabel}<input aria-label={copy.titleLabel} value={draft.title} disabled={!editable || ambiguous} maxLength={160} onChange={(event) => changeDraft("title", event.target.value)} /></label>
                      <label className={styles.full}>{copy.statement}<textarea aria-label={copy.statement} value={draft.statement} disabled={!editable || ambiguous} maxLength={12000} rows={8} onChange={(event) => changeDraft("statement", event.target.value)} /></label>
                      {(["catalysts", "falsifiers", "risks"] as const).map((field) => <label key={field}>{copy[field]}<small>{copy.onePerLine}</small><textarea aria-label={copy[field]} value={draft[field]} disabled={!editable || ambiguous} rows={5} onChange={(event) => changeDraft(field, event.target.value)} /></label>)}
                      <label>{copy.horizon}<select aria-label={copy.horizon} value={draft.horizon} disabled={!editable || ambiguous} onChange={(event) => changeDraft("horizon", event.target.value as ThesisHorizon)}>{(["unspecified", "days", "weeks", "months", "quarters", "years"] as ThesisHorizon[]).map((value) => <option key={value} value={value}>{HORIZON_LABELS[lang][value]}</option>)}</select></label>
                      <label>{copy.effective}<input aria-label={copy.effective} type="datetime-local" value={draft.effectiveAt} disabled={!editable || ambiguous} onChange={(event) => changeDraft("effectiveAt", event.target.value)} /></label>
                      <label className={styles.full}>{copy.revision}<textarea aria-label={copy.revision} value={draft.revisionNote} disabled={ambiguous} maxLength={1000} rows={3} onChange={(event) => changeDraft("revisionNote", event.target.value)} /></label>
                      <div className={`${styles.actions} ${styles.full}`}>
                        {editable && <button className={styles.primaryButton} type="submit" disabled={saving || ambiguous}>{saving ? copy.saving : copy.save}</button>}
                        {detail && lifecycle === "active" && <><button type="button" disabled={saving || ambiguous} onClick={() => submit("archive")}>{copy.archive}</button><button type="button" className={styles.dangerButton} disabled={saving || ambiguous} onClick={() => submit("invalidate")}>{copy.invalidate}</button></>}
                        {detail && lifecycle !== "active" && <button type="button" className={styles.primaryButton} disabled={saving || ambiguous} onClick={() => submit("reopen")}>{copy.reopen}</button>}
                      </div>
                    </form>

                    {detail && <section className={styles.history} aria-label={copy.history}><div className={styles.historyHeading}><h2>{copy.history}</h2><span>{detail.history.length}</span></div>{history.map((entry) => <article key={entry.id} data-version={entry.version}><div><b>v{entry.version}</b><span>{TRANSITION_LABELS[lang][entry.transition]}</span><i data-state={entry.lifecycleState}>{statusLabel(entry.lifecycleState, copy)}</i></div><time dateTime={entry.systemRecordedAt}>{new Date(entry.systemRecordedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}</time><strong>{entry.content.title}</strong><p>{entry.content.revisionNote || copy.lines}{entry.effectiveAt && <span className={styles.effectiveAt}>{copy.effectiveHistory}: <time dateTime={entry.effectiveAt}>{new Date(entry.effectiveAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}</time></span>}</p></article>)}{detail.historyTruncated && <p className={styles.muted}>{copy.historyTruncated}</p>}</section>}
                  </>}
          </section>
        </div>
      )}
    </main>
  );
}
