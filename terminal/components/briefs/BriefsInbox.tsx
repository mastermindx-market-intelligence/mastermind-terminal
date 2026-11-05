"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  isUuid,
  isBriefCadence,
  isBriefTargetKind,
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

function readObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readableSubscription(value: unknown): value is BriefSubscription {
  return readObject(value)
    && typeof value.subscriptionId === "string" && !!value.subscriptionId
    && isBriefTargetKind(value.targetKind)
    && typeof value.targetId === "string" && !!value.targetId
    && isBriefCadence(value.cadence)
    && (value.state === "active" || value.state === "paused")
    && (value.targetName === undefined || typeof value.targetName === "string");
}

function readableDelivery(value: unknown): value is PinnedDelivery {
  // Admit the row envelope separately from body validation. A ready row with
  // unavailable content retains its identity and does not become a missed run.
  return readObject(value)
    && typeof value.deliveryId === "string" && !!value.deliveryId
    && typeof value.slotAsof === "string" && !!value.slotAsof
    && (value.state === "ready" || value.state === "degraded")
    && (value.pinned === undefined || typeof value.pinned === "boolean")
    && readObject(value.subscription)
    && isBriefCadence(value.subscription.cadence)
    && (value.subscription.state === "active" || value.subscription.state === "paused")
    && (value.subscription.targetName === undefined || typeof value.subscription.targetName === "string");
}

