"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { flowPrefetch } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import { writeProphetState, type ProphetLane } from "@/lib/prophetUrlState";
import { OptionsAlphaView } from "./OptionsAlphaView";
import { OptionsIssueDeskView } from "./OptionsIssueDeskView";
import { ProphetView as MacroPlansView } from "./ProphetView";
import { makeProphetT, type ProphetKey } from "./prophetStrings";
import { ProphetSectorView } from "./sector/ProphetSectorView";
import { ProphetCandidatesView } from "./candidates/ProphetCandidatesView";
import { TodayView } from "./today/TodayView";
import { useProphetUrlState } from "./useProphetUrlState";
import styles from "./today/today.module.css";

/**
 * The Prophet surface's lane navigation (gaps G2/G21, fix M1/M3/P2/P3).
 *
 * Reading order: Today / Candidates / Screener / Plans are the primary lanes and ride ONE
 * row at every width — no captions under the labels (the design's lane row is
 * four short labels). Options Alpha and Issue Desk stay reachable as secondary
 * lanes: inline on desktop/tablet, behind a "More" disclosure at ≤640 so the
 * Prophet-owned chrome never becomes a second navigation block on a phone.
 * The shared Options hub category row and vol strip are not this file's.
 *
 * Keyboard: the tabs pattern — one roving tab stop (the selected lane, or
 * Today when a secondary lane is selected), ArrowLeft/ArrowRight wrap among
 * the VISIBLE tabs, Home/End jump to the ends, and activation follows focus.
 * The More disclosure closes on select, Escape or an outside press.
 *
 * Lane (and the whole sector investigation) lives in the address: deep links,
 * refresh and back/forward restore the same view.
 */
const PRIMARY_LANES: readonly { lane: ProphetLane; testid: string; labelKey: ProphetKey }[] = [
  { lane: "today", testid: "prophet-tab-today", labelKey: "tabToday" },
  { lane: "candidates", testid: "prophet-tab-candidates", labelKey: "tabCandidates" },
  { lane: "screener", testid: "prophet-tab-screener", labelKey: "tabScreener" },
  { lane: "plans", testid: "prophet-tab-plans", labelKey: "lanePlans" },
];
const SECONDARY_LANES: readonly { lane: ProphetLane; testid: string; labelKey: ProphetKey }[] = [
  { lane: "options", testid: "prophet-tab-options", labelKey: "laneOptions" },
  { lane: "issue", testid: "prophet-tab-issue", labelKey: "laneIssueDesk" },
];

