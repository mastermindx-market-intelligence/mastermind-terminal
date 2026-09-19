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
  type BriefCadence,
  type BriefLang,
  type BriefSubscription,
  type BriefTargetKind,
  type PinnedDelivery,
} from "@/lib/briefs";



type BriefTargetOption = {
  kind: BriefTargetKind;
  id: string;
  name: string;
};

function targetOptionKey(target: Pick<BriefTargetOption, "kind" | "id">): string {
  return target.kind + ":" + target.id;
}

export default function BriefsInbox({ lang }: { lang: BriefLang }) {
  const L: BriefLang = lang === "zh" ? "zh" : "en";
  const [rows, setRows] = useState<PinnedDelivery[] | null>(null);
  const [subs, setSubs] = useState<BriefSubscription[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [subsUnavailable, setSubsUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [targets, setTargets] = useState<BriefTargetOption[] | null>(null);
  const [targetsUnavailable, setTargetsUnavailable] = useState(false);
  const [draftTarget, setDraftTarget] = useState("");
  const [draftCadence, setDraftCadence] = useState<BriefCadence>("daily_after_us_close");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState(false);

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

  const loadTargets = useCallback(async () => {
    try {
      const [watchlistsResponse, thesesResponse] = await Promise.all([
        fetch("/api/watchlist"),
        fetch("/api/theses"),
      ]);
      const options: BriefTargetOption[] = [];

      if (watchlistsResponse.ok) {
        const body = await watchlistsResponse.json() as {
          lists?: Array<{ id?: string; name?: string }>;
        };
        for (const row of body.lists || []) {
          if (typeof row.id === "string" && typeof row.name === "string" && row.name.trim()) {
            options.push({ kind: "watchlist", id: row.id, name: row.name.trim() });
          }
        }
      }

      if (thesesResponse.ok) {
        const body = await thesesResponse.json() as {
          theses?: Array<{ id?: string; title?: string; lifecycleState?: string }>;
        };
        for (const row of body.theses || []) {
          if (
            row.lifecycleState === "active"
            && typeof row.id === "string"
            && typeof row.title === "string"
            && row.title.trim()
          ) {
            options.push({ kind: "thesis", id: row.id, name: row.title.trim() });
          }
        }
      }

      const bothSignedOut = watchlistsResponse.status === 401 && thesesResponse.status === 401;
      const anyReadable = watchlistsResponse.ok || thesesResponse.ok || bothSignedOut;
      setTargets(options);
      setTargetsUnavailable(!anyReadable);
      setDraftTarget((current) => {
        if (options.some((target) => targetOptionKey(target) === current)) return current;
        return options[0] ? targetOptionKey(options[0]) : "";
      });
    } catch {
      setTargets(null);
      setTargetsUnavailable(true);
      setDraftTarget("");
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSubscriptions();
    void loadTargets();
  }, [load, loadSubscriptions, loadTargets]);

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

  const selectedTarget = (targets || []).find((target) => targetOptionKey(target) === draftTarget) || null;
  const duplicateDraft = !!selectedTarget && !!(subs || []).find(
    (sub) => sub.targetKind === selectedTarget.kind
      && sub.targetId === selectedTarget.id
      && sub.cadence === draftCadence,
  );

  async function addSchedule() {
    if (!selectedTarget || duplicateDraft) return;
    setCreateBusy(true);
    setCreateError(false);
    try {
      const r = await fetch("/api/briefs/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_kind: selectedTarget.kind,
          target_id: selectedTarget.id,
          cadence: draftCadence,
        }),
      });
      if (r.ok || r.status === 409) {
        await loadSubscriptions();
      } else {
        setCreateError(true);
      }
    } catch {
      setCreateError(true);
    } finally {
      setCreateBusy(false);
    }
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

      <section className={b.briefSection} data-testid="briefs-new-schedule">
        <div className={b.sectionHead}><span>{briefCopy("newScheduleTitle", L)}</span></div>
        {targetsUnavailable && <p className={s.calmBody}>{briefCopy("targetsUnavailable", L)}</p>}
        {!targetsUnavailable && targets && targets.length === 0 && (
          <p className={s.calmBody}>{briefCopy("noTargets", L)}</p>
        )}
        {!targetsUnavailable && targets && targets.length > 0 && (
          <div className={b.scheduleComposer}>
            <select
              aria-label={briefCopy("scheduleTarget", L)}
              value={draftTarget}
              onChange={(event) => setDraftTarget(event.target.value)}
            >
              {targets.map((target) => (
                <option value={targetOptionKey(target)} key={targetOptionKey(target)}>
                  {briefCopy(target.kind === "watchlist" ? "watchlistKind" : "thesisKind", L)} · {target.name}
                </option>
              ))}
            </select>
            <select
              aria-label={briefCopy("scheduleCadence", L)}
              value={draftCadence}
              onChange={(event) => setDraftCadence(event.target.value as BriefCadence)}
            >
              <option value="daily_after_us_close">{briefCopy("subscribeDaily", L)}</option>
              <option value="weekly_saturday">{briefCopy("subscribeWeekly", L)}</option>
            </select>
            <button
              type="button"
              disabled={createBusy || duplicateDraft}
              onClick={() => void addSchedule()}
            >
              {duplicateDraft ? briefCopy("alreadyScheduled", L) : briefCopy("addSchedule", L)}
            </button>
          </div>
        )}
        {createError && <p className={s.calmBody}>{briefCopy("unavailable", L)}</p>}
      </section>

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