export default function BriefsInbox({ lang }: { lang: BriefLang }) {
  const L: BriefLang = lang === "zh" ? "zh" : "en";
  const [rows, setRows] = useState<PinnedDelivery[] | null>(null);
  const [subs, setSubs] = useState<BriefSubscription[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [subsUnavailable, setSubsUnavailable] = useState(false);
  const [updates, setUpdates] = useState<Record<string, { phase: "pending" | "checking" | "unknown" | "observed"; unconfirmed: boolean }>>({});
  const mounted = useRef(false);
  const busy = useRef(new Set<string>());
  const versions = useRef<Record<string, number>>({});
  const subscriptionRead = useRef(0);
  const deliveryRead = useRef(0);
  const targetRead = useRef(0);
  const [targets, setTargets] = useState<BriefTargetOption[] | null>(null);
  const [targetsUnavailable, setTargetsUnavailable] = useState(false);
  const [draftTarget, setDraftTarget] = useState("");
  const [draftCadence, setDraftCadence] = useState<BriefCadence>("daily_after_us_close");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState(false);

  const load = useCallback(async () => {
    if (!mounted.current) return;
    const read = ++deliveryRead.current;
    const owns = () => mounted.current && read === deliveryRead.current;
    setDeliveryLoading(true);
    try {
      const r = await fetch("/api/briefs/deliveries?limit=40");
      if (!owns()) return;
      if (!r.ok) { setRows(null); setUnavailable(true); return; }
      const body = await r.json() as { deliveries?: PinnedDelivery[] } | null;
      if (!owns()) return;
      if (!Array.isArray(body?.deliveries) || !body.deliveries.every(readableDelivery)) throw new Error("Delivery read unavailable");
      setRows(body.deliveries);
      setUnavailable(false);
    } catch {
      if (!owns()) return;
      setRows(null);
      setUnavailable(true);
    } finally {
      if (owns()) setDeliveryLoading(false);
    }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    const read = ++subscriptionRead.current;
    const atStart = { ...versions.current };
    const currentRead = () => mounted.current && read === subscriptionRead.current;
    const protectedRow = (id: string) => busy.current.has(id)
      || (versions.current[id] || 0) !== (atStart[id] || 0);
    const fail = () => {
      if (!currentRead() || Object.keys(versions.current).some(protectedRow)) return;
      setSubs(null); setSubsUnavailable(true);
    };
    try {
      const r = await fetch("/api/briefs/subscriptions");
      if (!r.ok) { fail(); return; }
      const body = await r.json() as { subscriptions?: BriefSubscription[] } | null;
      if (!currentRead()) return;
      if (!Array.isArray(body?.subscriptions) || !body.subscriptions.every(readableSubscription)) throw new Error("Subscription read unavailable");
      const incoming = body.subscriptions;
      setSubs((current) => {
        const next = incoming.map((sub) => protectedRow(sub.subscriptionId)
          ? current?.find((old) => old.subscriptionId === sub.subscriptionId) || sub : sub);
        for (const old of current || []) {
          if (protectedRow(old.subscriptionId) && !next.some((sub) => sub.subscriptionId === old.subscriptionId)) next.push(old);
        }
        return next;
      });
      setSubsUnavailable(false);
    } catch {
      fail();
    }
  }, []);

  const loadTargets = useCallback(async () => {
    if (!mounted.current) return;
    const read = ++targetRead.current;
    const owns = () => mounted.current && read === targetRead.current;
    // Settle each owned endpoint independently: an unreadable sibling cannot erase
    // usable targets, and a readable empty sibling cannot prove a complete empty set.
    const readKind = async (kind: BriefTargetKind): Promise<{ readable: boolean; options: BriefTargetOption[] }> => {
      try {
        const response = await fetch(kind === "watchlist" ? "/api/watchlist" : "/api/theses");
        if (!response.ok) return { readable: false, options: [] };
        const body = await response.json() as Record<string, unknown> | null;
        const rows = body?.[kind === "watchlist" ? "lists" : "theses"];
        if (!Array.isArray(rows)) return { readable: false, options: [] };
        const options: BriefTargetOption[] = [];
        for (const row of rows) {
          if (!readObject(row)) return { readable: false, options: [] };
          if (kind === "thesis") {
            if (row.lifecycleState === "archived" || row.lifecycleState === "invalidated") continue;
            if (row.lifecycleState !== "active") return { readable: false, options: [] };
          }
          const name = kind === "watchlist" ? row.name : row.title;
          if (typeof row.id !== "string" || !row.id || typeof name !== "string" || !name.trim()) {
            return { readable: false, options: [] };
          }
          options.push({ kind, id: row.id, name: name.trim() });
        }
        return { readable: true, options };
      } catch {
        return { readable: false, options: [] };
      }
    };
    const results = await Promise.all([readKind("watchlist"), readKind("thesis")]);
    if (!owns()) return;
    const options = results.flatMap((result) => result.options);
    setTargets(options);
    setTargetsUnavailable(results.some((result) => !result.readable));
    setDraftTarget((current) => {
      if (options.some((target) => targetOptionKey(target) === current)) return current;
      return options[0] ? targetOptionKey(options[0]) : "";
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    void loadSubscriptions();
    void loadTargets();
    return () => {
      mounted.current = false;
      deliveryRead.current += 1;
      subscriptionRead.current += 1;
      targetRead.current += 1;
      for (const id of Object.keys(versions.current)) versions.current[id] += 1;
      busy.current.clear();
    };
  }, [load, loadSubscriptions, loadTargets]);

  async function reconcileSubscription(id: string, version: number, unconfirmed: boolean) {
    const owns = () => mounted.current && versions.current[id] === version;
    try {
      const r = await fetch("/api/briefs/subscriptions", { cache: "no-store" });
      if (!r.ok) throw new Error("Subscription read unavailable");
      const body = await r.json() as { subscriptions?: BriefSubscription[] };
      const latest = Array.isArray(body.subscriptions)
        ? body.subscriptions.find((sub) => readableSubscription(sub) && sub.subscriptionId === id) : undefined;
      if (!latest) {
        throw new Error("Subscription state unavailable");
      }
      if (!owns()) return;
      setSubs((current) => current?.map((sub) => sub.subscriptionId === id ? latest : sub) || current);
      setUpdates((current) => {
        const next = { ...current };
        if (unconfirmed) next[id] = { phase: "observed", unconfirmed: true };
        else delete next[id];
        return next;
      });
    } catch {
      if (owns()) setUpdates((current) => ({ ...current, [id]: { phase: "unknown", unconfirmed } }));
    } finally {
      if (owns()) {
        busy.current.delete(id);
        // Fence collection reads started while this row's update/read was pending.
        versions.current[id] += 1;
      }
    }
  }

  async function changeSubscription(sub: BriefSubscription, action: "pause" | "resume") {
    const id = sub.subscriptionId;
    if (busy.current.has(id) || updates[id]?.phase === "unknown") return;
    busy.current.add(id);
    const version = versions.current[id] = (versions.current[id] || 0) + 1;
    setUpdates((current) => ({ ...current, [id]: { phase: "pending", unconfirmed: false } }));
    let unconfirmed = true;
    try {
      const r = await fetch("/api/briefs/subscriptions/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: action }),
      });
      unconfirmed = !r.ok;
    } catch {
      // A lost reply does not establish whether the update committed. Never replay it.
    }
    if (!mounted.current || versions.current[id] !== version) return;
    setUpdates((current) => ({ ...current, [id]: { phase: "checking", unconfirmed } }));
    await reconcileSubscription(id, version, unconfirmed);
  }

  async function checkSubscription(id: string) {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    const version = versions.current[id] = (versions.current[id] || 0) + 1;
    const unconfirmed = updates[id]?.unconfirmed || false;
    setUpdates((current) => ({ ...current, [id]: { phase: "checking", unconfirmed } }));
    await reconcileSubscription(id, version, unconfirmed);
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
    <div id="briefs" className={s.module} data-testid="briefs-inbox" data-briefs-module="inbox">
      <div className={s.moduleHead}>
        <span>{briefCopy("title", L)}</span>
        {rows && rows.length > 0 && (
          <span className={s.moduleCount}>{rows.length}</span>
        )}
      </div>
      <p className={b.deliveryNote} data-testid="briefs-email-null">{briefCopy("emailNull", L)}</p>

      <section className={b.briefSection} data-testid="briefs-new-schedule">
        <div className={b.sectionHead}><span>{briefCopy("newScheduleTitle", L)}</span></div>
        {targetsUnavailable && <p className={s.calmBody}>{briefCopy(targets?.length ? "targetsPartial" : "targetsUnavailable", L)}</p>}
        {!targetsUnavailable && targets && targets.length === 0 && (
          <p className={s.calmBody}>{briefCopy("noTargets", L)}</p>
        )}
        {targets && targets.length > 0 && (
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
              const update = updates[sub.subscriptionId];
              const uncertain = !!update && update.phase !== "observed";
              const disabled = update?.phase === "pending" || update?.phase === "checking";
              return (
                <div className={b.scheduleRow} key={sub.subscriptionId} data-brief-schedule="">
                  <div className={b.scheduleIdentity}>
                    <strong data-brief-schedule-name="">{targetLabel(sub)}</strong>
                    <span>{briefCopy(sub.targetKind === "watchlist" ? "watchlistKind" : "thesisKind", L)}</span>
                  </div>
                  <span className={b.cadence}>{briefCadenceLabel(sub.cadence, L)}</span>
                  <span className={b.stateChip} data-state={uncertain ? "unknown" : paused ? "paused" : "active"}>
                    {briefCopy(uncertain ? "stateUnknown" : paused ? "paused" : "on", L)}
                  </span>
                  <div className={b.cadenceActions}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => uncertain ? void checkSubscription(sub.subscriptionId) : void changeSubscription(sub, paused ? "resume" : "pause")}
                    >
                      {briefCopy(uncertain ? "checkStatus" : paused ? "resume" : "pause", L)}
                    </button>
                    {update?.phase === "observed" && (
                      <button type="button" onClick={() => void checkSubscription(sub.subscriptionId)}>
                        {briefCopy("checkStatus", L)}
                      </button>
                    )}
                    {update && (
                      <span role="status" data-brief-update={update.phase}>
                        {briefCopy(update.phase === "observed" ? "updateObserved" : update.unconfirmed ? "updateUnconfirmed" : "scheduleReadPending", L)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={b.briefSection} data-testid="briefs-delivered" aria-busy={deliveryLoading}>
        <div className={b.sectionHead}><span>{briefCopy("deliveredTitle", L)}</span></div>
      {unavailable && (
        <>
          <p className={s.calmBody}>{briefCopy("unavailable", L)}</p>
          <button type="button" className={`btn btn-ghost ${s.emptyAction}`} onClick={() => void load()}>
            {briefCopy(deliveryLoading ? "retrying" : "retry", L)}
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
                {!miss && body && isUuid(row.deliveryId) && <a className={`btn btn-ghost ${b.reviewSharing}`} href={`/briefs/${row.deliveryId}/sharing`}>{briefCopy("reviewSharing", L)}</a>}
                <span className={b.cadence} data-brief-cadence="">{briefCadenceLabel(row.subscription.cadence, L)}</span>
                {row.pinned && <span className={b.pinned}>{briefCopy("lastGood", L)}</span>}
                {miss ? (
                  <span className={b.sentence} data-brief-sentence="">{degradedLine(row.subscription.cadence, L)}</span>
                ) : (
                  <span className={b.sentence} data-brief-sentence="" data-brief-content-unavailable={!body ? "true" : undefined}>
                    {body ? `${sentences.join(" ")} · ${monitorsSummary(body, L)}` : briefCopy("contentUnavailable", L)}
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
