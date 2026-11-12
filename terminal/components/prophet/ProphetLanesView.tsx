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

type ProphetLane = "macro" | "options" | "issue" | "sector";

export function ProphetLanesView() {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const sectorT = makeProphetSectorT(lang);
  // Lane (and the sector lane's whole investigation) lives in the address:
  // deep links, refresh and back/forward restore the same view.
  const { state, update } = useProphetUrlState();
  const lane = state.lane;

  const selectLane = (next: ProphetLane) => {
    if (next === "options") flowPrefetch("options_prophet_idx");
    else if (next === "macro") flowPrefetch("prophet_idx");
    update({ lane: next });
  };

  return (
    <div className="obs-prophet-lane-shell">
      <nav className="obs-prophet-lane-nav" role="tablist" aria-label={t("laneNavAria")}>
        <button
          id="prophet-lane-macro"
          type="button"
          role="tab"
          aria-selected={lane === "macro"}
          aria-controls="prophet-panel-macro"
          className={lane === "macro" ? "on" : ""}
          onMouseEnter={() => flowPrefetch("prophet_idx")}
          onFocus={() => flowPrefetch("prophet_idx")}
          onClick={() => selectLane("macro")}
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
          aria-selected={lane === "sector"}
          aria-controls="prophet-panel-sector"
          className={lane === "sector" ? "on" : ""}
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
        hidden={lane !== "macro"}
      >
        {lane === "macro" && (
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
        hidden={lane !== "sector"}
      >
        {lane === "sector" && <ProphetSectorView state={state} update={update} />}
      </div>
    </div>
  );
}
