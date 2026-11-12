"use client";

import { flowPrefetch } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import { OptionsAlphaView } from "./OptionsAlphaView";
import { OptionsIssueDeskView } from "./OptionsIssueDeskView";
import { ProphetView as MacroPlansView } from "./ProphetView";
import { makeProphetT } from "./prophetStrings";
import { makeProphetSectorT } from "./sector/prophetSectorStrings";
import { ProphetSectorView } from "./sector/ProphetSectorView";
import { useProphetUrlState } from "./useProphetUrlState";

/**
 * INTERIM LANE MAPPING (commit 1 of the Today board, gap G1/G2/G21): the URL
 * contract already speaks `tab=today|screener|plans|options|issue|sector`, but
 * the Today board itself lands in the next commit. Until then `today` renders
 * the incumbent plans desk and `screener` renders the sector overview, so the
 * surface compiles, stays honest and every existing journey keeps working.
 * The nav is the incumbent 4-tab switcher; the Today / Screener / Plans
 * primary navigation replaces it in commit 2 with the SX01/T2 board.
 */
const MACRO_PANEL_LANES = ["today", "plans"] as const;
const SECTOR_PANEL_LANES = ["screener", "sector"] as const;

export function ProphetLanesView() {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const sectorT = makeProphetSectorT(lang);
  // Lane (and the sector lane's whole investigation) lives in the address:
  // deep links, refresh and back/forward restore the same view.
  const { state, update } = useProphetUrlState();
  const lane = state.lane;
  const macroPanel = MACRO_PANEL_LANES.includes(lane as (typeof MACRO_PANEL_LANES)[number]);
  const sectorPanel = SECTOR_PANEL_LANES.includes(lane as (typeof SECTOR_PANEL_LANES)[number]);

  const selectLane = (next: "plans" | "options" | "issue" | "sector") => {
    if (next === "options") flowPrefetch("options_prophet_idx");
    else if (next === "plans") flowPrefetch("prophet_idx");
    update({ lane: next });
  };

  return (
    <div className="obs-prophet-lane-shell">
      <nav className="obs-prophet-lane-nav" role="tablist" aria-label={t("laneNavAria")}>
        <button
          id="prophet-lane-macro"
          type="button"
          role="tab"
          aria-selected={macroPanel}
          aria-controls="prophet-panel-macro"
          className={macroPanel ? "on" : ""}
          onMouseEnter={() => flowPrefetch("prophet_idx")}
          onFocus={() => flowPrefetch("prophet_idx")}
          onClick={() => selectLane("plans")}
        >
          <span>{t("laneMacro")}</span>
          <small>{t("provSource")}</small>
        </button>
        <button
          id="prophet-lane-options"
          type="button"
          role="tab"
          aria-selected={lane === "options"}
          aria-controls="prophet-panel-options"
          className={lane === "options" ? "on" : ""}
          onMouseEnter={() => flowPrefetch("options_prophet_idx")}
          onFocus={() => flowPrefetch("options_prophet_idx")}
          onClick={() => selectLane("options")}
        >
          <span>{t("laneOptions")}</span>
          <small>{t("optionsAlphaSource")}</small>
        </button>
        <button
          id="prophet-lane-issue"
          type="button"
          role="tab"
          aria-selected={lane === "issue"}
          aria-controls="prophet-panel-issue"
          className={lane === "issue" ? "on" : ""}
          onClick={() => selectLane("issue")}
        >
          <span>{t("laneIssueDesk")}</span>
          <small>{t("laneIssueDeskCaption")}</small>
        </button>
        <button
          id="prophet-lane-sector"
          type="button"
          role="tab"
          aria-selected={sectorPanel}
          aria-controls="prophet-panel-sector"
          className={sectorPanel ? "on" : ""}
          data-testid="prophet-lane-sector"
          onClick={() => selectLane("sector")}
        >
          <span>{sectorT("laneSector")}</span>
          <small>{sectorT("laneSectorCaption")}</small>
        </button>
      </nav>

      <div
        id="prophet-panel-macro"
        role="tabpanel"
        aria-labelledby="prophet-lane-macro"
        className="obs-prophet-lane-panel"
        hidden={!macroPanel}
      >
        {macroPanel && (
          <MacroPlansView
            selectedPlanId={state.plan}
            onSelectPlan={planId => update({ plan: planId })}
          />
        )}
      </div>
      <div
        id="prophet-panel-options"
        role="tabpanel"
        aria-labelledby="prophet-lane-options"
        className="obs-prophet-lane-panel"
        hidden={lane !== "options"}
      >
        {lane === "options" && <OptionsAlphaView />}
      </div>
      <div
        id="prophet-panel-issue"
        role="tabpanel"
        aria-labelledby="prophet-lane-issue"
        className="obs-prophet-lane-panel"
        hidden={lane !== "issue"}
      >
        {lane === "issue" && <OptionsIssueDeskView />}
      </div>
      <div
        id="prophet-panel-sector"
        role="tabpanel"
        aria-labelledby="prophet-lane-sector"
        className="obs-prophet-lane-panel"
        hidden={!sectorPanel}
      >
        {sectorPanel && <ProphetSectorView state={state} update={update} />}
      </div>
    </div>
  );
}
