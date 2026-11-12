"use client";

import { flowPrefetch } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import type { ProphetLane } from "@/lib/prophetUrlState";
import { OptionsAlphaView } from "./OptionsAlphaView";
import { OptionsIssueDeskView } from "./OptionsIssueDeskView";
import { ProphetView as MacroPlansView } from "./ProphetView";
import { makeProphetT } from "./prophetStrings";
import { ProphetSectorView } from "./sector/ProphetSectorView";
import { TodayView } from "./today/TodayView";
import { useProphetUrlState } from "./useProphetUrlState";
import styles from "./today/today.module.css";

/**
 * The Prophet surface's lane navigation (gap G2): Today / Screener / Plans are
 * the primary reading order — Today opens the board (market-to-sector
 * assessment and research cases, not the signal desk), Screener is the groups
 * overview AND carries the sector journey (the `sector` lane value is the
 * journey state reached from Today's links, the Screener's own picks, or a
 * deep link), Plans keeps the incumbent factor-engine desk. Options Alpha and
 * Issue Desk stay reachable as secondary lanes with their existing surfaces —
 * no redesign (none is designed).
 *
 * Lane (and the whole sector investigation) lives in the address: deep links,
 * refresh and back/forward restore the same view.
 */
export function ProphetLanesView() {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const { state, update } = useProphetUrlState();
  const lane = state.lane;
  const screenerActive = lane === "screener" || lane === "sector";

  const selectLane = (next: ProphetLane) => {
    if (next === "options") flowPrefetch("options_prophet_idx");
    else if (next === "plans") flowPrefetch("prophet_idx");
    if (next === "screener") update({ lane: next, view: "overview" });
    else update({ lane: next });
  };

  return (
    <div className="obs-prophet-lane-shell">
      <nav className={styles.nav} role="tablist" aria-label={t("laneNavAria")}>
        <div className={styles.navTabs} role="presentation">
          <button
            id="prophet-tab-today"
            type="button"
            role="tab"
            aria-selected={lane === "today"}
            aria-controls="prophet-panel-today"
            className={lane === "today" ? "on" : ""}
            data-testid="prophet-tab-today"
            onClick={() => selectLane("today")}
          >
            <span>{t("tabToday")}</span>
            <small>{t("tabTodayCaption")}</small>
          </button>
          <button
            id="prophet-tab-screener"
            type="button"
            role="tab"
            aria-selected={screenerActive}
            aria-controls="prophet-panel-sector"
            className={screenerActive ? "on" : ""}
            data-testid="prophet-tab-screener"
            onClick={() => selectLane("screener")}
          >
            <span>{t("tabScreener")}</span>
            <small>{t("tabScreenerCaption")}</small>
          </button>
          <button
            id="prophet-tab-plans"
            type="button"
            role="tab"
            aria-selected={lane === "plans"}
            aria-controls="prophet-panel-macro"
            className={lane === "plans" ? "on" : ""}
            data-testid="prophet-tab-plans"
            onMouseEnter={() => flowPrefetch("prophet_idx")}
            onFocus={() => flowPrefetch("prophet_idx")}
            onClick={() => selectLane("plans")}
          >
            <span>{t("lanePlans")}</span>
            <small>{t("lanePlansCaption")}</small>
          </button>
        </div>
        <div className={styles.navSecondary} role="presentation">
          <button
            id="prophet-tab-options"
            type="button"
            role="tab"
            aria-selected={lane === "options"}
            aria-controls="prophet-panel-options"
            className={lane === "options" ? "on" : ""}
            data-testid="prophet-tab-options"
            onMouseEnter={() => flowPrefetch("options_prophet_idx")}
            onFocus={() => flowPrefetch("options_prophet_idx")}
            onClick={() => selectLane("options")}
          >
            <span>{t("laneOptions")}</span>
          </button>
          <button
            id="prophet-tab-issue"
            type="button"
            role="tab"
            aria-selected={lane === "issue"}
            aria-controls="prophet-panel-issue"
            className={lane === "issue" ? "on" : ""}
            data-testid="prophet-tab-issue"
            onClick={() => selectLane("issue")}
          >
            <span>{t("laneIssueDesk")}</span>
          </button>
        </div>
      </nav>

      <div
        id="prophet-panel-today"
        role="tabpanel"
        aria-labelledby="prophet-tab-today"
        className="obs-prophet-lane-panel"
        hidden={lane !== "today"}
      >
        {lane === "today" && <TodayView state={state} update={update} />}
      </div>
      <div
        id="prophet-panel-sector"
        role="tabpanel"
        aria-labelledby="prophet-tab-screener"
        className="obs-prophet-lane-panel"
        hidden={!screenerActive}
      >
        {screenerActive && <ProphetSectorView state={state} update={update} />}
      </div>
      <div
        id="prophet-panel-macro"
        role="tabpanel"
        aria-labelledby="prophet-tab-plans"
        className="obs-prophet-lane-panel"
        hidden={lane !== "plans"}
      >
        {lane === "plans" && (
          <MacroPlansView
            selectedPlanId={state.plan}
            onSelectPlan={planId => update({ plan: planId })}
          />
        )}
      </div>
      <div
        id="prophet-panel-options"
        role="tabpanel"
        aria-labelledby="prophet-tab-options"
        className="obs-prophet-lane-panel"
        hidden={lane !== "options"}
      >
        {lane === "options" && <OptionsAlphaView />}
      </div>
      <div
        id="prophet-panel-issue"
        role="tabpanel"
        aria-labelledby="prophet-tab-issue"
        className="obs-prophet-lane-panel"
        hidden={lane !== "issue"}
      >
        {lane === "issue" && <OptionsIssueDeskView />}
      </div>
    </div>
  );
}
