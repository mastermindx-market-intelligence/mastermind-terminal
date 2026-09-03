"use client"
/**
 * EventEdgePop — anchored fixed-position popover dashboard (BUILD-SPEC §3.4 FE2d, R15).
 *
 * Opened via click on the trust badge in StockAnalysis (wired by FE3). Shows:
 *   - Trust-tier pill
 *   - Full trust_en / trust_zh prose (the event edge rationale)
 *   - Context chips when present: next earnings + days-away, SUE-z, beats streak,
 *     avg surprise, drivers from intel.analysis.{decision, analyst}
 *
 * Dismisses on Esc key (capture listener) or click outside (capture listener, z-95).
 *
 * Props: {anchor: DOMRect, intel, zh?, onClose}
 * FE3 wires the click trigger on the trust badge; FE2d owns this file.
 */
import { useEffect, useRef } from "react"
import { pick, nextDateCountdown, fmtDate } from "../../lib/finFormat"

/* ── types ────────────────────────────────────────────────────────────── */

interface AnalystContext {
  next_date?: string | null
  beats?: number | null
  total?: number | null
  avg_surprise?: number | null
  sue_z?: number | null
  drivers?: string[]
}

interface DecisionContext {
  trust_tier?: string | null
  trust_en?: string | null
  trust_zh?: string | null
}

interface IntelAnalysis {
  decision?: DecisionContext
  analyst?: AnalystContext
}

interface Intel {
  analysis?: IntelAnalysis
}

export interface EventEdgePopProps {
  /** Viewport-relative DOMRect of the badge element that triggered the pop. */
  anchor: DOMRect
  intel?: Intel | null
  zh?: boolean
  onClose: () => void
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function cap(s?: string | null): string {
  if (!s) return ""
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function tierColor(tier?: string | null): string {
  if (!tier) return "var(--text-2)"
  const t = tier.toLowerCase()
  if (t.includes("event") || t.includes("edge")) return "var(--brand)"
  if (t.includes("high")) return "var(--up)"
  if (t.includes("low") || t.includes("weak")) return "var(--down)"
  return "var(--warn)"
}

/* ── component ────────────────────────────────────────────────────────── */

export default function EventEdgePop({ anchor, intel, zh = false, onClose }: EventEdgePopProps) {
  const popRef = useRef<HTMLDivElement>(null)

  // Esc to close — capture phase (z-95 > other Esc handlers)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  // outside-click capture — fires before bubbling so deep children don't interfere
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // small defer so the click that opened the pop doesn't immediately close it
    const tid = window.setTimeout(() => document.addEventListener("click", onClick, true), 10)
    return () => {
      window.clearTimeout(tid)
      document.removeEventListener("click", onClick, true)
    }
  }, [onClose])

  const dec = intel?.analysis?.decision
  const ae = intel?.analysis?.analyst

  const trustEn = dec?.trust_en
  const trustZh = dec?.trust_zh
  const prose = pick(zh, trustEn, trustZh) || ""
  const tier = dec?.trust_tier

  // Compute position: prefer below the anchor, flip up if insufficient space
  const POP_W = 320
  const POP_H_EST = 280
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200
  const vh = typeof window !== "undefined" ? window.innerHeight : 800
  let left = anchor.left
  let top = anchor.bottom + 8
  if (left + POP_W > vw - 8) left = Math.max(8, vw - POP_W - 8)
  if (top + POP_H_EST > vh - 8) top = Math.max(8, anchor.top - POP_H_EST - 8)

  // earnings context
  const rawNextDate = ae?.next_date ?? null
  const daysAway = nextDateCountdown(rawNextDate)
  const nextDate = daysAway == null ? null : rawNextDate
  const beats = ae?.beats ?? null
  const total = ae?.total ?? null
  const avgSurp = ae?.avg_surprise ?? null
  const sueZ = ae?.sue_z ?? null
  const drivers: string[] = ae?.drivers ?? []

  return (
    <div
      ref={popRef}
      className="eep-pop"
      role="dialog"
      aria-modal="false"
      aria-label={pick(zh, "Event edge details", "事件驱动详情")}
      style={{ left, top, width: POP_W }}
    >
      {/* trust tier pill — tint formula: one --c drives text, fill and ring */}
      {tier && (
        <div className="eep-tier-row">
          <span className="eep-tier-pill" style={{ "--c": tierColor(tier) } as React.CSSProperties}>
            {cap(tier)}
          </span>
        </div>
      )}

      {/* prose */}
      {prose && <p className="eep-prose">{prose}</p>}

      {/* context chips grid */}
      {(nextDate || beats != null || avgSurp != null || sueZ != null || drivers.length > 0) && (
        <div className="eep-chips">
          {nextDate && (
            <span className="eep-chip" title={pick(zh, "Next earnings", "下次财报")}>
              <span className="eep-chip-k">{pick(zh, "Earnings", "财报")}</span>
              <span className="eep-chip-v">
                {fmtDate(nextDate, { short: true })}
                {daysAway != null && (
                  <span className="eep-chip-sub">
                    {daysAway > 0
                      ? pick(zh, `in ${daysAway}d`, `${daysAway}天后`)
                      : daysAway === 0
                        ? pick(zh, "today", "今日")
                        : pick(zh, `${Math.abs(daysAway)}d ago`, `${Math.abs(daysAway)}天前`)}
                  </span>
                )}
              </span>
            </span>
          )}
          {beats != null && total != null && (
            <span className="eep-chip">
              <span className="eep-chip-k">{pick(zh, "Beat streak", "超预期连续")}</span>
              <span className="eep-chip-v">{beats}/{total} {pick(zh, "qtrs", "季")}</span>
            </span>
          )}
          {avgSurp != null && (
            <span className="eep-chip">
              <span className="eep-chip-k">{pick(zh, "Avg surprise", "平均超预期")}</span>
              <span className="eep-chip-v" style={{ color: avgSurp >= 0 ? "var(--up)" : "var(--down)" }}>
                {avgSurp >= 0 ? "+" : ""}{avgSurp.toFixed(1)}%
              </span>
            </span>
          )}
          {sueZ != null && (
            <span className="eep-chip">
              <span className="eep-chip-k">{pick(zh, "SUE-z", "标准化超预期")}</span>
              <span className="eep-chip-v" style={{ color: sueZ >= 1 ? "var(--up)" : sueZ <= -1 ? "var(--down)" : "var(--text)" }}>
                {sueZ >= 0 ? "+" : ""}{sueZ.toFixed(2)}
              </span>
            </span>
          )}
          {drivers.map((d, i) => (
            <span key={i} className="eep-chip eep-chip-driver">
              <span className="eep-chip-v">{d}</span>
            </span>
          ))}
        </div>
      )}

      {/* dismiss hint */}
      <div className="eep-footer">
        {pick(zh, "Press Esc or click outside to close", "按 Esc 或点击外部关闭")}
      </div>
    </div>
  )
}
