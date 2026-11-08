"use client"

import { useId, useState, type ReactNode } from "react"
import { pick } from "../../lib/finFormat"
import { activityEventPresentation, type WorkspaceActivityEvent } from "../../lib/intelligenceActivity"
import type { WorkspaceSource } from "../../lib/useWorkspaceSource"
import styles from "./StockEvidenceOverview.module.css"

type SourceRead = Pick<WorkspaceSource<unknown>, "status" | "refresh"> & { retry: () => void }
export interface StockEvidenceCard {
  id: "oracle" | "research"
  heading: string
  label: string
  detail?: string | null
  observed?: string | null
  provenance?: string | null
  source: SourceRead
  onOpen: () => void
}

/** Presentation of already qualified source reads; never another decision or signal engine. */
export default function StockEvidenceOverview({ zh, entry, cards, prophet, warning, sample, events,
  historyAvailable, marketRisk, formatDate, onJump, onActivity }: {
  zh: boolean
  entry: { status: string; label: string; reason: string }
  cards: readonly StockEvidenceCard[]
  prophet: ReactNode
  warning?: ReactNode
  sample?: { trades: number; drawdown: string | null; onOpen: () => void } | null
  events: readonly WorkspaceActivityEvent[]
  historyAvailable: boolean
  marketRisk: ReactNode
  formatDate: (date: string, zh: boolean) => string
  onJump: (date: string) => void
  onActivity: () => void
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const sourcesId = useId()
  const status = (read: SourceRead) => read.status === "loading" ? pick(zh, "Loading", "加载中")
    : read.status === "absent" ? pick(zh, "Not published", "尚未发布")
    : read.status === "unavailable" ? pick(zh, "Unavailable", "不可用")
    : read.refresh === "failed" ? pick(zh, "Saved · refresh failed", "已保存 · 刷新失败")
    : read.refresh === "checking" ? pick(zh, "Checking source", "正在检查来源")
    : pick(zh, "Source loaded", "来源已加载")

  return <div className={styles.overview} data-testid="stock-evidence-overview">
    <div className={styles.qualification} data-testid="workspace-oracle-entry-availability" data-status={entry.status}>
      <div className={styles.eyebrow}>{pick(zh, "Current Oracle entry", "当前神谕入场")}</div>
      <h3>{entry.label}</h3>
      <p>{entry.reason}</p>
      <small>{pick(zh, "Historical signals are not current entry calls.", "历史信号不代表当前入场许可。")}</small>
    </div>

    <div className={styles.sectionTop}>
      <h3>{pick(zh, "Evidence", "依据")}</h3>
      <button type="button" className={styles.quietAction} aria-expanded={sourcesOpen} aria-controls={sourcesId}
        onClick={() => setSourcesOpen(value => !value)}>{pick(zh, "Sources & freshness", "来源与时效")} <span aria-hidden="true">{sourcesOpen ? "−" : "+"}</span></button>
    </div>
    <div className={styles.cards}>
      {cards.map(card => <button type="button" key={card.id} className={styles.card} data-evidence-source={card.id}
        data-state={card.source.status} onClick={card.onOpen}>
        <span className={styles.cardTop}><span>{card.heading}</span><span aria-hidden="true">↗</span></span>
        <strong>{card.label}</strong>
        {card.detail && <span className={styles.cardDetail}>{card.detail}</span>}
        {card.observed && !card.detail?.includes(card.observed) && <span className={styles.cardDate}>{card.provenance && `${card.provenance} · `}{card.observed}</span>}
        {card.source.refresh === "checking" && <span className={styles.cardDetail}>{pick(zh, "Checking source…", "正在检查来源…")}</span>}
        {card.source.refresh === "failed" && <span className={styles.refreshWarning}>{pick(zh, "Saved · refresh failed", "已保存 · 刷新失败")}</span>}
      </button>)}
    </div>
    <div id={sourcesId} hidden={!sourcesOpen} className={styles.sources} data-testid="evidence-source-inspector">
      {cards.map(card => <div key={card.id} className={styles.sourceRow}>
        <div><strong>{card.id === "oracle" ? pick(zh, "Oracle history", "神谕历史") : pick(zh, "Research date", "研究日期")}</strong>
          <span>{card.observed ?? pick(zh, "Date not supplied", "未提供日期")} · {status(card.source)}</span>
        </div>
        <button type="button" className={styles.sourceRefresh} onClick={card.source.retry}
          disabled={card.source.status === "loading" || card.source.refresh === "checking"}
          aria-label={card.id === "oracle" ? pick(zh, "Refresh Oracle history", "刷新神谕历史") : pick(zh, "Refresh research", "刷新研究")}>
          <span aria-hidden="true">↻</span> {pick(zh, "Refresh", "刷新")}
        </button>
      </div>)}
      <p>{pick(zh, "Loaded is not the same as current. Each source keeps its own date and qualification.", "已加载不等于当前有效；各来源保留自己的日期与有效性判断。")}</p>
    </div>
    {warning && <div className={styles.warning}>{warning}</div>}
    {prophet}
    {sample && <button type="button" className={styles.sample} onClick={sample.onOpen}>
      <span className={styles.sampleBody}><small>{pick(zh, "Historical backtest", "历史回测")}</small>
        <span><strong>{sample.trades}</strong> {pick(zh, "trades", "笔交易")}
          {sample.drawdown && <> <span className={styles.sampleDivider}>·</span> <strong>{sample.drawdown}</strong> {pick(zh, "max drawdown", "最大回撤")}</>}</span>
      </span><span aria-hidden="true">↗</span>
    </button>}
    {historyAvailable && <section className={styles.recent} aria-label={pick(zh, "Recent observations", "近期观察")}>
      <div className={styles.sectionTop}><h3>{pick(zh, "Recent observations", "近期观察")}</h3>
        <button type="button" className={styles.quietAction} onClick={onActivity}>{pick(zh, "All history", "全部历史")} <span aria-hidden="true">→</span></button>
      </div>
      {events.slice(0, 3).map(event => {
        const view = activityEventPresentation(event, zh)
        const clock = event.clock === "bar" ? pick(zh, "Bar date", "K线日期")
          : event.clock === "entry" ? pick(zh, "Entry date", "入选基准日") : view.source
        return <button key={event.key} type="button" className={styles.recentRow} data-testid="recent-observation"
          data-event-date={event.date ?? ""} disabled={!event.chartDate} data-tone={view.tone}
          onClick={() => event.chartDate && onJump(event.chartDate)}
          title={pick(zh, "Historical observation · locate on chart", "历史观察 · 在图表中定位")}>
          <span className={styles.recentBody}><span><strong>{view.label}</strong>{view.detail && <small> · {view.detail}</small>}</span>
            <small>{event.date ? formatDate(event.date, zh) : pick(zh, "Date unavailable", "日期不可用")} · {clock}</small></span>
          <span className={styles.recentPrice}>{view.price === null ? "—" : view.price.toFixed(2)} <span aria-hidden="true">↗</span></span>
        </button>
      })}
      {!events.length && <p className={styles.empty}>{pick(zh, "No observations in the supplied history.", "所提供的历史中暂无观察记录。")}</p>}
    </section>}
    {marketRisk}
    <button type="button" className={styles.allActivity} onClick={onActivity}>
      <span>{pick(zh, "Signal activity", "信号动态")}</span>
      <span>{historyAvailable ? pick(zh, `${events.length} events`, `${events.length}条记录`) : pick(zh, "Inspect source", "查看来源")} <span aria-hidden="true">→</span></span>
    </button>
  </div>
}
