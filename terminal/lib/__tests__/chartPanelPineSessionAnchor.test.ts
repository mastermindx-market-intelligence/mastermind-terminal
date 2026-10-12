// ChartPanel must pass the symbol's published session_anchor into every Pine run so nD
// request.security groups on the same grid ChartPanel.resampleTf uses for the chart.
// The engine already accepts RunOpts.sessionAnchor; without it, nD falls back to the
// first-loaded-session grid and names that in a warning (pine-engine/README.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPineHost } from "../pine-engine/host";
import type { Bar } from "../pine-engine";
import type { SessionAnchor } from "../sessionBars";

const chartPanel = readFileSync(
  path.resolve(__dirname, "..", "..", "components", "ChartPanel.tsx"),
  "utf8",
);

const HTF_HOLIDAYS = new Set(["2025-01-20", "2025-02-17"]);
function tradingDays(from: string, to: string): Bar[] {
  const out: Bar[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) {
    const d = new Date(t);
    const time = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || HTF_HOLIDAYS.has(time)) continue;
    const i = out.length;
    const c = 100 + ((i * 7) % 13) + i * 0.1;
    out.push({ time, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i });
  }
  return out;
}

const BARS = tradingDays("2025-01-02", "2025-04-15");
const SRC = `//@version=6
indicator("anchored")
plot(request.security(syminfo.tickerid, "3D", close), "x")
`;

async function hostPlot(opts: { sessionAnchor?: SessionAnchor | null } = {}) {
  const h = createPineHost();
  const out = await h.run({
    slot: "nd-anchor",
    source: SRC,
    bars: BARS,
    opts: { timeframe: "D", symbol: "TEST", ...opts },
  });
  h.dispose();
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  expect(out.result).toBeTruthy();
  return {
    x: out.result!.plots[0].data.map((p) => p.value),
    warnings: out.result!.warnings,
  };
}

describe("ChartPanel Pine runs pass the published session anchor", () => {
  it("host.run and oracleSignals pass sessionAnchorRef.current, and the (script,data) cache keys include it", () => {
    expect(chartPanel).toMatch(
      /opts:\s*\{\s*timeframe:\s*timeframeRef\.current,\s*symbol,\s*sessionAnchor:\s*sessionAnchorRef\.current\s*\}/,
    );
    expect(chartPanel).toMatch(
      /runPine\(ORACLE_V1_PINE,\s*daily as any,\s*\{\s*timeframe:\s*"D",\s*symbol:\s*symbolRef\.current,\s*sessionAnchor:\s*sessionAnchorRef\.current\s*\}/,
    );
    expect(chartPanel).toMatch(
      /pineCacheKey[\s\S]{0,240}JSON\.stringify\(sessionAnchorRef\.current\)/,
    );
    expect(chartPanel).toMatch(
      /oracleSignals[\s\S]{0,280}JSON\.stringify\(sessionAnchorRef\.current\)/,
    );
  });

  it("an nD request at the host boundary groups on a cloned published anchor and emits no fallback warning; omitting it reproduces the warning", async () => {
    const m = 3, a = 1;
    const published: SessionAnchor = { v: 1, date: BARS[10].time, index: 10 + a, basis: "ipo" };
    // Worker postMessage structured-clones opts; the published object must survive that copy.
    const cloned = structuredClone(published);
    expect(cloned).toEqual(published);

    const withAnchor = await hostPlot({ sessionAnchor: cloned });
    const without = await hostPlot({});

    expect(without.warnings.some((w) => w.includes("'3D'") && w.includes("no session anchor")), JSON.stringify(without.warnings)).toBe(true);
    expect(withAnchor.warnings.filter((w) => w.includes("session anchor") || w.includes("feed-phase")), JSON.stringify(withAnchor.warnings)).toEqual([]);
    expect(withAnchor.x, "the published anchor must change the nD grid").not.toEqual(without.x);

    // Independent reference: global index of row i is i+a; a group closes when (i+a)%m===0.
    const of: number[] = [];
    const last: number[] = [];
    let g = -1;
    for (let i = 0; i < BARS.length; i++) {
      if (i === 0 || (i - 1 + a) % m === 0) g++;
      of.push(g);
      last[g] = i;
    }
    const closed = last.map((l) => (l + a) % m === 0);
    const htfClose: number[] = [];
    BARS.forEach((b, i) => { htfClose[of[i]] = b.c; });
    withAnchor.x.forEach((v, i) => {
      const grp = of[i];
      const publishedIdx = closed[grp] && i >= last[grp] ? grp : grp - 1;
      if (publishedIdx < 0) expect(v, `na @${i}`).toBeUndefined();
      else expect(v, `anchored 3D @${i}`).toBeCloseTo(htfClose[publishedIdx], 9);
    });
  });
});
