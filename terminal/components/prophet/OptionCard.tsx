"use client";
/**
 * OptionCard — displays the option sub-card for a Prophet plan.
 *
 * Hidden (returns null) when option_contract is null/absent.
 *
 * HONESTY DOCTRINE:
 *   - "EOD mark" freshness chip — never claims live quote.
 *   - No predictive language; no "validated".
 *   - Entry premium is plan-time snapshot; EOD mark is EOD only.
 */

import { useState } from "react";
import { makeProphetT } from "./prophetStrings";
import type { Lang } from "@/lib/i18n";
import { structureReceiptLine, type StructureReceipt } from "@/lib/eodContext";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OptionContractPayload {
  /** "CALL" | "PUT" or "C" | "P" — both accepted */
  type?: string;
  /** "C" | "P" — alternative to type */
  right?: string;
  strike: number;
  expiry: string;
  entry_premium: number | null;
  /** EOD mark — present only when engine has an EOD price */
  eod_mark?: number | null;
  /**
   * Display-tier structure receipt (macro #3500, OEU M-PRO hook 4). Absent on plans built
   * before it shipped and on contracts macro could not price — the card handles both.
   */
  structure?: StructureReceipt | null;
}

/** Live intraday mark sourced from prophet_marks.json */
export interface LiveMark {
  bid: number;
  ask: number;
  mid: number;
  last: number;
  ts_utc: string;
}

