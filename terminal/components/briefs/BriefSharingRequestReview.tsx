"use client";
/** Exact issued request: its owner fixes the brief, content and intended team. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useReadingScope } from "@/lib/shared-shell/useReadingScope";
import { decodeSharingRequestRecord, type SharingRequestRecord, type SharingRequestSelection } from "@/lib/briefSharingRequests";
import { decodeSharingReceipt, type Receipt } from "@/lib/briefDeliverySharing";
import s from "./brief-sharing.module.css";
type Action = "SHARE" | "KEEP_PRIVATE";
type OriginalAction = Action | "ISSUE";
export interface BriefSharingRequestReviewProps {
  selected: SharingRequestSelection; principalId: string;
  originalAction: OriginalAction | null; originalEffect: string | null;
  originalIssue?: { team_id: string; content_sha256: string } | null;
}
export default function BriefSharingRequestReview(props: BriefSharingRequestReviewProps) {
  const identity = useShellIdentity(), { lang } = useLang();
  const id = identity.kind === "account" ? identity.userId : "";
  const scope = useReadingScope(id === props.principalId ? id : "");
  if (!scope.ready) return <section className={s.wrap} aria-live="polite"><p>{lang === "zh" ? "正在核对这次分享请求的账户。" : "Checking the account for this sharing request."}</p></section>;
  return <RequestLifecycle key={[id, props.principalId, props.selected.delivery_id, props.selected.request_ref, props.selected.revision].join("|")} {...props} zh={lang === "zh"} />;
}
function RequestLifecycle({ selected, principalId, originalAction, originalEffect, originalIssue, zh }: BriefSharingRequestReviewProps & { zh: boolean }) {
  const t = (en: string, cn: string) => zh ? cn : en;
  const [record, setRecord] = useState<SharingRequestRecord | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failed, setFailed] = useState(false), [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState<OriginalAction | null>(originalAction);
  const [pending, setPending] = useState(false), [bodyOpen, setBodyOpen] = useState(false);
  const [unknown, setUnknown] = useState(originalAction !== null);
  const spent = useRef(originalAction !== null), alive = useRef(true), issueQualified = useRef(false);
  const reads = useRef(new Set<AbortController>());
  const route = `/api/briefs/deliveries/${selected.delivery_id}/sharing-request`;
  const selectionQuery = `request_ref=${selected.request_ref}&revision=1`;
  const read = useCallback(async () => {
    const controller = new AbortController(); reads.current.add(controller);
    setLoading(true); setFailed(false); setRecord(null); setReceipt(null);
    try {
      const response = await fetch(`${route}?${selectionQuery}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || !alive.current) return;
      if (!response.ok) throw new Error("request_unavailable");
      const value = decodeSharingRequestRecord(await response.json(), selected);
      if (controller.signal.aborted || !alive.current) return;
      if (!value || (originalEffect !== null && value.review.expected_effect_sha256 !== originalEffect)) throw new Error("request_changed");
      setRecord(value);
      if (originalAction === "ISSUE" && !issueQualified.current) {
        if (!originalIssue || value.review.audience.team_id !== originalIssue.team_id || value.review.delivery.content_sha256 !== originalIssue.content_sha256) throw new Error("original_issue_conflicts");
        const url = new URL(window.location.href);
        if (url.pathname !== `/briefs/${selected.delivery_id}/sharing` || url.searchParams.get("request") !== selected.request_ref || url.searchParams.get("attempt") !== "ISSUE") throw new Error("original_issue_address_changed");
        url.searchParams.delete("attempt"); url.searchParams.delete("request_team_id"); url.searchParams.delete("expected_content_sha256");
        window.history.replaceState(window.history.state, "", url.pathname + url.search);
        if (new URL(window.location.href).searchParams.has("attempt")) throw new Error("original_issue_address_unavailable");
        issueQualified.current = true; spent.current = false; setAttempted(null); setUnknown(false);
      }
      if (value.disposition === "KEPT_PRIVATE") setUnknown(false);
      if (value.disposition === "SHARED") {
        const expected = value.review.expected_effect_sha256;
        const result = await fetch(`/api/briefs/deliveries/${selected.delivery_id}/sharing?expected_effect_sha256=${expected}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted || !alive.current) return;
        if (!result.ok) throw new Error("receipt_unavailable");
        const observed = decodeSharingReceipt(await result.json(), selected.delivery_id, expected);
        if (controller.signal.aborted || !alive.current) return;
        if (!observed || observed.observation !== "MATCHED" || observed.grant?.shared_by !== principalId || observed.grant.content_sha256 !== value.review.delivery.content_sha256 || observed.grant.team_id !== value.review.audience.team_id) throw new Error("receipt_unavailable");
        setReceipt(observed); setUnknown(false);
      }
    } catch { if (!controller.signal.aborted && alive.current) { setFailed(true); setRecord(null); setReceipt(null); } }
    finally { reads.current.delete(controller); if (alive.current) setLoading(false); }
  }, [route, selectionQuery, selected, principalId, originalEffect, originalAction, originalIssue]);
  useEffect(() => { alive.current = true; void read(); const owned = reads.current; return () => { alive.current = false; for (const c of owned) c.abort(); owned.clear(); }; }, [read]);
  const send = (action: Action) => {
    if (spent.current || pending || !record || record.disposition !== "OPEN" || !record.review.eligibility.can_share) return;
    const review = record.review;
    try {
      const url = new URL(window.location.href);
      if (url.pathname !== `/briefs/${selected.delivery_id}/sharing` || url.searchParams.getAll("request").length !== 1 || url.searchParams.get("request") !== selected.request_ref || url.searchParams.getAll("revision").length !== 1 || url.searchParams.get("revision") !== "1" || url.searchParams.has("attempt")) throw new Error("original_address_unavailable");
      url.searchParams.set("attempt", action);
      if (action === "SHARE") url.searchParams.set("expected_effect_sha256", review.expected_effect_sha256);
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
      const actual = new URL(window.location.href);
      if (actual.searchParams.get("attempt") !== action || (action === "SHARE" && actual.searchParams.get("expected_effect_sha256") !== review.expected_effect_sha256)) throw new Error("original_address_unavailable");
    } catch { setFailed(true); return; }
    spent.current = true; setAttempted(action); setPending(true); setUnknown(true);
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try {
        const command = { action, request_ref: selected.request_ref, revision: 1, expected_content_sha256: review.delivery.content_sha256, ...(action === "SHARE" ? { expected_effect_sha256: review.expected_effect_sha256 } : {}) };
        const response = await fetch(route, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: controller.signal });
        if (!alive.current || !response.ok) return;
        const value = decodeSharingRequestRecord(await response.json(), selected);
        if (!alive.current || !value || value.review.delivery.content_sha256 !== review.delivery.content_sha256 || value.review.audience.team_id !== review.audience.team_id || value.disposition !== (action === "SHARE" ? "SHARED" : "KEPT_PRIVATE")) return;
        // Read the original owner state/receipt. A POST response alone does not establish team access.
        await read();
      } catch { /* Ambiguous original stays spent; only an explicit same-request read follows. */ }
      finally { clearTimeout(deadline); if (alive.current) setPending(false); }
    })();
  };
  const shared = record?.disposition === "SHARED" && receipt?.observation === "MATCHED" && receipt.current_access;
  const kept = record?.disposition === "KEPT_PRIVATE" && record.review.grant === null;
  const closed = record?.disposition !== "OPEN";
  const title = unknown ? t("We couldn't confirm what happened.", "无法确认结果。") : shared ? t("Shared with your team.", "已与你的团队分享。") : kept ? t("Kept private.", "已保持私有。") : record?.disposition === "SHARED" ? t("Sharing recorded.", "分享已记录。") : t("Share the brief?", "分享这份简报？");
  return <div lang={zh ? "zh" : "en"} className={s.wrap} data-brief-sharing-request="" aria-busy={loading || pending}>
    <header className={s.head}><span className={s.eyebrow}>Terminal</span><h1 className={s.heading}>{title}</h1>
      <p className={s.lede}>{unknown ? t("Check this original request. Do not send another request.", "请检查这次原有请求，不要重新发送。") : shared ? t("The view-only grant is active for the team's current members.", "只读授权目前对团队现有成员生效。") : kept ? t("This request was closed without granting team access.", "这次请求已关闭，未授予团队访问权限。") : t("Review the brief and the team named in this request.", "请查看这次请求中的简报和指定团队。")}</p></header>
    {failed && <section className={s.panel}><p role="alert">{t("This original request or its current access could not be checked. No further request was sent.", "暂时无法检查这次原有请求或当前访问状态，未再发送请求。")}</p></section>}
    {record && <section className={s.panel}>
      <h2 className={s.artifactTitle}>{record.review.delivery.body.artifact.name}</h2>
      <p className={s.meta}>{record.review.audience.name} · {t("View only", "只读")}</p>
      <p className={s.note}>{t("If shared, current team members can read this brief. Access changes with team membership.", "分享后，团队当前成员可以阅读此简报，访问权限随团队成员变动而变化。")}</p>
      <p className={s.meta}>{t("Brief slot", "简报时段")} {record.review.delivery.slot_asof} · {t("Content as of", "内容截至")} {record.review.delivery.artifact_asof ?? record.review.delivery.body.artifact.asof}</p>
      <button type="button" className={s.toggle} onClick={() => setBodyOpen(!bodyOpen)} aria-expanded={bodyOpen}>{bodyOpen ? t("Close brief", "收起简报") : t("Open brief", "打开简报")}</button>
      {bodyOpen && <div className={s.bodyBlock}>{record.review.delivery.body.market_read.map((line, i) => <p className={s.sentence} key={i}>{zh ? line.sentence_zh : line.sentence_en}</p>)}{record.review.delivery.body.monitors.map((line, i) => <p className={s.monitorRow} key={i}>{line.name} · {zh ? line.state_zh : line.state_en}</p>)}</div>}
      {record.disposition === "SHARED" && !shared && !unknown && <p className={s.note}>{t("Current team access is not established by this read.", "本次读取尚未确认团队当前访问权限。")}</p>}
    </section>}
    <section className={s.composer}><div className={s.actions}>
      {record && !closed && !attempted && <><button type="button" className={s.primary} disabled={pending || !record.review.eligibility.can_share} onClick={() => send("SHARE")}>{t("Share with team", "与团队分享")}</button><button type="button" className={s.secondary} disabled={pending} onClick={() => send("KEEP_PRIVATE")}>{t("Keep private", "保持私有")}</button></>}
      {shared && <a className={s.control} href={`/briefs/shared/${selected.delivery_id}`}>{t("Open team view", "打开团队视图")}</a>}
      {(attempted || failed) && <button type="button" className={s.control} disabled={loading || pending} onClick={() => void read()}>{t("Check original request", "检查原有请求")}</button>}
      <a className={s.control} href="/alerts">{t("Back to Terminal", "返回终端")}</a>
    </div><p className={s.note}>{t("Other project work continues while you decide.", "你可以先处理其他项目工作，之后再决定。")}</p></section>
  </div>;
}
