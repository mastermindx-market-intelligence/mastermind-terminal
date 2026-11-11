"use client";
/**
 * EodContextBelt — the settled-close context row on the Exposure Desk (OEU T-E).
 *
 * One horizontal belt: the Structure strip (walls / flip / expected move / max pain / IV
 * percentile / OI confirmation) plus the Dark Pool mini-panel for the same root. It sits
 * directly under GexSummaryBar and above the ladder + Market State pane.
 *
 * WHY BOTH SURFACES SHARE ONE ROW
 *   They are the same fact about the same ticker at the same cadence: what the close left
 *   behind. Splitting them across two tabs would have meant a second ticker selector, a
 *   second fetch lifecycle, and a reader who has to remember that the two are related. The
 *   desk already owns the root, so the belt inherits it and stays a single insertion point.
 *
 * FETCH SPLIT
 *   gex_state and the gex ladder payload arrive as PROPS — the desk already holds both, and
 *   re-fetching them here would double the desk's traffic and let the belt drift a poll
 *   behind the summary bar above it. The three stores the desk does not already read
 *   (dark pool, expected move, per-root IV) plus the OI-confirmation feed are fetched here,
 *   through the shared flow cache, so the belt owns exactly what it introduces. Each read
 *   keeps its outcome: a 404 is "not published", a read that did not land is "could not
 *   load" with a Retry, and neither is ever collapsed into the other.
 *
 *   `darkpool` and `oiconf` are whole-universe artifacts: fetched once on mount, indexed by
 *   root on the client. Only `moves:` and `vol:` re-fetch when the ticker changes.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { flowGetResult, flowInvalidate } from "@/lib/flowClientCache";
import type { Lang } from "@/lib/i18n";
import { StructureStrip } from "./StructureStrip";
import { DarkPoolMini } from "./DarkPoolMini";
import type {
  DarkPoolEodPayload,
  EodReadStatus,
  MovesPayload,
  OiConfPayload,
  OiConfRow,
  StructureGex,
  StructureGexState,
  VolPayload,
} from "@/lib/eodContext";

interface EodContextBeltProps {
  root: string;
  gexState: StructureGexState | null;
  gex: StructureGex | null;
  lang: Lang;
  /**
   * How the desk's own two level reads stand. Without it the belt can only tell a level
   * that is there from one that is not, so a failed level read would print "not published".
   */
  levelReads?: { gexstate: EodReadStatus; gex: EodReadStatus };
  /** Re-read whichever level store failed. The desk owns those reads, so it owns the retry. */
  onRetryLevels?: () => void;
}

/** One settled read: its outcome, and the payload only when it landed. */
interface Read<T> {
  status: EodReadStatus;
  data: T | null;
}

const PENDING = { status: "loading", data: null } as const;

/** flowGetResult with the outcome kept: absence and failure stay different facts. */
async function read<T>(f: string): Promise<Read<T>> {
  const out = await flowGetResult(f);
  return out.status === "data" ? { status: "data", data: out.data as T } : { status: out.status, data: null };
}

type PerRoot = { root: string; moves: Read<MovesPayload>; vol: Read<VolPayload> };

export function EodContextBelt({ root, gexState, gex, lang, levelReads, onRetryLevels }: EodContextBeltProps) {
  const [darkpool, setDarkpool] = useState<Read<DarkPoolEodPayload>>(PENDING);
  const [oiConf, setOiConf] = useState<Read<OiConfPayload | OiConfRow[]>>(PENDING);
  const [perRoot, setPerRoot] = useState<PerRoot | null>(null);
  // Retries resolve after the effects that started them; a dead belt must not be written to.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Universe-wide artifacts — once per mount, indexed by root client-side.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [dp, oc] = await Promise.all([
        read<DarkPoolEodPayload>("darkpool"),
        read<OiConfPayload | OiConfRow[]>("oiconf"),
      ]);
      if (!alive) return;
      setDarkpool(dp);
      setOiConf(oc);
    })();
    return () => { alive = false; };
  }, []);

  // Per-root stores, STORED WITH THE ROOT THEY DESCRIBE.
  //
  // The belt must never show the previous ticker's expected move under the new ticker's
  // name, not even for one frame. Clearing state in the effect would do that but costs a
  // cascading render (and is only as good as the effect's timing); tagging the payload with
  // its root makes the guard structural — mismatched data is unrenderable by construction.
  // The same tag fences the read STATUS: a failure on one root never shows on the next.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [mv, vl] = await Promise.all([
        read<MovesPayload>(`moves:${root}`),
        read<VolPayload>(`vol:${root}`),
      ]);
      if (!alive) return;
      setPerRoot({ root, moves: mv, vol: vl });
    })();
    return () => { alive = false; };
  }, [root]);

  const own = perRoot?.root === root ? perRoot : null;
  const moves = own?.moves ?? PENDING;
  const vol = own?.vol ?? PENDING;
  const levels = levelReads ?? {
    gexstate: gexState ? "data" : "absent",
    gex: gex ? "data" : "absent",
  };

  const retryDarkpool = useCallback(() => {
    flowInvalidate("darkpool");
    setDarkpool(PENDING);
    void read<DarkPoolEodPayload>("darkpool").then((dp) => {
      if (mounted.current) setDarkpool(dp);
    });
  }, []);

  // Re-read only what failed. A store that answered — with data or with a 404 — already
  // said what it has; asking it again would only add traffic.
  const retryStructure = useCallback(() => {
    if (levels.gexstate === "unavailable" || levels.gex === "unavailable") onRetryLevels?.();
    if (oiConf.status === "unavailable") {
      flowInvalidate("oiconf");
      setOiConf(PENDING);
      void read<OiConfPayload | OiConfRow[]>("oiconf").then((oc) => {
        if (mounted.current) setOiConf(oc);
      });
    }
    const r = root;
    const merge = (patch: Partial<PerRoot>) =>
      setPerRoot((prev) => (prev && prev.root === r ? { ...prev, ...patch } : prev));
    if (moves.status === "unavailable") {
      flowInvalidate(`moves:${r}`);
      merge({ moves: PENDING });
      void read<MovesPayload>(`moves:${r}`).then((mv) => {
        if (mounted.current) merge({ moves: mv });
      });
    }
    if (vol.status === "unavailable") {
      flowInvalidate(`vol:${r}`);
      merge({ vol: PENDING });
      void read<VolPayload>(`vol:${r}`).then((vl) => {
        if (mounted.current) merge({ vol: vl });
      });
    }
  }, [levels.gexstate, levels.gex, onRetryLevels, oiConf.status, moves.status, vol.status, root]);

  return (
    <div style={BELT}>
      <StructureStrip
        root={root}
        gexState={gexState}
        gex={gex}
        moves={moves.data}
        vol={vol.data}
        oiConf={oiConf.data}
        reads={{
          gexstate: levels.gexstate,
          gex: levels.gex,
          moves: moves.status,
          vol: vol.status,
          oiconf: oiConf.status,
        }}
        onRetry={retryStructure}
        lang={lang}
      />
      <DarkPoolMini
        root={root}
        payload={darkpool.data}
        status={darkpool.status}
        onRetry={retryDarkpool}
        lang={lang}
      />
    </div>
  );
}

const BELT: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "stretch",
  borderBottom: "1px solid var(--line)",
  background: "var(--panel)",
  flexShrink: 0,
};
