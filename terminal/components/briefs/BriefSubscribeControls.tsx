"use client";

import { useCallback, useEffect, useState } from "react";
import {
  briefCopy,
  subscriptionIsPaused,
  type BriefCadence,
  type BriefLang,
  type BriefSubscription,
  type BriefTargetKind,
} from "@/lib/briefs";
import s from "./briefs.module.css";

type SubRow = BriefSubscription;

export default function BriefSubscribeControls({
  targetKind,
  targetId,
  listName,
  lang,
}: {
  targetKind: BriefTargetKind;
  targetId?: string | null;
  listName?: string;
  lang: BriefLang;
}) {
  const L: BriefLang = lang === "zh" ? "zh" : "en";
  const [resolvedId, setResolvedId] = useState<string | null>(targetId ?? null);
  const [subs, setSubs] = useState<SubRow[] | null>(null);
  const [busy, setBusy] = useState<BriefCadence | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const resolveWatchlist = useCallback(async () => {
    if (targetKind !== "watchlist" || !listName) return targetId ?? null;
    try {
      const r = await fetch("/api/watchlist");
      if (!r.ok) return targetId ?? null;
      const body = await r.json() as { lists?: Array<{ id?: string; name?: string }> };
      const hit = (body.lists || []).find((row) => row.name === listName && typeof row.id === "string");
      return hit?.id ?? targetId ?? null;
    } catch {
      return targetId ?? null;
    }
  }, [targetKind, listName, targetId]);

  const load = useCallback(async (id: string) => {
    try {
      const r = await fetch(
        "/api/briefs/subscriptions?target_kind=" + encodeURIComponent(targetKind)
          + "&target_id=" + encodeURIComponent(id),
      );
      if (r.status === 401) {
        setSubs([]);
        setUnavailable(false);
        return;
      }
      if (!r.ok) {
        setSubs(null);
        setUnavailable(true);
        return;
      }
      const body = await r.json() as { subscriptions?: SubRow[] };
      setSubs(body.subscriptions || []);
      setUnavailable(false);
    } catch {
      setSubs(null);
      setUnavailable(true);
    }
  }, [targetKind]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const id = targetKind === "watchlist" ? await resolveWatchlist() : (targetId ?? null);
      if (!alive) return;
      setResolvedId(id);
      if (id) void load(id);
      else {
        setSubs([]);
        setUnavailable(false);
      }
    })();
    return () => { alive = false; };
  }, [targetKind, targetId, resolveWatchlist, load]);

  if (!resolvedId) return null;

  if (unavailable) {
    return (
      <div className={s.controls} data-testid="brief-subscribe" data-brief-subscribe-state="unavailable">
        <div className={s.controlsHead}>{briefCopy("controlsTitle", L)}</div>
        <p className={s.controlsNote}>{briefCopy("unavailable", L)}</p>
        <button type="button" className={s.retryButton} onClick={() => void load(resolvedId)}>
          {briefCopy("retry", L)}
        </button>
      </div>
    );
  }

  const byCadence = (cadence: BriefCadence) => (subs || []).find((row) => row.cadence === cadence);

  async function subscribe(cadence: BriefCadence) {
    if (!resolvedId) return;
    setBusy(cadence);
    try {
      const r = await fetch("/api/briefs/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_kind: targetKind, target_id: resolvedId, cadence }),
      });
      if (r.ok || r.status === 409) await load(resolvedId);
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, state: "pause" | "resume", cadence: BriefCadence) {
    setBusy(cadence);
    try {
      const r = await fetch(`/api/briefs/subscriptions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (r.ok && resolvedId) await load(resolvedId);
    } finally {
      setBusy(null);
    }
  }

  function row(cadence: BriefCadence, labelKey: "subscribeDaily" | "subscribeWeekly") {
    const existing = byCadence(cadence);
    const disabled = busy === cadence;
    const sentence = briefCopy(labelKey, L);
    if (!existing) {
      return (
        <div className={s.cadenceRow} key={labelKey}>
          <div className={s.cadenceCopy}>
            <p>{sentence}</p>
          </div>
          <button type="button" disabled={disabled} onClick={() => void subscribe(cadence)}>
            {briefCopy("add", L)}
          </button>
        </div>
      );
    }
    const paused = subscriptionIsPaused(existing);
    return (
      <div className={s.cadenceRow} key={labelKey}>
        <div className={s.cadenceCopy}>
          <p>{sentence}</p>
          <span className={s.stateChip} data-state={paused ? "paused" : "active"}>
            {briefCopy(paused ? "paused" : "on", L)}
          </span>
        </div>
        <div className={s.cadenceActions}>
          <button
            type="button"
            disabled={disabled}
            data-paused={paused ? "true" : undefined}
            onClick={() => void patch(existing.subscriptionId, paused ? "resume" : "pause", cadence)}
          >
            {paused ? briefCopy("resume", L) : briefCopy("pause", L)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.controls} data-testid="brief-subscribe">
      <div className={s.controlsHead}>{briefCopy("controlsTitle", L)}</div>
      <p className={s.controlsNote}>{briefCopy("scheduleHelp", L)}</p>
      <p className={s.deliveryNote} data-testid="briefs-subscribe-delivery">
        {briefCopy("emailNull", L)} <a href="/alerts">{briefCopy("openInbox", L)}</a>
      </p>
      {row("daily_after_us_close", "subscribeDaily")}
      {row("weekly_saturday", "subscribeWeekly")}
    </div>
  );
}
