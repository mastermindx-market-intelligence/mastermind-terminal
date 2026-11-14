"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { extQuotePollMs, isPublicBoatsQuote } from "@/lib/extQuoteFreshness";
import { boatsLatestTradeLabel } from "@/lib/extQuoteCopy";
import { finite } from "@/lib/portfolioMoney";
import type { WorkspaceQuote } from "@/lib/portfolioWorkspace";
import s from "./PortfolioWorkspace.module.css";

type Overnight = { extPrice: number; extChg: number | null; extTs: number; extExpiresTs: number };

export default function PortfolioSessionQuote({ symbol, quote }: { symbol: string; quote: WorkspaceQuote }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [overnight, setOvernight] = useState<Overnight | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let next: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    let pending = false;
    async function refresh() {
      if (pending || controller.signal.aborted) return;
      clearTimeout(next);
      if (!document.hidden) {
        pending = true;
        try {
          const response = await fetch("/api/ext-quote?syms=" + encodeURIComponent(symbol), { cache: "no-store", signal: controller.signal });
          if (response.ok) {
            const row = (await response.json()).quotes?.[symbol];
            if (!controller.signal.aborted) {
              clearTimeout(expiry);
              if (isPublicBoatsQuote(row)) {
                setOvernight(row);
                expiry = setTimeout(() => setOvernight(null), Math.max(0, row.extExpiresTs * 1000 - Date.now()));
              } else setOvernight(null);
            }
          }
        } catch { /* The last qualified observation expires on its own clock. */ }
        finally { pending = false; }
      }
      if (!controller.signal.aborted) next = setTimeout(refresh, extQuotePollMs());
    }
    const visible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearTimeout(next); clearTimeout(expiry); document.removeEventListener("visibilitychange", visible); };
  }, [symbol]);
  const at = finite(quote?.asOfMs) ? quote.asOfMs : finite(quote?.ts) ? quote.ts * 1000 : null;
  const formatAt = (ms: number) => new Date(ms).toLocaleString(zh ? "zh-CN" : "en-US", { dateStyle: "short", timeStyle: "short" });
  const pct = (v: unknown) => finite(v) ? (v > 0 ? "+" : "") + v.toFixed(2) + "%" : "—";
  return <div className={s.sessionRead}>
    <div><span>{zh ? "常规时段变动" : "Regular session"}</span><strong>{pct(quote?.chg)}</strong></div>
    {at !== null && Number.isFinite(new Date(at).getTime()) && <small>{formatAt(at)}{quote?.basis ? " · " + quote.basis : ""}</small>}
    {overnight && <div className={s.night}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 15.4A8.8 8.8 0 0 1 8.6 4.5a8.6 8.6 0 1 0 11 10.9Z" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>
      <span>{boatsLatestTradeLabel(lang)} <small>{formatAt(overnight.extTs * 1000)}</small></span>
      <strong>{overnight.extPrice.toLocaleString(zh ? "zh-CN" : "en-US", { maximumFractionDigits: 4 })} · {pct(overnight.extChg)}</strong>
    </div>}
  </div>;
}
