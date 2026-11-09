"use client";

import { useEffect, useMemo, useState } from "react";
import { QUOTE_REQUEST_LIMIT } from "@/lib/quoteDemand";
import { object, text, type Row } from "@/lib/sectorIntelligence";
import { sectorRegularReading, sectorRegularSession } from "@/lib/sectorRegularReading";
import { sectorMatrixPopulation } from "./SectorIndustryMatrix";

type Scope = { owner: unknown; sector: string; symbols: string[] };
type Update = { scope: Scope; quotes: Row; now: number };

export function sectorQuoteProjection(scope: Scope, quotes: Row, now: number) {
  const session = sectorRegularSession(now);
  if (!session) return null;
  const readings = new Map<string, NonNullable<ReturnType<typeof sectorRegularReading>>>();
  const counts = { live: 0, delayed: 0, untimed: 0, close: 0 };
  let oldest: number | null = null;
  for (const symbol of scope.symbols) {
    const reading = sectorRegularReading(quotes[symbol], session, now);
    if (!reading) continue;
    readings.set(symbol, reading);
    counts[reading.kind]++;
    if (reading.observed !== null) oldest = Math.min(oldest ?? reading.observed, reading.observed);
  }
  if (!readings.size) return null;
  const owner = object(scope.owner);
  const tiles = (owner.tiles as unknown[]).map(raw => {
    const tile = object(raw);
    if (tile.sector !== scope.sector) return raw;
    // The existing views encode a missing performance window by omitting its key.
    const perf = { ...object(tile.perf) };
    const reading = readings.get(text(tile.t));
    if (reading) perf["1D"] = reading.value;
    else delete perf["1D"];
    return { ...tile, perf };
  });
  return { data: { ...owner, tiles }, session, counts, oldest, covered: readings.size };
}

/** One visible, authorized sector per batch cycle, shared by all four Discover representations. */
export function useSectorRegularQuotes(owner: unknown, sector: string, enabled: boolean) {
  const scope = useMemo(() => {
    if (!enabled) return null;
    const population = sectorMatrixPopulation(owner, sector);
    return population.status === "ready" ? { owner, sector, symbols: population.tiles.map(row => row.ticker) } : null;
  }, [enabled, owner, sector]);
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => {
    if (!scope) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    async function poll() {
      if (disposed || !scope || document.hidden || active) return;
      clearTimeout(timer);
      const controller = new AbortController();
      active = controller;
      const deadline = setTimeout(() => controller.abort(), 8000);
      let delay = 5000;
      const quotes: Row = {};
      try {
        for (let from = 0; from < scope.symbols.length; from += QUOTE_REQUEST_LIMIT) {
          const batch = scope.symbols.slice(from, from + QUOTE_REQUEST_LIMIT);
          const params = new URLSearchParams({ view: "regular", syms: batch.join(",") });
          const res = await fetch(`/api/quote?${params}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
          if (!res.ok) {
            const retry = Number(res.headers.get("Retry-After"));
            delay = Math.max(15000, Number.isFinite(retry) ? Math.min(retry * 1000, 300000) : 0);
            // Access is for the whole read. Never retain an earlier chunk on a denial.
            if (res.status === 401 || res.status === 403) throw new Error("access");
            continue;
          }
          const payload = object(await res.json());
          for (const symbol of batch) quotes[symbol] = object(payload.quotes)[symbol];
        }
        if (disposed || active !== controller || controller.signal.aborted) return;
        const now = Date.now();
        setUpdate({ scope, quotes, now });
        const session = sectorRegularSession(now);
        if (session && !session.open && scope.symbols.every(s => sectorRegularReading(quotes[s], session, now))) delay = 60000;
      } catch {
        if (!disposed && active === controller) setUpdate({ scope, quotes: {}, now: Date.now() });
        delay = Math.max(delay, 15000);
      } finally {
        clearTimeout(deadline);
        if (active === controller) {
          active = null;
          if (!disposed && !document.hidden) timer = setTimeout(poll, delay);
        }
      }
    }
    function visibility() {
      clearTimeout(timer);
      active?.abort();
      active = null;
      setUpdate(null);
      if (!document.hidden) void poll();
    }
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      active?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [scope]);
  const current = scope && update?.scope === scope ? update : null;
  const projection = useMemo(() => current ? sectorQuoteProjection(current.scope, current.quotes, current.now) : null, [current]);
  return { projection, total: scope?.symbols.length ?? 0, pending: !current };
}
