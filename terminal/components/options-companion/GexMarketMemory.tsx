"use client";
import { useEffect, useMemo, useState } from "react";
import { flowGetResult, type FlowOutcome } from "@/lib/flowClientCache";
import {
  buildCompanionGexMemory,
  formatExposureMn,
  previousAvailableGexSession,
  readCompanionGexSnapshot,
  type CompanionGexSnapshot,
} from "@/lib/optionsCompanion";
import type { OptionsT } from "./optionsStrings";
import styles from "./OptionsCompanion.module.css";

type MemoryState =
  | { key: string; status: "ready"; current: CompanionGexSnapshot; previous: CompanionGexSnapshot }
  | { key: string; status: "mismatch"; gexSession: string }
  | { key: string; status: "archive-missing"; previousSession: string }
  | { key: string; status: "absent" }
  | { key: string; status: "no-prior" }
  | { key: string; status: "unavailable" };

/** A failed read must not look like a published gap. Unavailable wins over absent. */
function readClass(outcomes: FlowOutcome[]): "data" | "absent" | "unavailable" {
  if (outcomes.some((o) => o.status === "unavailable")) return "unavailable";
  if (outcomes.some((o) => o.status === "absent")) return "absent";
  return "data";
}

const fmtNetBn = (value: number | null) => value == null ? "—" : formatExposureMn(value * 1_000);
const fmtMn = (value: number | null) => value == null ? "—" : formatExposureMn(value);
const fmtSpot = (value: number | null) =>
  value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function GexMarketMemory({ root, matrixSession, strike, t }: {
  root: string; matrixSession: string; strike: number | null; t: OptionsT;
}) {
  const key = `${root}|${matrixSession}`;
  const [state, setState] = useState<MemoryState>({ key: "", status: "unavailable" });

  useEffect(() => {
    let active = true;
    void (async () => {
      const [currentRaw, datesRaw] = await Promise.all([
        flowGetResult(`gex:${root}`),
        flowGetResult(`gex_dates:${root}`),
      ]);
      if (!active) return;
      const liveClass = readClass([currentRaw, datesRaw]);
      if (liveClass === "unavailable") { setState({ key, status: "unavailable" }); return; }
      if (liveClass === "absent") { setState({ key, status: "absent" }); return; }
      const current = readCompanionGexSnapshot(currentRaw.status === "data" ? currentRaw.data : null, root);
      if (!current.ok) { setState({ key, status: "unavailable" }); return; }
      if (current.value.session !== matrixSession) {
        setState({ key, status: "mismatch", gexSession: current.value.session }); return;
      }
      const prior = previousAvailableGexSession(datesRaw.status === "data" ? datesRaw.data : null, root, matrixSession);
      if (!prior.ok) { setState({ key, status: "unavailable" }); return; }
      if (!prior.value.session) { setState({ key, status: "no-prior" }); return; }
      const previousRaw = await flowGetResult(`gex_at:${root}:${prior.value.session}`);
      if (!active) return;
      if (previousRaw.status === "unavailable") { setState({ key, status: "unavailable" }); return; }
      if (previousRaw.status === "absent") {
        setState({ key, status: "archive-missing", previousSession: prior.value.session }); return;
      }
      const previous = readCompanionGexSnapshot(previousRaw.status === "data" ? previousRaw.data : null, root);
      if (!previous.ok || previous.value.session !== prior.value.session) {
        setState({ key, status: "archive-missing", previousSession: prior.value.session }); return;
      }
      setState({ key, status: "ready", current: current.value, previous: previous.value });
    })();
    return () => { active = false; };
  }, [key, matrixSession, root]);

  const visible = state.key === key ? state : null;
  const memory = useMemo(() => visible?.status === "ready"
    ? buildCompanionGexMemory(visible.current, visible.previous, strike) : null,
  [visible, strike]);

  const shell = (body: React.ReactNode, status: string) =>
    <section className={styles.inspector} data-testid="options-market-memory" data-memory-status={status}>
      <div className={styles.inspectorTitle}><strong>{t("marketMemory")}</strong><span>{t("memoryAllExpiry")}</span></div>
      {body}
    </section>;

  if (!visible) return shell(<p role="status">{t("memoryLoading")}</p>, "loading");
  if (visible.status === "mismatch") return shell(<>
    <p className={styles.warning} role="status">{t("memoryMismatch")}</p>
    <small>{matrixSession} ≠ {visible.gexSession}</small>
  </>, "mismatch");
  if (visible.status === "archive-missing") return shell(<>
    <p className={styles.warning} role="status">{t("memoryArchiveMissing")}</p>
    <small>{visible.previousSession}</small>
  </>, "archive-missing");
  if (visible.status === "absent") {
    return shell(<p className={styles.scopeHint} role="status">{t("snapshotAbsent")}</p>, "absent");
  }
  if (visible.status === "no-prior") {
    return shell(<p className={styles.scopeHint} role="status">{t("memoryUnavailable")}</p>, "unavailable");
  }
  if (visible.status !== "ready" || !memory) {
    return shell(<p className={styles.scopeHint} role="status">{t("snapshotUnreadable")}</p>, "unavailable");
  }

  const currentNetMn = memory.current.netGexBn == null ? null : memory.current.netGexBn * 1_000;
  const previousNetMn = memory.previous.netGexBn == null ? null : memory.previous.netGexBn * 1_000;
  const netDeltaMn = currentNetMn != null && previousNetMn != null ? currentNetMn - previousNetMn : null;
  const strikeDeltaMn = memory.currentStrikeMn != null && memory.previousStrikeMn != null
    ? memory.currentStrikeMn - memory.previousStrikeMn : null;

  return shell(<>
    <div className={styles.legend}>
      <span>{t("previousAvailable")}</span>
      <time dateTime={memory.previous.session}>{memory.previous.session}</time>
      <span aria-hidden="true">→</span>
      <time dateTime={memory.current.session}>{memory.current.session}</time>
    </div>
    <div className={styles.nodeStats}>
      <div>
        <span>{t("netGex")}</span>
        <b>{fmtNetBn(memory.previous.netGexBn)} → {fmtNetBn(memory.current.netGexBn)}</b>
        <small>{t("memoryDelta")} · {fmtMn(netDeltaMn)}</small>
      </div>
      <div>
        <span>{t("sameStrikeAll")}{memory.strike == null ? "" : ` · ${memory.strike}`}</span>
        <b>{fmtMn(memory.previousStrikeMn)} → {fmtMn(memory.currentStrikeMn)}</b>
        <small>{t("memoryDelta")} · {fmtMn(strikeDeltaMn)}</small>
      </div>
    </div>
    <div className={styles.inspectorTitle}>
      <span>{t("memorySpot")}</span>
      <b>{fmtSpot(memory.previous.spot)} → {fmtSpot(memory.current.spot)}</b>
    </div>
    <p className={styles.scopeHint}>{t("memoryCaution")}</p>
  </>, "ready");
}
