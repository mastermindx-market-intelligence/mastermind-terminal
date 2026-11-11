import type { Metadata } from "next";
import EmbedChart, { EmbedError } from "./EmbedChart";
import { parseSymbol, parseTheme, parseLang, parseTransparent, parseRange } from "@/lib/embed/chartData";

// Widget pages must never be indexed (they exist only to be iframed by the dossier pages).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Chart",
};

// Query-param → props. Rendered on the server; the client widget (EmbedChart) fetches the bars.
// searchParams is a Promise in the Next 16 App Router.
export default async function EmbedChartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const theme = parseTheme(first(sp.theme));
  const lang = parseLang(first(sp.lang));
  const transparent = parseTransparent(first(sp.transparent));
  const symbol = parseSymbol(first(sp.symbol));
  const range = parseRange(first(sp.range));

  // Invalid/missing symbol → clean error state, no chart, no crash.
  if (!symbol) {
    return <EmbedError theme={theme} lang={lang} transparent={transparent} />;
  }

  // ?clean=1 — the TV symbol-sheet mini chart (candles only, quiet canvas, TV palette).
  // ?fs=1    — browser fullscreen, or the actual native host’s open-full-chart handoff.
  // Both default OFF; without them the widget renders exactly as it always has.
  const clean = first(sp.clean) === "1";
  const fullscreenBtn = first(sp.fs) === "1";

  return (
    <EmbedChart
      symbol={symbol}
      theme={theme}
      lang={lang}
      transparent={transparent}
      initialRange={range}
      hideQuote={first(sp.hdr) === "0"}
      clean={clean}
      fullscreenBtn={fullscreenBtn}
    />
  );
}
