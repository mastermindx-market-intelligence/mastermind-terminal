"use client";
/** Explicit current-user issuance. Selecting a team or reading a preview does not issue. */
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { decodeSharingRequestRecord } from "@/lib/briefSharingRequests";
import type { SharingReview } from "@/lib/briefDeliverySharing";
import s from "./brief-sharing.module.css";
export default function BriefSharingRequestIssuer({ review, onBegin }: { review: SharingReview; onBegin?: () => void }) {
  const { lang } = useLang(), zh = lang === "zh";
  const [requestRef] = useState(() => crypto.randomUUID());
  const [unknown, setUnknown] = useState(false), [pending, setPending] = useState(false);
  const [preflight, setPreflight] = useState(false);
  const spent = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const issue = () => {
    if (spent.current || !review.eligibility.can_share || review.grant !== null) return;
    const selected = { delivery_id: review.delivery.delivery_id, request_ref: requestRef, revision: 1 as const };
    const url = new URL(window.location.href);
    try {
      if (url.pathname !== `/briefs/${selected.delivery_id}/sharing` || url.search) throw new Error("address_unavailable");
      url.searchParams.set("request", requestRef); url.searchParams.set("revision", "1");
      url.searchParams.set("attempt", "ISSUE"); url.searchParams.set("request_team_id", review.audience.team_id);
      url.searchParams.set("expected_content_sha256", review.delivery.content_sha256);
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
      if (window.location.pathname + window.location.search !== url.pathname + url.search) throw new Error("address_unavailable");
    } catch { setPreflight(true); return; }
    spent.current = true; onBegin?.(); setPending(true);
    const abort = new AbortController(), deadline = setTimeout(() => abort.abort(), 15000);
    void (async () => {
      try {
        const response = await fetch(`/api/briefs/deliveries/${selected.delivery_id}/sharing-request`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, signal: abort.signal, body: JSON.stringify({ action: "ISSUE", request_ref: requestRef, team_id: review.audience.team_id, expected_content_sha256: review.delivery.content_sha256 }) });
        if (!alive.current || !response.ok) throw new Error("request_outcome_unknown");
        const record = decodeSharingRequestRecord(await response.json(), selected);
        if (!record || record.review.delivery.content_sha256 !== review.delivery.content_sha256 || record.review.audience.team_id !== review.audience.team_id) throw new Error("request_outcome_unknown");
        if (alive.current) window.location.assign(`/briefs/${selected.delivery_id}/sharing?request=${requestRef}&revision=1`);
      } catch { if (alive.current) setUnknown(true); }
      finally { clearTimeout(deadline); if (alive.current) setPending(false); }
    })();
  };
  return <div className={s.actions} data-brief-sharing-request-issuer="">
    {!unknown && <button type="button" className={s.control} disabled={pending || spent.current} onClick={issue}>{zh ? "稍后在收件箱中查看" : "Review later in Inbox"}</button>}
    {preflight && <p role="alert" className={s.note}>{zh ? "无法保留这次请求的地址，未发送请求。" : "The original request address could not be retained. Nothing was sent."}</p>}
    {unknown && <><p className={s.note}>{zh ? "这次原有请求的结果尚未确认，请检查原有请求，不要重新发送。" : "The outcome of this original request is not confirmed. Check it without sending again."}</p><a className={s.control} href={`/briefs/${review.delivery.delivery_id}/sharing?request=${requestRef}&revision=1&attempt=ISSUE&request_team_id=${review.audience.team_id}&expected_content_sha256=${review.delivery.content_sha256}`}>{zh ? "检查原有请求" : "Check original request"}</a></>}
  </div>;
}
