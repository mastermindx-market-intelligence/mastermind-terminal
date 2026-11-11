"use client";
import { useLang, useT } from "@/lib/i18n";

// A small, beautiful illustration of the day's price range: a low→high track with the current
// price riding a marker positioned by where `last` sits inside [low, high]. Renders compactly in
// the topbar (`variant="bar"`) and a touch richer in the detail rail (`variant="panel"`).
const fmt = (n: number | null | undefined, d = 2) =>
  n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export default function DayRange({
  low, high, last, open, variant = "bar",
}: {
  low?: number | null; high?: number | null; last?: number | null; open?: number | null; variant?: "bar" | "panel";
}) {
  const { lang } = useLang();
  const t = useT();
  const zh = lang === "zh";
  const has = low != null && high != null && isFinite(low) && isFinite(high) && high > low;
  // A current price exists only when it is a finite number. A missing or non-finite `last` used to
  // fall back to `low` and still draw a current-price marker (in a direction) at the day's low, and
  // let NaN/±Infinity reach the percent geometry — so it now renders no current-price mark at all.
  const lastNum = typeof last === "number" && Number.isFinite(last) ? last : null;
  const dec = (last ?? high ?? 0) < 10 ? 4 : 2;
  // current position 0..1 within the day's range (clamped); the middle is the fallback for a range
  // with no current price to place in it
  const pos = has && lastNum != null ? Math.max(0, Math.min(1, (lastNum - low!) / (high! - low!))) : 0.5;
  const openPos = has && open != null && isFinite(open) ? Math.max(0, Math.min(1, (open - low!) / (high! - low!))) : null;
  const up = lastNum != null && open != null ? lastNum >= open : pos >= 0.5;
  const cur = up ? "var(--up)" : "var(--down)";

  return (
    <div className={`dayrange dr-${variant}${!has ? " dr-empty" : ""}`} title={t("dayRange")}>
      <div className="dr-cap">
        <span className="dr-lab">{t("dayRange")}</span>
        {has && <span className="dr-cur num" style={lastNum != null ? { color: cur } : undefined}>{fmt(last, dec)}</span>}
      </div>
      <div className="dr-track">
        {lastNum != null && <i className="dr-fill" style={{ width: `${pos * 100}%`, background: cur }} />}
        {openPos != null && <i className="dr-open" style={{ left: `${openPos * 100}%` }} title={zh ? "开盘" : "Open"} />}
        {lastNum != null && <i className="dr-dot" style={{ left: `${pos * 100}%`, borderColor: cur, boxShadow: `0 0 0 3px color-mix(in srgb, ${up ? "var(--up)" : "var(--down)"} 22%, transparent)` }} />}
      </div>
      <div className="dr-ends">
        <span className="dr-end lo"><em>{zh ? "低" : "L"}</em><b className="num">{fmt(low, dec)}</b></span>
        <span className="dr-end hi"><b className="num">{fmt(high, dec)}</b><em>{zh ? "高" : "H"}</em></span>
      </div>
    </div>
  );
}
