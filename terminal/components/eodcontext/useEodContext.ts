"use client";
import { useEffect, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import type { DarkPoolEodPayload, MovesPayload, OiConfPayload, OiConfRow, VolPayload } from "@/lib/eodContext";

export type EodContext = {
  root: string; darkpool: DarkPoolEodPayload | null; dpLoading: boolean;
  oiConf: OiConfPayload | OiConfRow[] | null; moves: MovesPayload | null; vol: VolPayload | null;
};
async function get<T>(f: string): Promise<T | null> {
  try { return ((await flowGet(f)) as T) ?? null; } catch { return null; }
}
/** The belt's existing acquisition lifecycle, retained while its sibling lab is open.
 * One instance per desk; no lens introduces a socket, timer or independent cache.
 */
export function useEodContext(root: string, active: boolean): EodContext {
  const [universe, setUniverse] = useState<{ darkpool: DarkPoolEodPayload | null; oiConf: OiConfPayload | OiConfRow[] | null } | null>(null);
  const [perRoot, setPerRoot] = useState<{ root: string; moves: MovesPayload | null; vol: VolPayload | null } | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.all([get<DarkPoolEodPayload>("darkpool"), get<OiConfPayload | OiConfRow[]>("oiconf")])
      .then(([darkpool, oiConf]) => { if (alive) setUniverse({ darkpool, oiConf }); });
    return () => { alive = false; };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.all([get<MovesPayload>(`moves:${root}`), get<VolPayload>(`vol:${root}`)])
      .then(([moves, vol]) => { if (alive) setPerRoot({ root, moves, vol }); });
    return () => { alive = false; };
  }, [root, active]);
  const sameRoot = active && perRoot?.root === root;
  return { root, darkpool: active ? universe?.darkpool ?? null : null,
    oiConf: active ? universe?.oiConf ?? null : null, dpLoading: active && !universe,
    moves: sameRoot ? perRoot.moves : null, vol: sameRoot ? perRoot.vol : null };
}
