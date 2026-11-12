// Wave B3 — the LIGHT treatment specimen (seat ruling D-W1): docs/specimens/news-flow.html
// is GENERATED from the live components with react-dom/server renderToStaticMarkup, never
// hand-written; a normal run asserts the committed file is byte-identical to the fresh
// render so it cannot drift from what ships. Run with WRITE_SPECIMEN=1 to regenerate.
// Node environment: renderToStaticMarkup needs no DOM, and the tally stays at the
// 296 fallback width so the bytes are deterministic. timeZone "UTC" pins the clock bytes.
import React from "react";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NewsFlowStrip from "@/components/news/NewsFlowStrip";
import NewsLiveDot from "@/components/news/NewsLiveDot";
import stripStyles from "@/components/news/NewsFlowStrip.module.css";
import panelStyles from "@/components/news/TickerNewsPanel.module.css";
import type { TickerNewsFlow } from "@/lib/newsTypes";

const root = process.cwd();
const SPECIMEN = join(root, "docs/specimens/news-flow.html");

// ---- contract section 5 fixtures (see newsFlowContract.test.ts) ----------------

const FLOW_METHOD =
  "distinct reports by source + source_item_id; active status only; " +
  "rights-allowed sources only; UTC calendar days; median of 28 prior days";

const flowProvenance = (publishedAt: number, receivedAt: number) => ({
  velocity_schema: "qbus.news_velocity.v1",
  sources_counted: ["benzinga"],
  status_counted: "active",
  distinct_by: "source + source_item_id",
  story_grouping: "news_cluster_members.cluster_id; a report in no cluster is its own story",
  cluster_policy_version: "qbus_news_cluster.v2",
  windows: {
    reports_24h: "rolling, closed at both ends: [as_of - 24h, as_of]",
    reports_7d: "rolling, closed at both ends: [as_of - 7d, as_of]",
    daily_28d: {
      start_date: "2026-09-14",
      end_date: "2026-10-11",
      unit: "UTC calendar day",
      excludes: "the current UTC day",
      order: "oldest first",
    },
  },
  calculation: { method: FLOW_METHOD, comparison_rule: "flow_compare.v1" },
  time_basis_counts_24h: { published_at: publishedAt, received_at: receivedAt },
});

const OK_DAILY = [2, 3, 1, 4, 2, 3, 0, 5, 2, 3, 2, 3, 1, 4, 2, 3, 2, 3, 1, 3, 2, 4, 2, 3, 2, 3, 2, 3];
const THIN_DAILY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];

const FLOW_OK = {
  schema: "ticker_news.flow.v1", state: "ok", reason: null, coverage: "complete",
  as_of: "2026-10-12T10:30:00Z", reports_24h: 7, reports_7d: 21, stories_24h: 4,
  median_daily_28d: 2.5, daily_counts_28d: OK_DAILY, history_days_observed: 28,
  comparison: "busier", provenance: flowProvenance(6, 1),
} as unknown as TickerNewsFlow;
const FLOW_TYPICAL = {
  ...FLOW_OK, reports_24h: 3, reports_7d: 17, stories_24h: 2, comparison: "typical",
  provenance: flowProvenance(3, 0),
} as unknown as TickerNewsFlow;
const FLOW_QUIETER = {
  ...FLOW_OK, reports_24h: 1, reports_7d: 15, stories_24h: 1, comparison: "quieter",
  provenance: flowProvenance(1, 0),
} as unknown as TickerNewsFlow;
const FLOW_THIN = {
  schema: "ticker_news.flow.v1", state: "thin_history", reason: null, coverage: "complete",
  as_of: "2026-10-12T10:30:00Z", reports_24h: 2, reports_7d: 3, stories_24h: 2,
  median_daily_28d: null, daily_counts_28d: THIN_DAILY, history_days_observed: 6,
  comparison: "insufficient_history", provenance: flowProvenance(2, 0),
} as unknown as TickerNewsFlow;
const FLOW_PARTIAL = { ...FLOW_OK, coverage: "partial", comparison: null } as unknown as TickerNewsFlow;
const FLOW_UNAVAILABLE = {
  schema: "ticker_news.flow.v1", state: "unavailable", reason: "calculation_failed", coverage: "complete",
  as_of: null, reports_24h: null, reports_7d: null, stories_24h: null, median_daily_28d: null,
  daily_counts_28d: null, history_days_observed: null, comparison: null, provenance: null,
} as unknown as TickerNewsFlow;

