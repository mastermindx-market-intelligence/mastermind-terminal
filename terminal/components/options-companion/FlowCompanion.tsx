"use client";
import { useMemo } from "react";
import { useFlowStream } from "@/lib/flowStream";
import { FlowFreshnessReceipt } from "@/components/flowdesk/FlowFreshnessReceipt";
import type { FeedPayload } from "@/components/flowdesk/FeedPane";
import { isoSession, readCompanionFlow } from "@/lib/optionsCompanion";
import { createDefaultTapeView, encodeTapeView } from "@/lib/optionsTapeView";
import type { OptionsT } from "./optionsStrings";
import styles from "./OptionsCompanion.module.css";

/** The existing shared feed and source-time receipt; no socket means “live Gamma”. */
export function FlowCompanion({ root, t, lang }: { root: string; t: OptionsT; lang: "en" | "zh" }) {
  const { data: feed, connected } = useFlowStream<FeedPayload>("feed");
  const { data: meta } = useFlowStream<unknown>("meta", { pollMs: 60_000 });
  const rows = useMemo(() => readCompanionFlow(feed, root), [feed, root]);
  const tapeHref = useMemo(() => {
    try {
      const tapeView = encodeTapeView({ ...createDefaultTapeView(), drillTicker: root });
      return `/options?${new URLSearchParams({ tab: "tape", tapeView })}`;
    } catch {
      // A root the incumbent codec cannot represent must not widen to all roots.
      return null;
    }
  }, [root]);
  const money = useMemo(() => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }), []);
  const time = useMemo(() => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }), [lang]);
  return <>
    <FlowFreshnessReceipt meta={meta} connected={connected} lang={lang} sessionDate={isoSession(feed?.session_date) ?? undefined} className={styles.flowReceipt} />
    {feed?.stale && <p className={styles.warning}>{t("old")}</p>}
    <p className={styles.notice}>{t("flowNote")}</p>
    <div className={styles.tape} data-options-tape>
      {rows?.slice(0, 40).map((event) => <article key={event.id} className={styles.flowRow}>
        <div><strong>{root} {event.strike} {t(event.right === "C" ? "call" : "put")}</strong><b>{money.format(event.premium)}</b></div>
        <div><time dateTime={event.exp}>{event.exp}</time><span>{event.size?.toLocaleString("en-US") ?? "—"} {t("contracts")}</span></div>
        <footer><time dateTime={event.ts}>{time.format(new Date(event.ts))} ET</time><span>{t("premium")}</span></footer>
      </article>)}
      {!rows?.length && <div className={styles.empty} role="status"><strong>{t(rows === null ? "untimed" : "noFlow")}</strong><p>{t("flowNote")}</p></div>}
    </div>
    {rows && rows.length > 40 && <p className={styles.viewCaption}>40 / {rows.length}</p>}
    {tapeHref
      ? <a className={styles.deskLink} href={tapeHref} data-options-flow-destination="tape">{root} · {t("tape")} ↗</a>
      : <p className={styles.notice} role="status" data-options-flow-destination="unavailable">{root} · {t("tape")} — {t("receiptUnavailable")}</p>}
  </>;
}
