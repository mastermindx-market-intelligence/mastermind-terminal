"use client";

import { useCallback, useEffect, useState } from "react";
import s from "@/components/alerts/alerts.module.css";
import b from "./briefs.module.css";
import {
  briefCopy,
  briefCadenceLabel,
  degradedLine,
  marketReadSentences,
  monitorsSummary,
  deliveryIsMiss,
  validateBriefBody,
  type BriefLang,
  type BriefSubscription,
  type PinnedDelivery,
} from "@/lib/briefs";

export default function BriefsInbox({ lang }: { lang: BriefLang }) {
  const L: BriefLang = lang === "zh" ? "zh" : "en";
  const [rows, setRows] = useState<PinnedDelivery[] | null>(null);
  const [subs, setSubs] = useState<BriefSubscription[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [subsUnavailable, setSubsUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/briefs/deliveries?limit=40");
      if (r.status === 401) { setRows([]); setUnavailable(false); return; }
      if (!r.ok) { setRows(null); setUnavailable(true); return; }
      const body = await r.json() as { deliveries?: PinnedDelivery[] };
      setRows(body.deliveries || []);
      setUnavailable(false);
    } catch {
      setRows(null);
      setUnavailable(true);
    }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    try {
      const r = await fetch("/api/briefs/subscriptions");
      if (r.status === 401) { setSubs([]); setSubsUnavailable(false); return; }
      if (!r.ok) { setSubs(null); setSubsUnavailable(true); return; }
      const body = await r.json() as { subscriptions?: BriefSubscription[] };
      setSubs(body.subscriptions || []);
      setSubsUnavailable(false);
    } catch {
      setSubs(null);
      setSubsUnavailable(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSubscriptions();
  }, [load, loadSubscriptions]);

  async function changeSubscription(sub: BriefSubscription, action: "pause" | "resume") {
    setBusy(sub.subscriptionId);
    try {
      const r = await fetch("/api/briefs/subscriptions/" + encodeURIComponent(sub.subscriptionId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: action }),
      });
      if (r.ok) {
        await loadSubscriptions();
      }
    } finally {
      setBusy(null);
    }
  }

  function targetLabel(sub: BriefSubscription): string {
    return sub.targetName
      || briefCopy(sub.targetKind === "watchlist" ? "watchlistKind" : "thesisKind", L);
  }

  return (
    <div className={s.module} data-testid="briefs-inbox" data-briefs-module="inbox">
      <div className={s.moduleHead}>
        <span>{briefCopy("title", L)}</span>
        {rows && rows.length > 0 && (
          <span className={s.moduleCount}>{rows.length}</span>
        )}
      </div>
      <p className={b.deliveryNote} data-testid="briefs-email-null">{briefCopy("emailNull", L)}</p>

      <section className={b.briefSection} data-testid="briefs-schedules">
        <div className={b.sectionHead}>
          <span>{briefCopy("scheduledTitle", L)}</span>
          {subs && subs.length > 0 && <span>{subs.length}</span>}
        </div>
        {subsUnavailable && (
          <p className={s.calmBody}>{briefCopy("unavailable", L)}</p>
        )}
        {!subsUnavailable && subs && subs.length === 0 && (
          <p className={s.calmBody} data-briefs-schedules-state="empty">{briefCopy("noSchedules", L)}</p>
        )}
        {!subsUnavailable && subs && subs.length > 0 && (
          <div className={b.scheduleList}>
            {subs.map((sub) => {
              const paused = sub.state === "paused";
              const disabled = busy === sub.subscriptionId;
              return (
                <div className={b.scheduleRow} key={sub.subscriptionId} data-brief-schedule="">
                  <div className={b.scheduleIdentity}>
                    <strong data-brief-schedule-name="">{targetLabel(sub)}</strong>
                    <span>{briefCopy(sub.targetKind === "watchlist" ? "watchlistKind" : "thesisKind", L)}</span>
                  </div>
                  <span className={b.cadence}>{briefCadenceLabel(sub.cadence, L)}</span>
                  <span className={b.stateChip} data-state={paused ? "paused" : "active"}>
                    {briefCopy(paused ? "paused" : "on", L)}
                  </span>
                  <div className={b.cadenceActions}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void changeSubscription(sub, paused ? "resume" : "pause")}
                    >
                      {briefCopy(paused ? "resume" : "pause", L)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={b.briefSection} data-testid="briefs-delivered">
        <div className={b.sectionHead}><span>{briefCopy("deliveredTitle", L)}</span></div>
      {unavailable && (
        <>
          <p className={s.calmBody}>{briefCopy("unavailable", L)}</p>
          <button type="button" className={`btn btn-ghost ${s.emptyAction}`} onClick={() => void load()}>
            {briefCopy("retry", L)}
          </button>
        </>
      )}
      {!unavailable && rows && rows.length === 0 && (
        <p className={s.calmBody} data-briefs-state="empty">{briefCopy("empty", L)}</p>
      )}
      {!unavailable && rows && rows.length > 0 && (
        <div>
          {rows.map((row) => {
            const body = validateBriefBody(row.body);
            const name = body?.target.name || row.subscription.targetName || "—";
            const miss = deliveryIsMiss(row);
            const sentences = body ? marketReadSentences(body, L, 2) : [];
            return (
              <div
                key={row.deliveryId}
                className={b.briefRow}
                data-brief-row=""
                data-brief-miss={miss ? "true" : undefined}
                data-brief-pinned={row.pinned ? "true" : undefined}
              >
                <span className={b.briefName} data-brief-name="">{name}</span>
                <span className={b.briefDate} data-brief-date="">{row.slotAsof}</span>
                <span className={b.cadence} data-brief-cadence="">{briefCadenceLabel(row.subscription.cadence, L)}</span>
                {row.pinned && <span className={b.pinned}>{briefCopy("lastGood", L)}</span>}
                {miss ? (
                  <span className={b.sentence} data-brief-sentence="">{degradedLine(row.subscription.cadence, L)}</span>
                ) : (
                  <span className={b.sentence} data-brief-sentence="">
                    {sentences.join(" ")}
                    {body ? ` · ${monitorsSummary(body, L)}` : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      </section>
    </div>
  );
}
