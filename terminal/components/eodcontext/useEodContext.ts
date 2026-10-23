"use client";
import { useCallback, useEffect, useState } from "react";
import { flowGet, flowGetResult, flowInvalidate } from "@/lib/flowClientCache";
import type { DarkPoolEodPayload, MovesPayload, OiConfPayload, OiConfRow, VolPayload } from "@/lib/eodContext";

export type VolReadStatus = "loading" | "data" | "absent" | "unavailable";
export type EodContext = {
  root: string; darkpool: DarkPoolEodPayload | null; dpLoading: boolean;
  oiConf: OiConfPayload | OiConfRow[] | null; moves: MovesPayload | null; vol: VolPayload | null;
  volStatus: VolReadStatus; retryVol: () => void;
};
type PerRoot = { root: string; moves: MovesPayload | null; vol: VolPayload | null; volStatus: VolReadStatus };

async function get<T>(f: string): Promise<T | null> {
  try { return ((await flowGet(f)) as T) ?? null; } catch { return null; }
}
async function readVol(root: string): Promise<{ status: VolReadStatus; data: VolPayload | null }> {
  try {
    const outcome = await flowGetResult(`vol:${root}`);
    return outcome.status === "data"
      ? { status: "data", data: outcome.data as VolPayload }
      : { status: outcome.status, data: null };
  } catch {
    return { status: "unavailable", data: null };
  }
}
/** One existing EOD acquisition lifecycle while the Lab is open. Read outcomes
 * remain first-class: a 5xx is not a claim of absent published IV. The retry
 * invalidates only the current root's IV key in the incumbent flow cache.
 */
export function useEodContext(root: string, active: boolean): EodContext {
  const [universe, setUniverse] = useState<{ darkpool: DarkPoolEodPayload | null; oiConf: OiConfPayload | OiConfRow[] | null } | null>(null);
  const [perRoot, setPerRoot] = useState<PerRoot | null>(null);
  const [volRetry, setVolRetry] = useState(0);

  const retryVol = useCallback(() => {
    if (!active) return;
    flowInvalidate(`vol:${root}`);
    setPerRoot(prev => prev?.root === root ? { ...prev, volStatus: "loading" } : prev);
    setVolRetry(count => count + 1);
  }, [root, active]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.all([get<DarkPoolEodPayload>("darkpool"), get<OiConfPayload | OiConfRow[]>("oiconf")])
      .then(([darkpool, oiConf]) => { if (alive) setUniverse({ darkpool, oiConf }); });
    return () => { alive = false; };
  }, [active]);

  // Moves belongs to the existing EOD belt, not to the IV Retry lifecycle.
  // A delayed Moves request must never hold a successful IV recovery hostage.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void get<MovesPayload>(`moves:${root}`).then(moves => {
      if (!alive) return;
      setPerRoot(prev => ({
        root, moves,
        vol: prev?.root === root ? prev.vol : null,
        volStatus: prev?.root === root ? prev.volStatus : "loading",
      }));
    });
    return () => { alive = false; };
  }, [root, active]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void readVol(root).then(read => {
      if (!alive) return;
      setPerRoot(prev => ({
        root, moves: prev?.root === root ? prev.moves : null,
        vol: read.status === "unavailable" && prev?.root === root ? prev.vol : read.data,
        volStatus: read.status,
      }));
    });
    return () => { alive = false; };
  }, [root, active, volRetry]);

  const sameRoot = active && perRoot?.root === root;
  return {
    root, darkpool: active ? universe?.darkpool ?? null : null,
    oiConf: active ? universe?.oiConf ?? null : null, dpLoading: active && !universe,
    moves: sameRoot ? perRoot.moves : null, vol: sameRoot ? perRoot.vol : null,
    volStatus: sameRoot ? perRoot.volStatus : "loading", retryVol,
  };
}
