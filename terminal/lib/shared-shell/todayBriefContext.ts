import { isPortfolioBrief, type Bilingual, type BriefPopulation } from "@/lib/portfolioBrief";

export type TodayBriefContext = {
  asof: string;
  stale: boolean;
  population: Pick<BriefPopulation, "mode" | "label_en" | "label_zh"> | null;
  regime: Bilingual[];
  earnings: { ticker: string; date: string }[] | null;
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const ticker = /^[A-Z0-9.\-]{1,48}$/;
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Presentation of the SAME authenticated /api/portfolio-brief response already read
 * by Today. The existing portfolioBrief validator remains the envelope authority.
 * Macro engine/portfolio_brief.py owns sections.regime and data.events.earnings_10d.
 * Dates describe that source snapshot, never a newly calculated "days until" value.
 * Missing/malformed event data is unknown; it must never become a no-events claim. */
export function todayBriefContext(value: unknown): TodayBriefContext | null {
  if (!isPortfolioBrief(value) || !date(value.asof)) return null;
  const raw = value as unknown as Record<string, unknown>;
  const data = record(raw.data) ? raw.data : null;
  const events = data && record(data.events) ? data.events : null;
  const rows = events?.earnings_10d;
  let earnings: TodayBriefContext["earnings"] = null;
  if (Array.isArray(rows) && rows.every(row => record(row) && typeof row.ticker === "string" && ticker.test(row.ticker)
    && date(row.date) && typeof row.days_to === "number" && Number.isInteger(row.days_to))) {
    const seen = new Set<string>();
    earnings = [];
    for (const row of rows as { ticker: string; date: string }[]) {
      const key = `${row.ticker}|${row.date}`;
      if (seen.has(key)) continue;
      seen.add(key); earnings.push({ ticker: row.ticker, date: row.date });
    }
  }
  return {
    asof: value.asof,
    stale: value.stale,
    population: value.population ? { mode: value.population.mode, label_en: value.population.label_en, label_zh: value.population.label_zh } : null,
    regime: value.sections.filter(section => section.key === "regime").flatMap(section => section.lines),
    earnings,
  };
}
