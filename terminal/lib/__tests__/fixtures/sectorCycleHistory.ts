/** Synthetic contract fixture only. No captured market observations or private
 * Macro artifact is copied here. Weekdays are deterministic test coordinates,
 * not an exchange calendar; the generated values have no investment meaning. */
import { createHash } from "node:crypto";

const asOf = "2026-11-12";
const dates: string[] = [];
const day = new Date(asOf + "T00:00:00Z");
while (dates.length < 252) {
  if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.unshift(day.toISOString().slice(0, 10));
  day.setUTCDate(day.getUTCDate() - 1);
}
const subjects = [
  ["xlk", "Technology", "科技"], ["xlf", "Financials", "金融"],
  ["xle", "Energy", "能源"], ["xlv", "Health Care", "医疗保健"],
  ["xli", "Industrials", "工业"], ["xlb", "Materials", "材料"],
  ["xly", "Consumer Discretionary", "非必需消费"], ["xlp", "Consumer Staples", "必需消费"],
  ["xlc", "Communication Services", "通信服务"], ["xlu", "Utilities", "公用事业"],
  ["xlre", "Real Estate", "房地产"],
];

export const syntheticCycleHistory = {
  meta: { asOf, rs_history: {
    schema: "sector_cycles.rs_history.v1", mode: "reconstructed_price_history",
    naturally_observed: false, basis: "tr", benchmark: "SPY", horizons_sessions: [21, 63],
    max_points_per_sector: 252,
  } },
  sectors: subjects.map(([id, name, name_zh], k) => ({
    id, name, name_zh, ticker: id.toUpperCase(), kind: "sector", basis: "price",
    now: { phase: ["Recovery", "Expansion", "Trough", "Peak", "Downturn"][k % 5],
      pos: 20 + k * 6, above200d: k % 2 === 0 },
    rs_history: dates.map((date, i) => ({ date,
      rs_21d: Number((Math.sin(i / 13) * 9 + k / 3).toFixed(2)),
      rs_63d: Number((Math.cos(i / 29) * 14 - k / 5).toFixed(2)),
    })),
    turns: [
      { date: "2025-01-02", k: "trough", major: true, provisional: false, mag_pct: null, confirmed_at: "2025-04-01" },
      { date: "2025-04-01", k: "peak", major: true, provisional: false, mag_pct: null, confirmed_at: "2026-10-06" },
      { date: "2026-10-06", k: "peak", major: true, provisional: false, mag_pct: null, confirmed_at: "2026-11-05" },
      { date: "2026-11-05", k: "trough", major: true, provisional: true, mag_pct: null },
    ],
  })),
};

export const syntheticCycleHistorySha = createHash("sha256")
  .update(JSON.stringify(syntheticCycleHistory)).digest("hex");