interface OptionCardProps {
  contract: OptionContractPayload | null | undefined;
  lang: Lang;
  /** When present and fresh (≤20 min RTH), shown tagged LIVE instead of EOD mark. */
  liveMark?: LiveMark | null;
  /** Set true in fixture/dev mode to bypass freshness check */
  liveMarkForced?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────────

// ── Live-mark freshness check ─────────────────────────────────────────────────

const LIVE_WINDOW_MS = 20 * 60 * 1000; // 20 min

function isMarkFresh(mark: LiveMark, forced: boolean): boolean {
  if (forced) return true;
  try {
    const age = Date.now() - new Date(mark.ts_utc).getTime();
    return age >= 0 && age <= LIVE_WINDOW_MS;
  } catch { return false; }
}

export function OptionCard({ contract, lang, liveMark, liveMarkForced }: OptionCardProps) {
  const t = makeProphetT(lang);
  const zh = lang === "zh";
  const [tipKey, setTipKey] = useState<string | null>(null);

  if (!contract) return null;

  // Accept both "CALL"/"PUT" and "C"/"P" in type; also fall back to "right" field.
  const typeStr = (contract.type ?? contract.right ?? "").toUpperCase();
  const isCall = typeStr === "CALL" || typeStr === "C";
  const typeColor = isCall ? "var(--up)" : "var(--down)";
  const typeBg   = isCall
    ? "color-mix(in srgb, var(--up) 15%, transparent)"
    : "color-mix(in srgb, var(--down) 15%, transparent)";
  const typeLabel = isCall ? t("optionCall") : t("optionPut");

  const hasPrem = contract.entry_premium != null;
  const hasEod  = contract.eod_mark != null;

  // Live mark: prefer if present and fresh during RTH
  const isLive = liveMark != null && isMarkFresh(liveMark, liveMarkForced ?? false);
  const displayMark: number | null = isLive ? liveMark!.mid : (hasEod ? contract.eod_mark! : null);
  const hasDisplayMark = displayMark != null;

  const pnlPct = hasPrem && hasDisplayMark && contract.entry_premium! > 0
    ? ((displayMark! - contract.entry_premium!) / contract.entry_premium!) * 100
    : null;

  return (
    <div className="obs-card obs-prophet-option" style={CARD_STYLE}>
      {/* Header row */}
      <div style={HEADER_ROW}>
        <span style={DIAMOND}>◆</span>
        <span style={TITLE_STYLE}>{t("optionCardTitle")}</span>
        {/* Provenance: the contract is a suggested overlay on a stock signal. Options data
            never entered the selection, the conviction score or the targets. */}
        <span className="obs-prophet-overlay-tag">{t("optionOverlayTag")}</span>
        {/* Freshness chip: LIVE (green) or EOD (muted) */}
        {isLive && (
          <span
            style={LIVE_CHIP}
            onMouseEnter={() => setTipKey("live")}
            onMouseLeave={() => setTipKey(null)}
            aria-label={t("optionLiveQuote")}
          >
            {zh ? "实时" : "LIVE"}
            {tipKey === "live" && (
              <span style={TIP_STYLE}>
                {t("optionLiveTip")}
              </span>
            )}
          </span>
        )}
        {!isLive && hasDisplayMark && (
          <span
            style={EOD_CHIP}
            onMouseEnter={() => setTipKey("eod")}
            onMouseLeave={() => setTipKey(null)}
            aria-label={t("optionEodMark")}
          >
            {t("optionEodMark")}
            {tipKey === "eod" && (
              <span style={TIP_STYLE}>
                {t("optionEodTip")}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Fields grid */}
      <div style={GRID_STYLE}>
        {/* Type */}
        <Field label={t("optionType")}>
          <span style={{ ...CHIP_BASE, background: typeBg, color: typeColor, fontWeight: 700 }}>
            {typeLabel}
          </span>
        </Field>

        {/* Strike */}
        <Field label={t("optionStrike")}>
          <span style={VAL_STYLE}>${contract.strike.toFixed(2)}</span>
        </Field>

        {/* Expiry */}
        <Field label={t("optionExpiry")}>
          <span style={VAL_STYLE}>{contract.expiry}</span>
        </Field>

        {/* Entry premium */}
        {hasPrem && (
          <Field label={t("optionPremEntry")}>
            <span style={VAL_STYLE}>${contract.entry_premium!.toFixed(2)}</span>
          </Field>
        )}

        {/* Current mark (LIVE mid or EOD) + P&L */}
        {hasDisplayMark && (
          <Field label={isLive ? (zh ? "实时中间价" : "Live mid") : t("optionEodMark")}>
            <span style={VAL_STYLE}>
              ${displayMark!.toFixed(2)}
              {pnlPct != null && (
                <span
                  style={{
                    marginLeft: 5,
                    color: pnlPct >= 0 ? "var(--up)" : "var(--down)",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                </span>
              )}
            </span>
          </Field>
        )}
        {/* Bid/ask spread when live mark present */}
        {isLive && liveMark && (
          <Field label={zh ? "买/卖" : "Bid/Ask"}>
            <span style={{ ...VAL_STYLE, color: "var(--text-2)" }}>
              ${liveMark.bid.toFixed(2)} / ${liveMark.ask.toFixed(2)}
            </span>
          </Field>
        )}
      </div>

      {/* Structure receipt — how tradeable this contract looked at the close. */}
      <StructureRow
        receipt={contract.structure ?? null}
        lang={lang}
        open={tipKey === "struct"}
        onOpen={(v) => setTipKey(v ? "struct" : null)}
      />
    </div>
  );
}

/**
 * StructureRow — the glance line + its Tier-2 hover.
 *
 * Glance carries the plain word and the compact numbers; the hover carries macro's own full
 * sentences (note_en / note_zh) VERBATIM, including the OI vintage and the short-history
 * caveat. Nothing is re-worded here — the receipt's vocabulary is macro's, gauntleted there.
 *
 * When a contract has no receipt the row says so rather than rendering nothing: an option
 * card with no liquidity line reads as "fine to trade", which is a claim we have not earned.
 */
function StructureRow({
  receipt, lang, open, onOpen,
}: {
  receipt: StructureReceipt | null;
  lang: Lang;
  open: boolean;
  onOpen: (v: boolean) => void;
}) {
  const t = makeProphetT(lang);
  const line = structureReceiptLine(receipt, lang);

  if (!line) {
    return (
      <div style={STRUCT_ROW}>
        <div style={STRUCT_HEAD}>
          <span style={STRUCT_LABEL}>{t("structTitle")}</span>
        </div>
        <span style={{ ...STRUCT_TEXT, color: "var(--muted)" }}>{t("structAbsent")}</span>
      </div>
    );
  }

  // Worst-first tone, matching macro's band precedence: a wide spread or a thin strike is
  // the warning that has to win over the reassuring words beside it.
  const tone =
    line.band === "wide" || line.band === "thin"
      ? "var(--warn)"
      : line.band === "liquid"
        ? "var(--up)"
        : "var(--text-2)";

  return (
    <div style={STRUCT_ROW}>
      {/* Label + vintage share the caption line; the receipt itself owns the line below.
          The card is mounted at ~250px in the signal list and ~600px in the detail pane —
          a single flex row wrapped the receipt to five lines at the narrow end. */}
      <div style={STRUCT_HEAD}>
        <span style={STRUCT_LABEL}>{t("structTitle")}</span>
        <span style={STRUCT_VINTAGE}>{t("structVintage")}</span>
      </div>
      <span
        style={{ ...STRUCT_TEXT, color: tone, cursor: line.detail ? "help" : "default" }}
        tabIndex={line.detail ? 0 : -1}
        aria-label={`${t("structAria")}: ${line.glance}`}
        onMouseEnter={() => onOpen(true)}
        onMouseLeave={() => onOpen(false)}
        onFocus={() => onOpen(true)}
        onBlur={() => onOpen(false)}
      >
        {line.glance}
        {line.young && <span style={STRUCT_CAVEAT}>· {t("structYoung")}</span>}
        {open && line.detail && (
          <span style={{ ...TIP_STYLE, whiteSpace: "normal", width: 260, right: "auto", left: 0 }}>
            {line.detail}
          </span>
        )}
      </span>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={FIELD_STYLE}>
      <span style={FIELD_LABEL}>{label}</span>
      <span style={FIELD_VAL}>{children}</span>
    </div>
  );
}

// ── Style constants ───────────────────────────────────────────────────────────

// obs-card provides glass background/border/radius
const CARD_STYLE: React.CSSProperties = {
  marginTop: 8,
  padding: "9px 11px",
};

const HEADER_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
  marginBottom: 8,
};

const DIAMOND: React.CSSProperties = {
  color: "var(--obs-prophet-cyan, #19c2c2)",
  fontSize: 11,
};

const TITLE_STYLE: React.CSSProperties = {
  font: "600 11px/1 var(--font-ui)",
  color: "var(--text-2)",
};

const EOD_CHIP: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  font: "500 9.5px/1 var(--font-ui)",
  color: "var(--muted)",
  border: "1px solid var(--line-2)",
  borderRadius: "var(--r-pill)",
  padding: "2px 6px",
  cursor: "help",
};

const LIVE_CHIP: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  font: "600 9.5px/1 var(--font-ui)",
  color: "var(--up)",
  border: "1px solid color-mix(in srgb, var(--up) 40%, transparent)",
  borderRadius: "var(--r-pill)",
  padding: "2px 6px",
  cursor: "help",
};

const TIP_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 5px)",
  right: 0,
  whiteSpace: "nowrap",
  background: "var(--panel-3)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-md)",
  padding: "5px 8px",
  font: "500 10px/1.4 var(--font-ui)",
  color: "var(--text-2)",
  zIndex: 50,
  pointerEvents: "none",
  // --shadow-1 was never defined by globals.css — the tooltip had no elevation at all.
  boxShadow: "var(--shadow-2)",
};

const GRID_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px 16px",
};

