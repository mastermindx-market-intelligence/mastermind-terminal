"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/lib/i18n";
import { flowGetResult } from "@/lib/flowClientCache";
import { readExposureMap } from "@/lib/exposureMap";
import { exposureChartFingerprint, exposureMapHref, parseExposureChartRequest, type ExposureChartRequest } from "@/lib/exposureChartLink";
import type { GexMatrix } from "@/lib/gexLadder";
import type { OptionsChartLevel } from "@/lib/optionsCompanion";
import { exposureMapT } from "./exposureMapStrings";
import { parseExposureOrigin, withExposureOrigin, type ExposureOrigin } from "@/lib/exposureOrigin";
import { exposureOriginT } from "./exposureOriginStrings";
import styles from "./ExposureChartReference.module.css";

type Result = { request: ExposureChartRequest; readKey: object; state: "unavailable" | "changed" | "ready"; level?: OptionsChartLevel };

/** An explicit navigation intent, re-resolved through the incumbent source cache.
 * The URL supplies a selection and comparison digest, never a drawable exposure. */
export default function ExposureChartReference({ symbol, active, pinned, onPin }: {
  symbol: string; active: boolean; pinned: OptionsChartLevel | null; onPin: (level: OptionsChartLevel | null) => void;
}) {
  const { lang } = useLang();
  const t = useMemo(() => exposureMapT(lang), [lang]);
  const [request, setRequest] = useState<ExposureChartRequest | null>(null);
  const [origin, setOrigin] = useState<ExposureOrigin | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const readKey = useMemo(() => ({ request, symbol, active, onPin, attempt, t }), [request, symbol, active, onPin, attempt, t]);
  useEffect(() => {
    const read = () => { setRequest(parseExposureChartRequest(window.location.hash)); setOrigin(parseExposureOrigin(window.location.search)); };
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener("popstate", read); };
  }, []);
  useEffect(() => {
    if (!request || request.root !== symbol || !active) return;
    let canceled = false;
    onPin(null);
    const run = async () => {
      try {
        const outcome = await flowGetResult(request.archived ? `gex_at:${request.root}:${request.session}` : `gex:${request.root}`, { refresh: true });
        if (canceled) return;
        if (outcome.status !== "data") { setResult({ request, readKey, state: "unavailable" }); return; }
        const now = Date.now(), today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        let read = readExposureMap(outcome.data, request.root, null, request.lens, request.metric, today, now, request.shock);
        if (read.state === "unavailable" && read.qualification === "legacy" && request.lens.kind !== "all" && !request.archived) {
          const matrix = await flowGetResult(`matrix:${request.root}`, { refresh: true });
          if (canceled) return;
          if (matrix.status === "data") read = readExposureMap(outcome.data, request.root, matrix.data as GexMatrix, request.lens, request.metric, today, now, request.shock);
        }
        const node = read.summary.nodes.find(item => item.strike === request.strike);
        if (read.state !== "data" || read.session !== request.session || !node || (node.netMn == null && node.grossMn == null)) {
          setResult({ request, readKey, state: "changed" }); return;
        }
        const fingerprint = await exposureChartFingerprint(request.root, read, request.lens, request.metric, request.shock);
        if (canceled) return;
        if (fingerprint !== request.fingerprint) { setResult({ request, readKey, state: "changed" }); return; }
        const level = { root: request.root, price: node.strike, session: read.session, label: `${t("dated")} ${read.session}` };
        setResult({ request, readKey, state: "ready", level });
        onPin(level);
      } catch {
        if (!canceled) setResult({ request, readKey, state: "unavailable" });
      }
    };
    void run();
    return () => { canceled = true; onPin(null); };
  }, [request, symbol, active, onPin, readKey, t]);

  if (!request || request.root !== symbol) return null;
  const current = result?.request === request && result.readKey === readKey ? result : null;
  const state = !active ? "paused" : current?.state ?? "loading";
  const isPinned = current?.level && pinned?.root === current.level.root && pinned.price === current.level.price && pinned.session === current.level.session;
  const metric = t(request.metric === "delta" ? "deltaAssumedInventory" : request.metric === "combined" ? "scenarioStress" : request.metric);
  const scope = request.lens.kind === "one" ? request.lens.exp : t(request.lens.kind === "next-live" ? "nextLive" : request.lens.kind === "week" ? "week" : request.lens.kind === "zero" ? "zero" : "all");
  // The sector origin rides beside the request; it never changes what the chart shows.
  const sectorOrigin = origin?.company === request.root ? origin : null;
  const mapHref = exposureMapHref(request);
  const returnHref = mapHref ? withExposureOrigin(mapHref, sectorOrigin) : undefined;
  const dismiss = () => {
    onPin(null); setRequest(null);
    if (window.location.hash.startsWith("#exposure=")) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    // A wide toolbar can fit every action without exposing More.
    const target = [
      "[data-testid=toolbar-more]", "[data-testid=roller-more]",
      "[data-context-launcher]", "[data-toolbar-action=snapshot] > button",
    ].flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)))
      .find(element => element.getClientRects().length > 0 && !element.matches(":disabled, [aria-disabled=true]"));
    target?.focus({ preventScroll: true });
  };
  return createPortal(<section className={styles.reference} data-testid="exposure-chart-reference" data-state={state} aria-label={t("exposureReference")}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
    <div><strong>{t("exposureReference")} · {request.root} {request.strike}</strong><p role="status">{t(state === "ready" ? "referenceRechecked" : state === "changed" ? "referenceChanged" : state === "unavailable" ? "referenceUnavailable" : state === "paused" ? "referencePaused" : "referenceChecking")}</p><small>{request.session} · {metric} · {scope}<br />{t("referenceNotHistory")}</small>
      {request.metric === "combined" && <p>{t("spotPercent")} {request.shock.spotPercent} · {t("ivPoints")} {request.shock.ivPoints} · {t("calendarDays")} {request.shock.calendarDays}</p>}
    </div>
    <div className={styles.actions}>
      {state === "ready" && current?.level && <button type="button" aria-pressed={!!isPinned} onClick={() => onPin(isPinned ? null : current.level!)}>{isPinned ? t("unpin") : t("pin")}</button>}
      {(state === "unavailable" || state === "changed") && <button type="button" onClick={() => setAttempt(value => value + 1)}>{t("retry")}</button>}
      <a href={returnHref}>{t("returnToExposure")}</a>
      {sectorOrigin && <a href={sectorOrigin.returnHref} data-testid="exposure-reference-sector">{exposureOriginT(lang)("backToSectorCentral")}</a>}
      <button type="button" onClick={dismiss} aria-label={t("dismissReference")}>×</button>
    </div>
  </section>, document.body);
}
