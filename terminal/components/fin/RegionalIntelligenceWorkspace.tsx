"use client";

/**
 * RegionalIntelligenceWorkspace — view arbitration between the listing snapshot and the
 * incumbent retained-event Intelligence view, for CN / HK / Canada listings only.
 *
 * WHY
 *
 * The Intelligence tab reaches `SharedShellCompanyIntelligence` / `CompanyIntelligencePage`,
 * which require a verified earnings event and CI identity. Regional listings mostly have
 * neither, so the tab renders empty even though the shell already loaded usable reported
 * fundamentals. This wrapper gives those listings a snapshot default WITHOUT weakening the
 * event path — the event view is the incumbent component, mounted byte-identically, and the
 * snapshot is a separate view beside it.
 *
 * THE HISTORICAL BOUNDARY — this is the part that must not drift
 *
 * A reader who has an event selected (or who arrived on a URL that carries one, however
 * malformed) must land on that event and on its exact denial or failure state. Silently
 * falling back to current reported data under a pinned historical URL is the worst outcome
 * this surface could produce, so the rules are asymmetric and fail toward the event view:
 *
 *   • ANY presence of ci_event / ci_generation / ci_company / ci_fingerprint forces the event
 *     view — including a blank or malformed value. Presence is the signal; validity is the
 *     child's business, and it renders its own refusal for an invalid reference.
 *   • Retained pins therefore beat a contradictory ci_view=snapshot.
 *   • ci_view=snapshot is honoured ONLY when no pin is present.
 *   • ci_view=event mounts the event view with no pins invented.
 *   • With neither a pin nor an explicit view, the snapshot is the default and the event child
 *     is NOT MOUNTED. Mounting it to discover whether a pin exists would let the retained
 *     reader write pins back into the URL and flash snapshot→event on a plain page load.
 *
 * Leaving the event view clears exactly the four pin keys plus the two view-local keys
 * (ci_lens, ci_evidence), and preserves every other query parameter — symbol, page, and
 * anything another surface owns.
 *
 * URL SOURCING — why this reads window.location, not just useSearchParams
 *
 * `useSearchParams` supplies REACTIVITY (it changes when the router navigates, including on a
 * ticker transition), but Next's App Router does not observe `history.pushState`: the Terminal
 * shell writes Intelligence URL state that way deliberately, and its own comment records that
 * such a write is "invisible to Next's router (searchParams stays stale)". So the values are
 * read from the LIVE URL through a `useSyncExternalStore` subscription to `mmx:shell-location`
 * — the event the shell already dispatches for exactly this purpose — plus `popstate`, while
 * `useSearchParams` remains the trigger for the router's own navigations. Every decision is
 * therefore a pure function of the URL as the reader sees it.
 *
 * US symbols never reach this file's logic: MegaPane routes them straight to the incumbent
 * event view, byte-identical to today.
 */
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import { isRegionalListingSymbol } from "../../lib/regionalCompanySnapshot";
import type { Fund } from "../../lib/fund";
import RegionalCompanySnapshot from "./RegionalCompanySnapshot";
import type { FinPage } from "./finPages";

/** The four retained-pin keys. ANY presence forces the event view. */
const RETAINED_PIN_KEYS = ["ci_event", "ci_generation", "ci_company", "ci_fingerprint"] as const;
/** View-local keys the snapshot clears alongside the pins (lens + evidence belong to the event). */
const EVENT_LOCAL_KEYS = ["ci_lens", "ci_evidence"] as const;
const VIEW_KEY = "ci_view";

export type RegionalIntelligenceView = "snapshot" | "event";

export interface RegionalIntelligenceWorkspaceProps {
  sym: string;
  fund: Fund | null | undefined;
  fundLoading?: boolean;
  /** Display name when the host resolved one (MegaPane's header identity). */
  name?: string | null;
  onNavigate: (page: FinPage) => void;
  /** The incumbent event view, mounted unchanged. Never rendered under a pinned historical URL
   *  with current data in its place, and never mounted at all in the default snapshot view. */
  children: ReactNode;
}