// ---- frames --------------------------------------------------------------------

type Lang = "en" | "zh";
const BAR_TITLE: Record<Lang, string> = { en: "News", zh: "新闻" };

/** One 360px mock rail board: the bar (title, symbol, live dot), then the strip. */
function frame(flow: TickerNewsFlow, lang: Lang, open: boolean): string {
  return renderToStaticMarkup(
    <div className="sp-frame">
      <div className="sp-bar">
        <span className="sp-title">{BAR_TITLE[lang]}</span>
        <span className="sp-symbol">NVDA</span>
        <NewsLiveDot lang={lang} />
      </div>
      <NewsFlowStrip flow={flow} lang={lang} initialOpen={open} timeZone="UTC" />
    </div>,
  );
}

const FRAMES: ReadonlyArray<readonly [string, TickerNewsFlow, boolean]> = [
  ["busier", FLOW_OK, false],
  ["typical", FLOW_TYPICAL, false],
  ["quieter", FLOW_QUIETER, false],
  ["thin", FLOW_THIN, false],
  ["partial", FLOW_PARTIAL, false],
  ["unavailable", FLOW_UNAVAILABLE, false],
  ["busier-open", FLOW_OK, true],
  ["thin-open", FLOW_THIN, true],
];

function section(theme: "dark" | "light", lang: Lang): string {
  const heading = theme === "dark" ? "Dark treatment (ships)" : "Light treatment (specimen only, not shipped)";
  const frames = FRAMES.map(([, flowFixture, open]) => frame(flowFixture, lang, open)).join("\n");
  return `<section data-specimen-theme="${theme}" data-specimen-lang="${lang}">\n<h2>${heading}</h2>\n${frames}\n</section>`;
}

// ---- the one inline <style>, assembled in the pinned order ----------------------

const TOKENS = [
  "--panel", "--panel-2", "--text", "--text-2", "--muted", "--text-dim",
  "--line", "--line-2", "--line-3", "--brand-2", "--font-ui", "--font-num",
] as const;

const globalsCss = readFileSync(join(root, "app/globals.css"), "utf8");
const rootBlock = globalsCss.match(/:root\{[\s\S]*?\n\}/)?.[0] ?? "";
if (!rootBlock) throw new Error("specimen: the :root block was not found in app/globals.css");

const darkTokenCss = `[data-specimen-theme="dark"]{
${TOKENS.map((name) => {
  const found = rootBlock.match(new RegExp(`${name}(?![\\w-])\\s*:\\s*([^;]+);`));
  if (!found) throw new Error(`specimen: token ${name} was not found in app/globals.css`);
  return `  ${name}:${found[1].trim()};`;
}).join("\n")}
  --font-inter:"Inter",-apple-system,"Segoe UI",Roboto,"Noto Sans CJK SC",sans-serif;
}`;

const stripCss = readFileSync(join(root, "components/news/NewsFlowStrip.module.css"), "utf8");
const panelCss = readFileSync(join(root, "components/news/TickerNewsPanel.module.css"), "utf8");
const lightCss = readFileSync(join(root, "docs/specimens/news-flow.light.css"), "utf8");

/** Class names that appear as selectors in a module file (P12 regex). */
const classSelectorNames = (css: string): string[] =>
  [...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)(?=[^{}]*\{)/g)].map((m) => m[1]))];

const stripMap: Record<string, string> = {};
for (const name of classSelectorNames(stripCss)) {
  stripMap[name] = (stripStyles as unknown as Record<string, string>)[name] ?? name;
}
const liveDotMap: Record<string, string> = {
  liveDot: (panelStyles as unknown as Record<string, string>).liveDot,
};

/** Rewrite whole class names only: .name not followed by [\w-] (P12). */
const rewriteCss = (css: string, map: Record<string, string>): string =>
  css.replace(/\.([A-Za-z_][\w-]*)(?![\w-])/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(map, name) ? `.${map[name]}` : whole);

