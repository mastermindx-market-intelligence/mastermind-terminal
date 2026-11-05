"use client";
import { useEffect, useState } from "react";
import { exposureOriginRosterState, type ExposureOrigin, type ExposureOriginRosterState } from "@/lib/exposureOrigin";
import { groupRows, members, object, sortMembers, text } from "@/lib/sectorIntelligence";

export interface ExposureOriginRoster {
  state: "loading" | ExposureOriginRosterState;
  tickers: readonly string[] | null;
  asOf: string | null;
  contentHash: string | null;
  groupLabel: string | null;
}

const EMPTY: ExposureOriginRoster = { state: "unavailable", tickers: null, asOf: null, contentHash: null, groupLabel: null };
const LOADING: ExposureOriginRoster = { state: "loading", tickers: null, asOf: null, contentHash: null, groupLabel: null };

/** One bounded roster read for a sector origin, rechecked against the confluence
 * receipt. No retry, no polling, no cache beyond the component lifetime; a stale
 * response from a superseded read is dropped, and stepping is paused unless the
 * roster still matches what the reader left behind. */
export function useExposureOriginRoster(origin: ExposureOrigin | null): ExposureOriginRoster {
  const [roster, setRoster] = useState<ExposureOriginRoster>(origin === null ? EMPTY : LOADING);
  useEffect(() => {
    // Reset synchronously: a missing origin or a moved selection never keeps the
    // previous roster visible (react-hooks/set-state-in-effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (origin === null) { setRoster(EMPTY); return; }
    setRoster(LOADING);
    const controller = new AbortController();
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/sector-intelligence?source=confluence", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const body = object(await res.json());
        const receipt = object(body.receipt);
        if (!res.ok || receipt.source !== "confluence" || text(receipt.status) !== "ready") throw new Error("sector roster unavailable");
        const group = groupRows(body.data).find(row => row.key === origin.group) || {};
        const tickers = sortMembers(members(group), origin.sort, origin.query).map(member => member.ticker);
        const contentHash = text(receipt.contentHash) || null;
        if (live) setRoster({
          state: tickers.length === 0 ? "unavailable" : exposureOriginRosterState(origin, { contentHash }, tickers),
          tickers: tickers.length === 0 ? null : tickers,
          asOf: text(receipt.asOf) || null,
          contentHash,
          groupLabel: text(group.label) || null,
        });
      } catch {
        if (live) setRoster(EMPTY);
      }
    })();
    return () => { live = false; controller.abort(); };
    // Recheck only when the selection the envelope describes actually moves; the
    // origin object identity is not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.sector, origin?.group, origin?.sort, origin?.query, origin?.contentHash]);
  return roster;
}
