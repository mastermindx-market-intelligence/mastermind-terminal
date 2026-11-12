"use client";

/**
 * Read-only recipient view of one shared brief delivery.
 *
 * Data path: GET /api/briefs/shared/<deliveryId> decoded by the canonical
 * decodeSharedBrief at this exact deliveryId. Nothing else is fetched: no
 * owner review/read API, no mutation, no subscription or target fields, no
 * roster counts, no polling or refresh timers. The lifecycle lives inside the real
 * useReadingScope keyed on the server-verified user id, so an identity
 * departure (including A->B->A) ends the scope, aborts in-flight reads and
 * can never resurrect prior content. A 401/403 hides every prior frame and
 * ends that scope the same way. The decoded DTO is the only thing rendered,
 * and it is valid only as of this read.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeSharedBrief, type Shared } from "@/lib/briefDeliverySharing";
import { readingJson, useReadingScope } from "@/lib/shared-shell/useReadingScope";
import { useLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { isUuid } from "@/lib/briefs";
import s from "./brief-sharing.module.css";

const COPY = {
  ended: ["This shared brief can no longer be read in this session.", "此共享简报无法在当前会话中继续读取。"],
  identityUnavailable: ["Your sign-in status could not be confirmed just now.", "暂时无法确认登录状态。"],
  retry: ["Retry", "重试"], retryRead: ["Retry read", "重试读取"],
  unavailable: ["The shared brief could not be read just now.", "共享简报暂时无法读取。"],
  reading: ["Reading…", "正在读取……"], nothing: ["Nothing in this section.", "本节无内容。"],
  title: ["Shared brief", "共享简报"],
  policy: ["View only. Members of {team} can read this brief. Access changes with team membership.", "仅可查看。{team} 的当前成员可以阅读此简报，访问权限随团队成员变动而变化。"],
  slot: ["Slot", "档期"], asof: ["Content as of", "内容截至"],
  market: ["Market read", "市场解读"], monitors: ["Monitors", "监测项"],
  refresh: ["Refresh", "刷新"], atRead: ["Access reflects this read. The brief’s dates are shown above.", "访问权限以本次读取时为准；简报日期见上方。"],
} as const;
function pick(key: keyof typeof COPY, lang: string) { return COPY[key][lang === "zh" ? 1 : 0]; }

export interface SharedBriefProps {
  /** Exact authenticated user id, verified server-side by the page. */
  principalId: string;
  /** Canonical lowercase delivery UUID taken from the verified route. */
  deliveryId: string;
}

export default function SharedBrief({ principalId, deliveryId }: SharedBriefProps) {
  const identity = useShellIdentity();
  const { lang } = useLang();
  const subject = identity.kind === "account" ? identity.userId : "";
  // Context rotation masks data on this very render. The real browser auth
  // scope independently verifies the subject inside each fresh lifecycle.
  if (subject !== principalId || !isUuid(principalId) || !isUuid(deliveryId) ||
      deliveryId !== deliveryId.toLowerCase())
    return <section className={s.wrap} lang={lang}><p role="status">{pick("ended", lang)}</p></section>;
  return <SharedBriefLifecycle key={`${subject}|${deliveryId}`} userId={principalId} deliveryId={deliveryId} />;
}

function SharedBriefLifecycle({ userId, deliveryId }: {userId:string;deliveryId:string}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const { scope, ready, ended, unavailable, retryIdentity, invalidateIdentity } =
    useReadingScope(userId);
  const [shared, setShared] = useState<Shared | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setFailed(false);
    // Stale content never survives into a recheck, not even for one frame.
    setShared(null);
    try {
      const { response, value } = await readingJson(
        scope,
        `/api/briefs/shared/${deliveryId}`,
      );
      if (response.status === 401 || response.status === 403) {
        setShared(null);
        setFailed(false);
        // Membership is closed for this session; the whole scope ends here.
        invalidateIdentity();
        return;
      }
      const decoded = response.ok ? decodeSharedBrief(value, deliveryId) : null;
      if (decoded) setShared(decoded);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, [scope, deliveryId, invalidateIdentity]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // The one explicit readonly refresh: it clears the frame before the call.
  const refresh = useCallback(() => {
    if (!busy) void load();
  }, [busy, load]);

  if (ended) {
    return (
      <div className={s.wrap} lang={zh ? "zh" : "en"}>
        <p className={s.note} role="status">
          {pick("ended", lang)}
        </p>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className={s.wrap} lang={zh ? "zh" : "en"}>
        <p className={s.note} role="status">
          {pick("identityUnavailable", lang)}
        </p>
        <div className={s.actions}>
          <button type="button" className={s.control} onClick={retryIdentity}>
            {pick("retry", lang)}
          </button>
        </div>
      </div>
    );
  }

  if (!ready || !shared) {
    return (
      <div className={s.wrap} lang={zh ? "zh" : "en"}>
        <p className={s.note} role="status" aria-busy={!ready || busy}>
          {pick(failed ? "unavailable" : "reading", lang)}
        </p>
        {ready && failed && <button type="button" className={s.control} onClick={refresh}>{pick("retryRead", lang)}</button>}
      </div>
    );
  }

  const body = shared.delivery.body;
  const nothing = pick("nothing", lang);
  return (
    <div className={s.wrap} lang={zh ? "zh" : "en"}>
      <header className={s.head}>
        <p className={s.eyebrow}>{pick("title", lang)}</p>
        <h1 className={s.heading}>{body.artifact.name}</h1>
        <p className={s.lede}>
          {pick("policy", lang).replace("{team}", shared.audience.name)}
        </p>
      </header>
      <section className={s.panel} aria-busy={busy || undefined}>
        <p className={s.meta}>
          <span>
            {pick("slot", lang)} {shared.delivery.slot_asof}
          </span>
          {shared.delivery.artifact_asof !== null && (
            <span>
              {pick("asof", lang)} {shared.delivery.artifact_asof}
            </span>
          )}
        </p>
        <div className={s.bodyBlock}>
          <h2 className={s.bodyHead}>{pick("market", lang)}</h2>
          {body.market_read.map((row, index) => (
            <p className={s.sentence} key={`${row.asof}#${index}`}>
              {zh ? row.sentence_zh : row.sentence_en}
            </p>
          ))}
          {body.market_read.length === 0 && <p className={s.note}>{nothing}</p>}
        </div>
        <div className={s.bodyBlock}>
          <h2 className={s.bodyHead}>{pick("monitors", lang)}</h2>
          {body.monitors.map((row, index) => (
            <p className={s.sentence} key={`${row.name}#${index}`}>
              {zh ? `${row.name}：${row.state_zh}` : `${row.name}: ${row.state_en}`}
            </p>
          ))}
          {body.monitors.length === 0 && <p className={s.note}>{nothing}</p>}
        </div>
        <div className={s.actions}>
          <button
            type="button"
            className={s.control}
            onClick={refresh}
            disabled={busy}
          >
            {pick(busy ? "reading" : "refresh", lang)}
          </button>
          <p className={s.note}>
            {pick("atRead", lang)}
          </p>
        </div>
      </section>
    </div>
  );
}
