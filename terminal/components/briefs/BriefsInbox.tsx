"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import s from "@/components/alerts/alerts.module.css";
import b from "./briefs.module.css";
import {
  briefCopy,
  briefLanguageNotice,
  BRIEFS_EXPLICIT_LANGUAGE_CONTRACT,
  requiresExplicitBriefLanguage,
  degradedLine,
  marketReadSentences,
  monitorsSummary,
  deliveryIsMiss,
  validateBriefBody,
  isUuid,
  isBriefCadence,
  type BriefLang,
  type PinnedDelivery,
} from "@/lib/briefs";

function readObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readableDelivery(value: unknown): value is PinnedDelivery {
  // The row's identity is independent of whether its content can be decoded.
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
  const [unavailable, setUnavailable] = useState(false);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const mounted = useRef(false);
  const deliveryRead = useRef(0);

  const load = useCallback(async () => {
    if (!mounted.current) return;
    const read = ++deliveryRead.current;
    const owns = () => mounted.current && read === deliveryRead.current;
    setDeliveryLoading(true);
    setUpgradeRequired(false);
    try {
      const r = await fetch(`/api/briefs/deliveries?limit=40&contract=${BRIEFS_EXPLICIT_LANGUAGE_CONTRACT}`);
      if (!owns()) return;
      if (!r.ok) {
        if (r.status === 409) {
          const error = await r.json() as { error?: string; requiredContract?: string; reloadRequired?: boolean } | null;
          if (!owns()) return;
          setUpgradeRequired(error?.error === "UPGRADE_REQUIRED"
            && error.requiredContract === BRIEFS_EXPLICIT_LANGUAGE_CONTRACT
            && error.reloadRequired === true);
        }
        setRows(null);
        setUnavailable(true);
        return;
      }
      const body = await r.json() as { deliveries?: PinnedDelivery[]; contract?: unknown } | null;
      if (!owns()) return;
      if (!Array.isArray(body?.deliveries) || !body.deliveries.every(readableDelivery)) throw new Error("Delivery read unavailable");
      const deliveries = body.deliveries;
      // A new client may read valid legacy responses during rollout. Nullable
      // publication requires this API's explicit acknowledgement.
      if (body.contract !== undefined && body.contract !== BRIEFS_EXPLICIT_LANGUAGE_CONTRACT) {
        throw new Error("Unsupported briefs contract");
      }
      if (body.contract === undefined && deliveries.some((row) => {
        const parsed = validateBriefBody(row.body);
        return parsed !== null && requiresExplicitBriefLanguage(parsed);
      })) {
        throw new Error("Unacknowledged briefs language contract");
      }
      setRows(deliveries);
      setUnavailable(false);
    } catch {
      if (!owns()) return;
      setRows(null);
      setUnavailable(true);
      setUpgradeRequired(false);
    } finally {
      if (owns()) setDeliveryLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; deliveryRead.current++; };
  }, [load]);

  return (
    <div className={s.module} data-testid="briefs-inbox" data-briefs-module="inbox" aria-busy={deliveryLoading}>
      <div className={s.moduleHead}>
        <span>{briefCopy("title", L)}</span>
        {rows && rows.length > 0 && (
          <span className={s.moduleCount}>{rows.length}</span>
        )}
      </div>
      {unavailable && (
        <>
          <p className={s.calmBody}>{briefCopy(upgradeRequired ? "upgradeRequired" : "unavailable", L)}</p>
          <button
            type="button"
            className={`btn btn-ghost ${s.emptyAction}`}
            onClick={() => upgradeRequired ? window.location.reload() : void load()}
          >
            {briefCopy(upgradeRequired ? "refresh" : deliveryLoading ? "retrying" : "retry", L)}
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
            const languageNotice = body && !miss ? briefLanguageNotice(body, L) : null;
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
                {row.pinned && <span className={b.pinned}>{briefCopy("lastGood", L)}</span>}
                {miss ? (
                  <span className={b.sentence} data-brief-sentence="">{degradedLine(row.subscription.cadence, L)}</span>
                ) : (
                  <span className={b.sentence} data-brief-sentence="">
                    {body ? `${sentences.join(" ")} · ${monitorsSummary(body, L)}` : briefCopy("contentUnavailable", L)}
                  </span>
                )}
                {languageNotice && (
                  <span className={b.sentence} data-brief-language-availability="">{languageNotice}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className={b.emailNull} data-testid="briefs-email-null">{briefCopy("emailNull", L)}</p>
    </div>
  );
}
