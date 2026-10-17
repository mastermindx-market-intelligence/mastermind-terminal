"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { intelligenceWorkspaceLayout, type Layout } from "../../lib/intelligenceWorkspaceLayout"
import { pick } from "../../lib/finFormat"
import styles from "./IntelligenceWorkspace.module.css"

export type WorkspaceTab = "summary" | "oracle" | "research" | "activity"
const WORKSPACE_ID = "intelligence-workspace"
const WIDTH_KEY = "mm.intelligence.width.v1"

export function IntelligenceWorkspaceShell({ open, symbol, zh, tab, onTabChange, onClose, status, children }: {
  open: boolean
  symbol: string
  zh: boolean
  tab: WorkspaceTab
  onTabChange: (tab: WorkspaceTab) => void
  onClose: () => void
  status: ReactNode
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const originRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [present, setPresent] = useState(false)
  const [phase, setPhase] = useState<"enter" | "open" | "exit">("enter")
  const [layout, setLayout] = useState<Layout | null>(null)
  const [width, setWidth] = useState(440)
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [swipe, setSwipe] = useState(0)
  const dragRef = useRef<{ x: number; width: number } | null>(null)
  const swipeRef = useRef<{ y: number; time: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabs: { id: WorkspaceTab; label: string }[] = [
    { id: "summary", label: pick(zh, "Summary", "概览") },
    { id: "oracle", label: pick(zh, "Oracle", "神谕") },
    { id: "research", label: pick(zh, "Research", "研究") },
    { id: "activity", label: pick(zh, "Activity", "动态") },
  ]

  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(WIDTH_KEY))
      if (saved >= 360 && saved <= 760) setWidth(saved)
    } catch { /* Storage is optional; it never gates the workspace. */ }
  }, [])

  useEffect(() => {
    if (open) {
      originRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setPhase("enter")
      setPresent(true)
      return
    }
    setPhase("exit")
    setSwipe(0)
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180
    const timer = window.setTimeout(() => {
      const dialog = dialogRef.current
      const shouldRestore = dialog?.contains(document.activeElement) || document.activeElement === document.body
      dialog?.close()
      setPresent(false)
      if (shouldRestore && originRef.current?.isConnected) originRef.current.focus({ preventScroll: true })
    }, duration)
    return () => window.clearTimeout(timer)
  }, [open])

  useLayoutEffect(() => {
    if (!present) return
    let frame = 0
    const measure = () => {
      const viewport = window.visualViewport
      const next = intelligenceWorkspaceLayout({
        viewport: { width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
          offsetLeft: viewport?.offsetLeft ?? 0, offsetTop: viewport?.offsetTop ?? 0 },
        rail: document.querySelector(".rail")?.getBoundingClientRect() ?? null,
        chart: document.querySelector(".chart-body")?.getBoundingClientRect() ?? null,
        requestedWidth: expanded ? undefined : width,
        expanded,
      })
      setLayout(previous => previous && Object.keys(next).every(key => next[key as keyof Layout] === previous[key as keyof Layout]) ? previous : next)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    measure()
    const observer = new ResizeObserver(schedule)
    for (const element of [document.documentElement, document.querySelector(".rail"), document.querySelector(".chart-body")]) {
      if (element) observer.observe(element)
    }
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    window.visualViewport?.addEventListener("resize", schedule)
    window.visualViewport?.addEventListener("scroll", schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      window.visualViewport?.removeEventListener("resize", schedule)
      window.visualViewport?.removeEventListener("scroll", schedule)
    }
  }, [present, width, expanded])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!open || !present || !layout || !dialog) return
    // Native modality belongs only to the mobile sheet. Desktop show() leaves
    // the visible watchlist and chart fully interactive, including keyboard use.
    const focused = dialog.contains(document.activeElement) ? document.activeElement as HTMLElement : null
    if (dialog.open) dialog.close()
    if (layout.mode === "sheet") dialog.showModal()
    else dialog.show()
    ;(focused ?? dialog.querySelector<HTMLElement>("[aria-selected='true']"))?.focus({ preventScroll: true })
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setPhase(open ? "open" : "exit")) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
    // Reopening is necessary only when the modality changes, never on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present, layout?.mode, open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [tab, symbol])

  const resize = (next: number) => {
    if (!layout) return
    const clamped = Math.round(Math.max(layout.minWidth, Math.min(layout.maxWidth, next)))
    setExpanded(false)
    setWidth(clamped)
    try { sessionStorage.setItem(WIDTH_KEY, String(clamped)) } catch { /* Optional preference. */ }
  }

  if (!present || !layout) return null
  const mobile = layout.mode === "sheet"
  return createPortal(
    <dialog
      id={WORKSPACE_ID}
      ref={dialogRef}
      className={styles.workspace}
      data-testid="intelligence-workspace"
      data-mode={layout.mode}
      data-phase={phase}
      data-resizing={dragging || undefined}
      aria-labelledby={`${WORKSPACE_ID}-title`}
      aria-modal={mobile ? true : undefined}
      style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height,
        ...(swipe > 0 ? { transform: `translateY(${swipe}px)`, transition: "none" } : {}) }}
      onCancel={event => { event.preventDefault(); closeRef.current() }}
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented && !mobile) {
          event.preventDefault(); event.stopPropagation(); closeRef.current()
        }
      }}
      onClick={event => {
        if (mobile && event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right || event.clientY > rect.bottom) closeRef.current()
        }
      }}
    >
      {!mobile && <div className={styles.resizeHandle} role="separator" tabIndex={0}
        aria-label={pick(zh, "Resize Intelligence workspace", "调整工作区宽度")} aria-orientation="vertical"
        aria-controls={WORKSPACE_ID} aria-valuemin={Math.round(layout.minWidth)} aria-valuemax={Math.round(layout.maxWidth)} aria-valuenow={Math.round(layout.width)}
        onPointerDown={event => {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { x: event.clientX, width: layout.width }; setDragging(true)
        }}
        onPointerMove={event => { if (dragRef.current) resize(dragRef.current.width + dragRef.current.x - event.clientX) }}
        onPointerUp={() => { dragRef.current = null; setDragging(false) }}
        onPointerCancel={() => { dragRef.current = null; setDragging(false) }}
        onKeyDown={event => {
          const next = event.key === "ArrowLeft" ? layout.width + 20 : event.key === "ArrowRight" ? layout.width - 20
            : event.key === "Home" ? layout.minWidth : event.key === "End" ? layout.maxWidth : null
          if (next != null) { event.preventDefault(); resize(next) }
        }}
      />}
      {mobile && <div className={styles.sheetHandle} aria-hidden="true" data-testid="intelligence-sheet-handle"
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
          swipeRef.current = { y: event.clientY, time: performance.now() }
        }}
        onPointerMove={event => { if (swipeRef.current) setSwipe(Math.max(0, event.clientY - swipeRef.current.y)) }}
        onPointerUp={event => {
          const start = swipeRef.current
          if (start) {
            const distance = event.clientY - start.y
            if (distance > 100 || (distance > 40 && distance / Math.max(1, performance.now() - start.time) > .6)) closeRef.current()
          }
          swipeRef.current = null; setSwipe(0)
        }}
        onPointerCancel={() => { swipeRef.current = null; setSwipe(0) }}
      ><span /></div>}
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.kicker}><span className={styles.symbol}>{symbol}</span><span>{pick(zh, "Workspace", "工作区")}</span></div>
          <h2 id={`${WORKSPACE_ID}-title`}>{pick(zh, "Intelligence", "情报")}<span className={styles.titleDot} /></h2>
        </div>
        <div className={styles.headerActions}>
          {!mobile && <button className={styles.iconButton} aria-label={expanded ? (pick(zh, "Compact view", "紧凑视图")) : (pick(zh, "Expand workspace", "展开工作区"))}
            title={expanded ? (pick(zh, "Compact view", "紧凑视图")) : (pick(zh, "Expand", "展开"))}
            aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={expanded ? "M7 3v4H3m10 10v-4h4M7 7 3 3m10 10 4 4" : "M3 7V3h4m10 10v4h-4M3 3l5 5m9 9-5-5"} /></svg>
          </button>}
          <button className={styles.iconButton} onClick={() => closeRef.current()} aria-label={pick(zh, "Close Intelligence workspace", "关闭情报工作区")}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </div>
      </header>
      <div className={styles.tabs} role="tablist" aria-label={pick(zh, "Intelligence views", "情报视图")}>
        {tabs.map((item, index) => <button key={item.id} id={`${WORKSPACE_ID}-tab-${item.id}`} role="tab"
          aria-selected={tab === item.id} aria-controls={`${WORKSPACE_ID}-panel`}
          tabIndex={tab === item.id ? 0 : -1} onClick={() => onTabChange(item.id)}
          onKeyDown={event => {
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
              : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null
            if (next != null) {
              event.preventDefault(); onTabChange(tabs[next].id)
              document.getElementById(`${WORKSPACE_ID}-tab-${tabs[next].id}`)?.focus()
            }
          }}>{item.label}</button>)}
      </div>
      <div ref={scrollRef} className={styles.content} id={`${WORKSPACE_ID}-panel`} role="tabpanel"
        aria-labelledby={`${WORKSPACE_ID}-tab-${tab}`} tabIndex={0}>
        {children}
      </div>
      <footer className={styles.footer}>
        <div className={styles.sourceStatus}>{status}</div>
        <button onClick={() => closeRef.current()}>{mobile ? (pick(zh, "Back to chart", "返回图表")) : <><kbd>Esc</kbd><span>{pick(zh, "Close", "关闭")}</span></>}</button>
      </footer>
    </dialog>, document.body,
  )
}