const liveDotRule = panelCss.match(/\.liveDot\{[^}]*\}/)?.[0];
if (!liveDotRule) throw new Error("specimen: the .liveDot rule was not found in TickerNewsPanel.module.css");

const layoutCss = `body{margin:0;padding:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:28px;background:#0a0b0e;font-family:-apple-system,"Segoe UI",Roboto,sans-serif}
section{display:grid;gap:12px;align-content:start;min-width:0}
h2{margin:0;font:600 14px/1.4 var(--font-ui);color:var(--text)}
.sp-frame{width:360px;max-width:100%;height:420px;border:1px solid var(--line);border-radius:6px;overflow:hidden;display:flex;flex-direction:column;background:var(--panel)}
.sp-bar{display:flex;align-items:center;gap:8px;min-height:40px;padding:8px 11px;border-bottom:1px solid var(--line);flex:none}
.sp-title{font:700 11.5px/1 var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text)}
.sp-symbol{font:600 10.5px/1 var(--font-num);color:var(--muted)}`;

const styleCss = [
  darkTokenCss,
  rewriteCss(stripCss, stripMap),
  rewriteCss(liveDotRule, liveDotMap),
  rewriteCss(lightCss, { ...stripMap, ...liveDotMap }),
  layoutCss,
].join("\n");

const specimenHtml = `<!-- Generated by lib/__tests__/newsFlowSpecimen.test.tsx (WRITE_SPECIMEN=1). Do not edit by hand.
     Dark custom properties are parsed from app/globals.css, never hand-copied. Only
     --font-inter — a next/font variable a static file cannot resolve — is defined locally
     inside the dark scope. Light styling lives only in docs/specimens/news-flow.light.css
     (seat ruling D-W1: LIGHT ships as this specimen, never as a runtime theme). -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${styleCss}
</style>
</head>
<body>
${section("dark", "en")}
${section("dark", "zh")}
${section("light", "en")}
${section("light", "zh")}
</body>
</html>
`;

if (process.env.WRITE_SPECIMEN === "1") {
  mkdirSync(join(root, "docs/specimens"), { recursive: true });
  writeFileSync(SPECIMEN, specimenHtml, "utf8");
}

describe("news-flow specimen (D-W1: generated from the live components)", () => {
  it("renders four sections (dark/light × EN/ZH) with all eight frames each", () => {
    expect((specimenHtml.match(/<section data-specimen-theme="dark"/g) ?? []).length).toBe(2);
    expect((specimenHtml.match(/<section data-specimen-theme="light"/g) ?? []).length).toBe(2);
    expect((specimenHtml.match(/<section data-specimen-theme="[^"]*" data-specimen-lang="en"/g) ?? []).length).toBe(2);
    expect((specimenHtml.match(/<section data-specimen-theme="[^"]*" data-specimen-lang="zh"/g) ?? []).length).toBe(2);
    // 4 sections × 8 frames = 32 strips
    expect((specimenHtml.match(/data-flow-state/g) ?? []).length).toBe(32);
  });

  it("labels the two treatments plainly", () => {
    expect(specimenHtml).toContain("Dark treatment (ships)");
    expect(specimenHtml).toContain("Light treatment (specimen only, not shipped)");
  });

  it("carries no data-theme and no title attribute", () => {
    expect(specimenHtml).not.toContain("data-theme=");
    expect(specimenHtml).not.toContain("title=");
  });

  it("embeds the module CSS rewritten to the rendered class names", () => {
    expect(specimenHtml).toContain(`.${stripStyles.flow}{`);
    expect(specimenHtml).toContain(`.${panelStyles.liveDot}{`);
    expect(specimenHtml).toContain(`[data-specimen-theme="light"] .${stripStyles.flow}{`);
  });

  it("the committed file is byte-identical to the fresh render (WRITE_SPECIMEN=1 regenerates)", () => {
    expect(existsSync(SPECIMEN)).toBe(true);
    expect(readFileSync(SPECIMEN, "utf8")).toBe(specimenHtml);
  });
});
