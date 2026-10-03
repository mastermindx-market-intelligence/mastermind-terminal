"use client";
/**
 * OiChangePanel — top contract-level OI shifts (prev vs current report) as a
 * sortable table, with a scope toggle: this root's payload vs the cross-root
 * board (two distinct upstream payloads — never a client-side re-filter).
 *
 * Honesty:
 *   - d_oi_pct is NULL for brand-new contracts — rendered as the "new" chip,
 *     never as 0%.
 *   - An empty rows list with the upstream `note` set is the DISCLOSED
 *     unchanged-OPRA-vintage state and renders that note, not a generic empty.
 *   - ΔOI sign is positioning, not direction: the delta column keeps the
 *     neutral text tones (never --up/--down).
 */

import React, { useMemo, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { makeStructureT } from "./structureStrings";
import type { OiChangePayload, OiChangeRow } from "./structureTypes";
import { fmtOi, fmtDelta, ProvenanceLine, PanelEmpty, NEUTRAL_CHIP } from "./structureShared";
import s from "./OiChangePanel.module.css";

type SortKey = "d_oi" | "d_oi_pct" | "oi" | "oi_prev" | "dte";

export function OiChangePanel({
  rootPayload,
  crossPayload,
  scope,
  onScope,
  crossLoading,
  lang,
}: {
  rootPayload: OiChangePayload | null;
  crossPayload: OiChangePayload | null;
  scope: "root" | "all";
  onScope: (s: "root" | "all") => void;
  crossLoading: boolean;
  lang: Lang;
}) {
  const t = makeStructureT(lang);
  const [sortKey, setSortKey] = useState<SortKey>("d_oi");
  const [sortDesc, setSortDesc] = useState(true);

  const payload = scope === "all" ? crossPayload : rootPayload;
  const rows = useMemo<OiChangeRow[]>(() => {
    const raw = (payload?.rows ?? []).filter((r) => r && typeof r === "object");
    const dir = sortDesc ? -1 : 1;
    const sorted = [...raw].sort((a, b) => {
      const av = Number(a[sortKey]);
      const bv = Number(b[sortKey]);
      // |Δ| columns rank by magnitude (the payload's own convention);
      // everything else ranks by plain value. Nulls always sink.
      const am = sortKey === "d_oi" || sortKey === "d_oi_pct" ? Math.abs(av) : av;
      const bm = sortKey === "d_oi" || sortKey === "d_oi_pct" ? Math.abs(bv) : bv;
      const aOk = Number.isFinite(am);
      const bOk = Number.isFinite(bm);
      if (!aOk && !bOk) return 0;
      if (!aOk) return 1;
      if (!bOk) return -1;
      return (am - bm) * dir;
    });
    return sorted;
  }, [payload, sortKey, sortDesc]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc((v) => !v);
    else { setSortKey(k); setSortDesc(true); }
  };

  const showRootCol = scope === "all";
  const prev = payload?.prev_session ?? null;
  const unchangedNote = Boolean(payload && (payload.rows ?? []).length === 0 && payload.note);

  const cols: { key: SortKey | null; label: string }[] = [
    ...(showRootCol ? [{ key: null, label: t("thRoot") }] : []),
    { key: null, label: t("thContract") },
    { key: "dte", label: t("thDte") },
    { key: "oi_prev", label: t("thPrev") },
    { key: "oi", label: t("thOi") },
    { key: "d_oi", label: t("thDelta") },
    { key: "d_oi_pct", label: t("thDeltaPct") },
    { key: null, label: t("thMid") },
  ];

  return (
    <section className="fin-card" style={{ minWidth: 0 }}>
      <div className="fin-card-h" style={{ flexWrap: "wrap", rowGap: 6 }}>
        <span>{t("changeTitle")}</span>
        {prev && <span style={{ ...NEUTRAL_CHIP, fontWeight: 500 }}>{t("changePrevCaption").replace("{date}", prev)}</span>}
        <span style={{ flex: 1 }} />
        <div role="group" aria-label={t("changeScopeAria")} style={{ display: "flex", gap: 6 }}>
          <button className={`chip ${s.scopeChip}${scope === "root" ? " on" : ""}`} style={SCOPE_CHIP}
            aria-pressed={scope === "root"} onClick={() => onScope("root")}>
            {t("changeScopeRoot")}
          </button>
          <button className={`chip ${s.scopeChip}${scope === "all" ? " on" : ""}`} style={SCOPE_CHIP}
            aria-pressed={scope === "all"} onClick={() => onScope("all")}>
            {t("changeScopeAll")}
          </button>
        </div>
      </div>
      {scope === "all" && crossLoading && !crossPayload ? (
        <div className="fin-empty" role="status" style={{ minHeight: 160, color: "var(--muted)" }}>
          {t("loading")}
        </div>
      ) : rows.length === 0 ? (
        <PanelEmpty
          title={t("changeEmptyTitle")}
          why={unchangedNote ? t("changeUnchangedNote") : t("changeEmptyWhy")}
          minHeight={160}
        />
      ) : (
        <div style={TABLE_SCROLL}>
          <table style={TABLE}>
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th key={i} style={{ ...TH, textAlign: i === (showRootCol ? 1 : 0) ? "left" : "right" }}>
                    {c.key ? (
                      <button
                        type="button"
                        className={s.sortButton}
                        style={TH_BTN}
                        aria-label={t("sortAria").replace("{col}", c.label)}
                        onClick={() => onSort(c.key as SortKey)}
                      >
                        {c.label}
                        {sortKey === c.key && <span aria-hidden="true"> {sortDesc ? "▾" : "▴"}</span>}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.root}|${r.exp}|${r.strike}|${r.right}|${i}`} style={i % 2 ? TR_ALT : undefined}>
                  {showRootCol && <td style={{ ...TD, textAlign: "left", fontWeight: 700 }}>{r.root}</td>}
                  <td style={{ ...TD, textAlign: "left", whiteSpace: "nowrap" }}>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.exp}</span>
                    {" "}
                    <span style={{ fontWeight: 700 }}>{r.strike}{r.right}</span>
                  </td>
                  <td style={TD}>{Number.isFinite(r.dte) ? r.dte : "—"}</td>
                  <td style={TD}>{fmtOi(r.oi_prev)}</td>
                  <td style={TD}>{fmtOi(r.oi)}</td>
                  <td style={{ ...TD, fontWeight: 700 }}>{fmtDelta(r.d_oi)}</td>
                  <td style={TD}>
                    {r.d_oi_pct == null
                      ? <span style={NEW_CHIP}>{t("newContract")}</span>
                      : `${r.d_oi_pct > 0 ? "+" : r.d_oi_pct < 0 ? "−" : ""}${Math.abs(r.d_oi_pct).toFixed(1)}%`}
                  </td>
                  <td style={TD}>{r.mid != null && Number.isFinite(r.mid) ? r.mid.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ProvenanceLine lang={lang} />
    </section>
  );
}

const SCOPE_CHIP: React.CSSProperties = {
  height: 24,
  padding: "0 10px",
  fontSize: 11,
  fontWeight: 600,
};

const TABLE_SCROLL: React.CSSProperties = {
  width: "100%",
  overflowX: "auto",
  maxHeight: 420,
  overflowY: "auto",
};

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
};

const TH: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "var(--panel)",
  padding: "5px 8px",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: "var(--muted)",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
  zIndex: 1,
};

const TH_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
  letterSpacing: "inherit",
};

const TD: React.CSSProperties = {
  padding: "4px 8px",
  textAlign: "right",
  color: "var(--text)",
  borderBottom: "1px solid var(--line-2)",
  whiteSpace: "nowrap",
};

const TR_ALT: React.CSSProperties = {
  background: "var(--panel-2)",
};

const NEW_CHIP: React.CSSProperties = {
  display: "inline-block",
  padding: "0 6px",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-2)",
  background: "var(--panel-3)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-pill)",
};