/** The single decision, as a pure function of the URL's query string. Exported for tests. */
export function resolveRegionalIntelligenceView(search: string): RegionalIntelligenceView {
  const params = new URLSearchParams(search);
  if (RETAINED_PIN_KEYS.some((key) => params.has(key))) return "event";
  return params.get(VIEW_KEY) === "event" ? "event" : "snapshot";
}

/** The shell's own "the URL changed" event — the same one SharedShellCompanyIntelligence writes. */
function subscribeToLocation(onStoreChange: () => void): () => void {
  window.addEventListener("mmx:shell-location", onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener("mmx:shell-location", onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

function readLocationSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

export default function RegionalIntelligenceWorkspace({
  sym,
  fund,
  fundLoading = false,
  name,
  onNavigate,
  children,
}: RegionalIntelligenceWorkspaceProps) {
  const { lang } = useLang();
  const zh = lang === "zh";

  // `useSearchParams` is read for its REACTIVITY, not for its value. The App Router emits no
  // popstate for a client-side navigation, but it does change this hook's value, and a changed
  // value re-renders this component — at which point the external store below is re-read from the
  // live URL. Without that trigger, a `router.push` that carries a pin (or clears one) would
  // leave the previous view on screen. It is deliberately NOT used to decide anything: after a
  // `history.pushState`, which is how the shell writes this state, Next's params are stale.
  useSearchParams();

  // The live URL query, read through an external-store subscription rather than copied into
  // state. `mmx:shell-location` covers this component's own pushState (and the shell's), and
  // `popstate` covers browser back/forward.
  const search = useSyncExternalStore(subscribeToLocation, readLocationSearch, () => "");

  const view = useMemo(() => resolveRegionalIntelligenceView(search), [search]);
  const regional = isRegionalListingSymbol(sym);

  const writeLocation = useCallback((mutate: (url: URL) => void) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    mutate(url);
    window.history.pushState(window.history.state, "", url.toString());
    window.dispatchEvent(new Event("mmx:shell-location"));
  }, []);

  // Leaving the event view drops the pinned reference — and only the event-owned keys. Symbol,
  // page, and every other query parameter survive untouched.
  const showSnapshot = useCallback(() => {
    writeLocation((url) => {
      for (const key of RETAINED_PIN_KEYS) url.searchParams.delete(key);
      for (const key of EVENT_LOCAL_KEYS) url.searchParams.delete(key);
      url.searchParams.set(VIEW_KEY, "snapshot");
    });
  }, [writeLocation]);

  // Entering the event view sets INTENT only. Inventing an event, generation, company or
  // fingerprint here would fabricate a pinned historical reference the reader never selected.
  const showEvent = useCallback(() => {
    writeLocation((url) => { url.searchParams.set(VIEW_KEY, "event"); });
  }, [writeLocation]);

  // A US symbol is not this surface's business — the incumbent event view, exactly as before.
  if (!regional) return <>{children}</>;

  return (
    <div data-regional-intelligence-workspace="" data-ci-regional-view={view} data-ci-regional-sym={sym.trim().toUpperCase()}>
      <div className="ci-regional-switch" role="group" aria-label={pick(zh, "Intelligence view", "情报视图")}>
        <button
          type="button"
          aria-pressed={view === "snapshot"}
          data-ci-regional-tab="snapshot"
          onClick={showSnapshot}
        >
          {pick(zh, "Company snapshot", "公司概况")}
        </button>
        <button
          type="button"
          aria-pressed={view === "event"}
          data-ci-regional-tab="event"
          onClick={showEvent}
        >
          {pick(zh, "Earnings events", "财报事件")}
        </button>
      </div>
      {view === "event" ? (
        children
      ) : (
        <RegionalCompanySnapshot
          sym={sym}
          name={name}
          fund={fund}
          fundLoading={fundLoading}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}