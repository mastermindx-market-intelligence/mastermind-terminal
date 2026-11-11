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
import { useEffect, useLayoutEffect, useRef } from "react"
import { pick, nextDateCountdown, fmtDate } from "../../lib/finFormat"
import styles from "./EventEdgePop.module.css"

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

  // The nonmodal reader is a normal Tab stop. Return to its opener when dismissal
  // leaves focus in the reader or on the body; preserve a focused outside action.
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const pop = popRef.current
    return () => {
      if (origin?.isConnected && (pop?.contains(document.activeElement) || document.activeElement === document.body)) {
        origin.focus({ preventScroll: true })
      }
    }
  }, [])

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

  // Measure the rendered content: translated prose and drivers can be much taller
  // than the old fixed estimate. Keep the nonmodal popover inside the visible
  // viewport, including after a resize or a mobile visual-viewport change.
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!pop) return
    let frame = 0
    const viewport = window.visualViewport
    const position = () => {
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const minLeft = (viewport?.offsetLeft ?? 0) + 8
      const minTop = (viewport?.offsetTop ?? 0) + 8
      const popWidth = Math.max(0, Math.min(320, width - 16))
      pop.style.width = `${popWidth}px`
      pop.style.maxHeight = `${Math.max(0, Math.min(420, height * 0.8, height - 16))}px`

      const popHeight = pop.offsetHeight
      const maxTop = minTop + Math.max(0, height - 16 - popHeight)
      const below = anchor.bottom + 8
      const above = anchor.top - 8 - popHeight
      const preferredTop = below <= maxTop ? below : above >= minTop ? above : below
      pop.style.left = `${Math.max(minLeft, Math.min(anchor.left, minLeft + width - 16 - popWidth))}px`
      pop.style.top = `${Math.max(minTop, Math.min(preferredTop, maxTop))}px`
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(position)
    }
    position()
    const observer = new ResizeObserver(schedule)
    observer.observe(pop)
    window.addEventListener("resize", schedule)
    viewport?.addEventListener("resize", schedule)
    viewport?.addEventListener("scroll", schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("resize", schedule)
      viewport?.removeEventListener("resize", schedule)
      viewport?.removeEventListener("scroll", schedule)
    }
  }, [anchor])

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
      className={`eep-pop ${styles.popover}`}
      tabIndex={0}
      role="dialog"
      aria-modal="false"
      aria-label={pick(zh, "Event edge details", "事件驱动详情")}
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
