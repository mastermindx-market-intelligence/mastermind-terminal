"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ownerKeyFor } from "@/lib/accountIdentity";

// The terminal rail's read of the user's REAL book (F08-RAIL; macro#6819 C4 5995397563).
//
// The rail used to fold three different facts into one `loaded` flag, set in a `finally`. A 503, a
// rejected fetch and a body without a `positions` array therefore all landed as "No positions yet"
// plus an Add-position link: an unreadable store asserted that the user holds nothing. These are
// now separate:
//
//   rows === null  no read has ANSWERED for this owner yet. The rail may say "Loading…" or "Could
//                  not read your portfolio", and never "No positions yet".
//   failed         the newest read that settled for this owner did not answer. Rows already on
//                  screen stay, qualified as the last good read. With none, the rail offers Retry.
//   busy           a Retry is in flight. Lazy and post-write reads do not set it, so an unchanged
//                  book still commits no new state (the rail's existing identity optimization).
//
// Every read is bound to the generation, owner and mount it started under. A read superseded by a
// newer read, an owner change or unmount writes nothing when it lands. An older success or
// failure therefore cannot overwrite a newer answer, or a newer read that is still pending.
//
// The state is TAGGED with its owner, and the rail reads it only while the tag matches. That
// needs no effect, which would run after paint: one account's book is never painted under another
// account's session, even for a frame, and a write that slips in during a render is ignored.

export type PortfolioRailRow = { id: string; ticker: string; status: string };

export type PortfolioRailRead = {
  rows: PortfolioRailRow[] | null;
  failed: boolean;
  busy: boolean;
  /** Lazy / post-write read. Never shows busy chrome. */
  load: () => Promise<void>;
  /** The rail's Retry. GET-only, like every read here; shows "Reading…" until it settles. */
  retry: () => Promise<void>;
};

/**
 * Who a rail read belongs to: "" when signed out, otherwise the immutable account key AND the
 * address. A new uuid behind the same email is a different owner, and so is a new address on a
 * shell that has no uuid (which `accountIdentity` resolves to guest for every address alike).
 * The cost of the address term is one re-read when an account changes its address.
 */
export function portfolioRailOwner(email: string, userId?: string | null): string {
  return email ? `${ownerKeyFor(userId)}|${email}` : "";
}

type Snapshot = { owner: string; rows: PortfolioRailRow[] | null; failed: boolean; busy: boolean };

function sameRows(a: PortfolioRailRow[], b: PortfolioRailRow[]): boolean {
  return a.length === b.length
    && a.every((row, index) => row.id === b[index].id && row.ticker === b[index].ticker && row.status === b[index].status);
}

/** The positions array of an answered read, or `null` when the body is not one. */
function answeredRows(payload: unknown): PortfolioRailRow[] | null {
  const positions = (payload as { positions?: unknown } | null)?.positions;
  if (!Array.isArray(positions)) return null;
  return (positions as { id: string; ticker: string; status: string }[])
    .filter((row) => row && typeof row.ticker === "string")
    .map((row) => ({ id: row.id, ticker: row.ticker, status: row.status }));
}

/**
 * @param owner   who the book belongs to. Any change starts a fresh, unanswered read state, and
 *                every read the previous owner started is discarded.
 * @param enabled the lazy trigger. A read is issued whenever this turns true, and again when the
 *                owner changes while it is true. Nothing is fetched while it is false.
 */
/** One GET of the book: its rows when the store answered, `null` when it did not. */
async function readBook(): Promise<PortfolioRailRow[] | null> {
  try {
    const response = await fetch("/api/portfolio", { headers: { Accept: "application/json" } });
    return response.ok ? answeredRows(await response.json()) : null;
  } catch {
    return null;
  }
}

export function usePortfolioRailRead(owner: string, enabled: boolean): PortfolioRailRead {
  const [snap, setSnap] = useState<Snapshot>(() => ({ owner, rows: null, failed: false, busy: false }));
  const generation = useRef(0);

  // Mount lifetime and the owner boundary in one place. This cleanup runs on unmount AND whenever
  // the owner changes, and either one advances the generation, so every read in flight is
  // invalidated. That also covers an A → signed-out → A round trip, which the owner tag alone
  // would let through.
  useEffect(() => () => { generation.current += 1; }, [owner]);

  // Settle one read. Only the newest read started under this owner and mount may write. A
  // snapshot tagged for another owner is replaced outright: no state is claimed when a read
  // STARTS, so the lazy trigger's effect sets no state until its fetch has settled.
  const settle = useCallback((mine: number, rows: PortfolioRailRow[] | null) => {
    if (generation.current !== mine) return;
    setSnap((s) => {
      if (s.owner !== owner) return { owner, rows, failed: rows === null, busy: false };
      if (rows === null) return s.failed && !s.busy ? s : { ...s, failed: true, busy: false };
      const kept = s.rows && sameRows(s.rows, rows) ? s.rows : rows;
      return kept === s.rows && !s.failed && !s.busy ? s : { owner, rows: kept, failed: false, busy: false };
    });
  }, [owner]);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    settle(mine, await readBook());
  }, [settle]);

  const retry = useCallback(async () => {
    const mine = ++generation.current;
    setSnap((s) => (s.owner !== owner ? { owner, rows: null, failed: false, busy: true } : s.busy ? s : { ...s, busy: true }));
    settle(mine, await readBook());
  }, [owner, settle]);

  // `load` changes identity with the owner, so an account change while the tab is open re-reads.
  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  const current = snap.owner === owner;
  return {
    rows: current ? snap.rows : null,
    failed: current && snap.failed,
    busy: current && snap.busy,
    load,
    retry,
  };
}