/** Visible (not display:none) tabs, in DOM order, for the roving tab stop. */
function visibleTabs(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .filter(tab => tab.offsetParent !== null || tab.getClientRects().length > 0);
}
const compactSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches;
function subscribeCompact(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(max-width: 640px)"); media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function ProphetLanesView() {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const { state, update, mount } = useProphetUrlState();
  const lane = state.lane;
  const screenerActive = lane === "screener" || lane === "sector";
  const secondaryActive = lane === "options" || lane === "issue";
  const [moreOpen, setMoreOpen] = useState(false);
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, () => false);
  const navRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const secondaryId = `prophet-secondary-lanes-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const selectLane = useCallback((next: ProphetLane) => {
    if (next === "options") flowPrefetch("options_prophet_idx");
    else if (next === "plans") flowPrefetch("prophet_idx");
    if (next === "screener") update({ lane: next, view: "overview" });
    else update({ lane: next });
  }, [update]);

  useEffect(() => {
    if (!moreOpen) return;
    navRef.current?.querySelector<HTMLButtonElement>(`[data-lane="${secondaryActive ? lane : "options"}"]`)?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (navRef.current !== null && !navRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && navRef.current?.contains(event.target as Node)) { setMoreOpen(false); moreRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [moreOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- focus once when the disclosure opens

  const pick = (next: ProphetLane) => {
    if (compact && (next === "options" || next === "issue")) moreRef.current?.focus();
    setMoreOpen(false);
    selectLane(next);
  };

  /** Tabs pattern: arrows wrap across visible tabs and activation follows focus. */
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = visibleTabs(event.currentTarget);
    if (tabs.length === 0) return;
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowRight") next = current < 0 ? 0 : (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = current < 0 ? tabs.length - 1 : (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    tabs[next].focus();
    const laneName = tabs[next].dataset.lane as ProphetLane | undefined;
    if (laneName !== undefined) selectLane(laneName);
  };

  // One tab stop: the selected primary lane, or Today when a secondary lane is
  // selected (its tab is inside the closed disclosure at phone widths).
  const rovingLane: ProphetLane = compact && moreOpen ? secondaryActive ? lane : "options"
    : secondaryActive && !compact ? lane : lane === "screener" || lane === "sector"
    ? "screener"
    : lane === "today" || lane === "candidates" || lane === "plans" ? lane : "today";

  const tabButton = (
    { lane: tabLane, testid, labelKey }: { lane: ProphetLane; testid: string; labelKey: ProphetKey },
    selected: boolean,
  ) => (
    <button
      key={tabLane}
      id={`prophet-tab-${tabLane}`}
      type="button"
      role="tab"
      data-lane={tabLane}
      aria-selected={selected}
      aria-controls={
        tabLane === "today" ? "prophet-panel-today"
          : tabLane === "candidates" ? "prophet-panel-candidates"
          : tabLane === "screener" ? "prophet-panel-sector"
            : tabLane === "plans" ? "prophet-panel-macro"
              : tabLane === "options" ? "prophet-panel-options" : "prophet-panel-issue"
      }
      tabIndex={tabLane === rovingLane ? 0 : -1}
      // P1-1: the module class, not a literal — `styles.on` is what the module
      // CSS compiles `.navTabs button.on` to. A literal "on" matched nothing.
      className={selected ? styles.on : ""}
      data-testid={testid}
      onMouseEnter={() => {
        if (tabLane === "plans") flowPrefetch("prophet_idx");
        if (tabLane === "options") flowPrefetch("options_prophet_idx");
      }}
      onFocus={() => {
        if (tabLane === "plans") flowPrefetch("prophet_idx");
        if (tabLane === "options") flowPrefetch("options_prophet_idx");
      }}
      onClick={() => pick(tabLane)}
    >
      <span>{t(labelKey)}</span>
    </button>
  );

  return (
    <div className="obs-prophet-lane-shell">
      <div className={styles.nav} ref={navRef}>
        <div
          className={styles.navTabs}
          role="tablist"
          aria-label={t("laneNavPrimaryAria")}
          onKeyDown={onTabKeyDown}
        >
          {PRIMARY_LANES.map(tab => tabButton(tab, tab.lane === "screener" ? screenerActive : lane === tab.lane))}
          <div
            className={styles.navSecondary}
            id={secondaryId}
            data-open={moreOpen ? "true" : "false"}
            role="presentation"
          >
            {SECONDARY_LANES.map(tab => tabButton(tab, lane === tab.lane))}
          </div>
        </div>
        <button
          ref={moreRef}
          type="button"
          className={`${styles.moreButton}${secondaryActive ? ` ${styles.on}` : ""}`}
          data-testid="prophet-lane-more"
          aria-haspopup="true"
          aria-expanded={moreOpen}
          aria-controls={secondaryId}
          aria-label={secondaryActive
            ? `${t("laneMoreAria")} — ${t(lane === "options" ? "laneOptions" : "laneIssueDesk")}`
            : t("laneMoreAria")}
          onClick={() => setMoreOpen(open => !open)}
        >
          {secondaryActive ? t(lane === "options" ? "laneOptionsShort" : "laneIssueShort") : t("laneMore")}
        </button>
      </div>

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
        id="prophet-panel-candidates"
        role="tabpanel"
        aria-labelledby="prophet-tab-candidates"
        className="obs-prophet-lane-panel"
        hidden={lane !== "candidates"}
      >
        {lane === "candidates" && (mount === "canonical" ? <ProphetCandidatesView state={state} update={update} />
          : mount === "legacy" ? <section className={styles.board} data-testid="prophet-candidates-native-entry">
            <h2>{t("candidateNativeTitle")}</h2><p>{t("candidateNativeBody")}</p>
            <Link className={styles.heroAction} prefetch={false} href={writeProphetState(new URL("https://prophet.invalid/prophet"), state, "canonical")}>{t("candidateNativeOpen")} →</Link>
          </section> : null)}
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
