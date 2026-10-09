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
 *   (dark pool, expected move, per-root IV) plus the OI-confirmation feed are fetched by useEodContext,
 *   through the shared flowGet cache, so the belt owns exactly what it introduces.
 *
 *   `darkpool` and `oiconf` are whole-universe artifacts: fetched once on mount, indexed by
 *   root on the client. Only `moves:` and `vol:` re-fetch when the ticker changes.
 */

import React from "react";
import type { EodContext } from "./useEodContext";
import type { Lang } from "@/lib/i18n";
import { StructureStrip } from "./StructureStrip";
import { DarkPoolMini } from "./DarkPoolMini";
import type {
  StructureGex,
  StructureGexState,
} from "@/lib/eodContext";

interface EodContextBeltProps {
  root: string;
  context: EodContext;
  gexState: StructureGexState | null;
  gex: StructureGex | null;
  lang: Lang;
}

export function EodContextBelt({ root, context, gexState, gex, lang }: EodContextBeltProps) {
  const { darkpool, dpLoading, oiConf } = context;
  const moves = context.root === root ? context.moves : null;
  const vol = context.root === root ? context.vol : null;

  return (
    <div style={BELT}>
      <StructureStrip
        root={root}
        gexState={gexState}
        gex={gex}
        moves={moves}
        vol={vol}
        oiConf={oiConf}
        lang={lang}
      />
      <DarkPoolMini root={root} payload={darkpool} loading={dpLoading} lang={lang} />
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