const FIELD_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const FIELD_LABEL: React.CSSProperties = {
  font: "500 9.5px/1 var(--font-ui)",
  color: "var(--muted)",
};

const FIELD_VAL: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
};

const VAL_STYLE: React.CSSProperties = {
  font: "600 11.5px/1 var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text)",
};

const CHIP_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  font: "600 10px/1 var(--font-ui)",
  borderRadius: "var(--r-pill)",
  padding: "3px 7px",
  whiteSpace: "nowrap",
};

const STRUCT_ROW: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  marginTop: 9,
  paddingTop: 8,
  borderTop: "1px solid var(--line-2)",
};

const STRUCT_HEAD: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
};

const STRUCT_LABEL: React.CSSProperties = {
  font: "500 9.5px/1 var(--font-ui)",
  color: "var(--muted)",
  whiteSpace: "nowrap",
};

const STRUCT_TEXT: React.CSSProperties = {
  position: "relative",
  display: "block",
  font: "600 10.5px/1.45 var(--font-ui)",
  minWidth: 0,
  outline: "none",
};

const STRUCT_CAVEAT: React.CSSProperties = {
  marginLeft: 5,
  font: "500 9.5px/1 var(--font-ui)",
  color: "var(--warn)",
};

const STRUCT_VINTAGE: React.CSSProperties = {
  font: "500 9px/1 var(--font-ui)",
  color: "var(--text-dim)",
  whiteSpace: "nowrap",
};
