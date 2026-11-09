"use client";
/**
 * VolRegimeChip — the market's vol weather, in the options hub header (OEU T-E).
 *
 * One small chip carrying macro's OWN vol-regime verdict, with macro's own one-line read on
 * hover. It is a pure pass-through of `vol/regime.json`'s `game_plan` block: no fusion, no
 * re-derivation, no second vocabulary. Macro gauntlets that regime language; the Terminal
 * borrows it word for word or says nothing at all.
 *
 * TRI-STATE
 *   loading  → renders nothing (a chip that flashes "unavailable" then fills is a lie twice)
 *   present  → the verdict + its tone, stamped with the settled session
 *   absent   → a dim "vol regime unavailable" chip. Not silence: a header that simply drops
 *              the chip teaches the reader nothing, and the artifact's absence is a fact
 *              about the estate worth one line.
 */

import React, { useEffect, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import { Tip } from "@/components/ui/Tip";
import { makeEodT } from "./eodStrings";
import {
  eodDate,
  fmtEodDay,
  volRegimeRead,
  type VolRegimePayload,
  type VolTone,
} from "@/lib/eodContext";
import type { Lang } from "@/lib/i18n";

/** macro's four tone tokens → the terminal palette. Directional tones are theme tokens. */
const TONE_COLOR: Record<VolTone, string> = {
  calm: "var(--up)",
  neutral: "var(--text-2)",
  warn: "var(--warn)",
  jumpy: "var(--down)",
};

export function VolRegimeChip({ lang }: { lang: Lang }) {
  const t = makeEodT(lang);
  const [payload, setPayload] = useState<VolRegimePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let data: VolRegimePayload | null = null;
      try {
        data = ((await flowGet("volregime")) as VolRegimePayload) ?? null;
      } catch {
        data = null;
      }
      if (!alive) return;
      setPayload(data);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return null;

  const read = volRegimeRead(payload, lang);

  if (!read) {
    return (
      <Tip label={t("volChipAbsentWhy")} size="mini">
        <span style={{ ...CHIP, color: "var(--muted)", borderStyle: "dashed" }} tabIndex={0}>
          {t("volChipAbsent")}
        </span>
      </Tip>
    );
  }

  const day = fmtEodDay(eodDate(read.asof), lang);
  // Tier-2: macro's own one-line read, plus the cadence the chip is speaking at.
  const tip = [read.sub, `${t("volChipCadence")}${day ? ` · ${day}` : ""}`]
    .filter(Boolean)
    .join(" — ");

  return (
    <Tip label={tip} size="card">
      <span
        style={{ ...CHIP, color: TONE_COLOR[read.tone], borderColor: TONE_COLOR[read.tone] }}
        tabIndex={0}
        aria-label={`${t("volChipAria")}: ${read.label}`}
      >
        <span style={DOT} aria-hidden />
        <span style={KEY}>{t("volChipLabel")}</span>
        {read.label}
      </span>
    </Tip>
  );
}

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: "0.01em",
  padding: "2px 9px",
  border: "1px solid var(--line-2)",
  borderRadius: "var(--r-pill)",
  whiteSpace: "nowrap",
  cursor: "help",
};

const DOT: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: "currentColor",
  flexShrink: 0,
};

const KEY: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  opacity: 0.65,
};
