#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildNineBarResearchReport,
  type NineBarResearchReport,
  type ResearchBar,
  type ResearchMarket,
  type ResearchSeries,
} from "../lib/nineBarResearch";

interface DailyDocument {
  t?: string;
  src?: string;
  bar_quality?: string;
  session_anchor?: unknown;
  bars?: unknown[];
}

interface InputReceipt {
  file: string;
  symbol: string;
  market: ResearchMarket;
  source: string;
  bars: number;
  first: string;
  last: string;
  sha256: string;
}

const terminalRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(terminalRoot, "..");
const dataRoot = path.join(terminalRoot, "public", "data");
const outputJson = path.join(repositoryRoot, "docs", "research", "NINE_BAR_RESEARCH_RESULTS_2026-10-13.json");
const outputMarkdown = path.join(repositoryRoot, "docs", "research", "NINE_BAR_RESEARCH_RESULTS_2026-10-13.md");

const sha256 = (content: Buffer | string): string => createHash("sha256").update(content).digest("hex");
const pct = (value: number | null, places = 2): string => value == null ? "—" : `${(value * 100).toFixed(places)}%`;
const num = (value: number | null, places = 3): string => value == null ? "—" : value.toFixed(places);

function marketFor(symbol: string): ResearchMarket {
  return symbol.endsWith("-USD") ? "crypto" : "us";
}

function benchmarkFor(symbol: string, market: ResearchMarket): string | null {
  if (market === "crypto") return symbol === "BTC-USD" ? null : "BTC-USD";
  return symbol === "SPY" ? null : "SPY";
}

function parseBar(raw: unknown, file: string, index: number): ResearchBar {
  if (!Array.isArray(raw) || raw.length < 6) throw new Error(`${file}: malformed bar ${index}`);
  const [labelRaw, oRaw, hRaw, lRaw, cRaw, vRaw] = raw;
  const label = String(labelRaw);
  const t = Date.parse(`${label}T00:00:00Z`) / 1000;
  const values = [oRaw, hRaw, lRaw, cRaw, vRaw].map(Number);
  if (!Number.isFinite(t) || values.some((value) => !Number.isFinite(value))) throw new Error(`${file}: invalid bar ${index}`);
  return { label, t, o: values[0], h: values[1], l: values[2], c: values[3], v: values[4] };
}

function loadSeries(): { series: ResearchSeries[]; inputs: InputReceipt[] } {
  const series: ResearchSeries[] = [];
  const inputs: InputReceipt[] = [];
  for (const name of readdirSync(dataRoot).sort()) {
    if (!name.endsWith(".json")) continue;
    const fullPath = path.join(dataRoot, name);
    const bytes = readFileSync(fullPath);
    let doc: DailyDocument;
    try {
      doc = JSON.parse(bytes.toString("utf8")) as DailyDocument;
    } catch {
      continue;
    }
    if (!Array.isArray(doc.bars) || doc.bars.length < 120 || !Array.isArray(doc.bars[0]) || doc.bars[0].length < 6) continue;
    const symbol = String(doc.t || name.replace(/\.json$/i, ""));
    const bars = doc.bars.map((bar, index) => parseBar(bar, name, index));
    const market = marketFor(symbol);
    const source = [doc.src || "unknown", doc.bar_quality || "quality-unreported"].join(":");
    series.push({ symbol, market, benchmark: benchmarkFor(symbol, market), source, bars });
    inputs.push({
      file: path.relative(repositoryRoot, fullPath),
      symbol,
      market,
      source,
      bars: bars.length,
      first: bars[0].label,
      last: bars.at(-1)!.label,
      sha256: sha256(bytes),
    });
  }
  if (!series.length) throw new Error("No admitted daily research series found");
  return { series, inputs };
}

function effectRow(report: NineBarResearchReport, split: "all" | "development" | "validation" | "holdout", horizon: number) {
  return report.matchedEffects.find((row) => row.split === split && row.horizon === horizon);
}

function frictionRow(report: NineBarResearchReport, split: "all" | "development" | "validation" | "holdout", horizon: number, bps: number) {
  return report.frictionSensitivity.find((row) => row.split === split && row.horizon === horizon && row.perSideBps === bps);
}

function endpointSummary(report: NineBarResearchReport, endpoint: number, horizon: number) {
  return report.endpointSummaries.find((row) => row.endpoint === endpoint)?.byHorizon.find((row) => row.horizon === horizon)?.summary;
}

function splitSummary(report: NineBarResearchReport, split: "development" | "validation" | "holdout", horizon: number) {
  return report.splitSummaries.find((row) => row.split === split)?.byHorizon.find((row) => row.horizon === horizon)?.summary;
}

function markdown(report: NineBarResearchReport, inputs: InputReceipt[], receiptHash: string, codeHash: string, sourceHead: string): string {
  const lines: string[] = [];
  lines.push("# Nine-Bar Exhaustion — Snapshot Research Results", "");
  lines.push("Status: reproducible descriptive receipt; **not** point-in-time causal validation and **not** a reversal-probability promotion.", "");
  lines.push("## Receipt", "");
  lines.push(`- Canonical algorithm: \`${report.algorithmVersion}\``);
  lines.push(`- Source Git head at execution: \`${sourceHead}\``);
  lines.push(`- Research engine SHA-256: \`${codeHash}\``);
  lines.push(`- Machine-readable receipt SHA-256: \`${receiptHash}\``);
  lines.push(`- Admitted series: ${report.generatedFrom.series} (${report.generatedFrom.markets.us ?? 0} US equities/ETFs; ${report.generatedFrom.markets.crypto ?? 0} crypto)`);
  lines.push(`- Date coverage: ${report.generatedFrom.firstLabel ?? "—"} through ${report.generatedFrom.lastLabel ?? "—"}`);
  lines.push(`- Bars: ${report.coverage.bars.toLocaleString()}; primary first-cycle nines: ${report.coverage.primaryNines}; repeat-cycle nines: ${report.coverage.repeatNines}; matched primary nines: ${report.coverage.matchedPrimaryNines}`);
  lines.push("");

  lines.push("## What the snapshot says", "");
  lines.push("The tables report returns in the hypothesized reversal direction: positive is favorable to fading the completed directional run; negative means continuation dominated. Entry is the next admitted daily open after confirmation. Same-bar 1-ATR favorable/adverse touches remain ambiguous.", "");

  lines.push("### Is nine special versus neighboring streak lengths?", "");
  lines.push("| Endpoint | N (5-bar available) | 5-bar signed return | 5-bar reversal rate | N (10-bar available) | 10-bar signed return | 10-bar reversal rate |");
  lines.push("|---:|---:|---:|---:|---:|---:|---:|");
  for (const endpoint of report.settings.endpoints) {
    const h5 = endpointSummary(report, endpoint, 5)!;
    const h10 = endpointSummary(report, endpoint, 10)!;
    lines.push(`| ${endpoint} | ${h5.available} | ${pct(h5.meanSignedReturn)} | ${pct(h5.reversalRate)} | ${h10.available} | ${pct(h10.meanSignedReturn)} | ${pct(h10.reversalRate)} |`);
  }
  lines.push("");

  lines.push("### Primary nine by chronological split", "");
  lines.push("| Split | N (5-bar available) | 5-bar signed return | 5-bar reversal rate | N (10-bar available) | 10-bar signed return | 10-bar reversal rate |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const split of ["development", "validation", "holdout"] as const) {
    const h5 = splitSummary(report, split, 5)!;
    const h10 = splitSummary(report, split, 10)!;
    lines.push(`| ${split} | ${h5.available} | ${pct(h5.meanSignedReturn)} | ${pct(h5.reversalRate)} | ${h10.available} | ${pct(h10.meanSignedReturn)} | ${pct(h10.reversalRate)} |`);
  }
  lines.push("");

  lines.push("### Matched event-minus-baseline effect", "");
  lines.push("| Split | Horizon | Matched pairs | Symbols | Match rate | Return difference | Cluster-bootstrap 95% CI | Reversal-rate difference | 95% CI |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const split of ["all", "holdout"] as const) {
    for (const horizon of [5, 10]) {
      const row = effectRow(report, split, horizon)!;
      lines.push(`| ${split} | ${horizon} | ${row.matchedPairs} | ${row.symbols} | ${pct(row.matchRate)} | ${pct(row.meanSignedReturnDifference)} | ${row.meanSignedReturnCi95 ? `${pct(row.meanSignedReturnCi95[0])} to ${pct(row.meanSignedReturnCi95[1])}` : "—"} | ${pct(row.reversalRateDifference)} | ${row.reversalRateCi95 ? `${pct(row.reversalRateCi95[0])} to ${pct(row.reversalRateCi95[1])}` : "—"} |`);
    }
  }
  lines.push("");

  lines.push("### Friction sensitivity for primary nines", "");
  lines.push("| Split | Horizon | Per-side cost | N | Mean net signed return |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const split of ["all", "holdout"] as const) {
    for (const horizon of [5, 10]) {
      for (const bps of report.frictionPerSideBps) {
        const row = frictionRow(report, split, horizon, bps)!;
        lines.push(`| ${split} | ${horizon} | ${bps} bps | ${row.observations} | ${pct(row.meanNetSignedReturn)} |`);
      }
    }
  }
  lines.push("");

  const all5 = effectRow(report, "all", 5)!;
  const holdout5 = effectRow(report, "holdout", 5)!;
  const all10 = effectRow(report, "all", 10)!;
  const holdout10 = effectRow(report, "holdout", 10)!;
  const robust = [holdout5, holdout10].some((row) => row.meanSignedReturnCi95 && row.meanSignedReturnCi95[0] > 0);
  lines.push("## Product decision", "");
  if (robust) {
    lines.push("The static holdout contains a positive matched return effect in at least one primary horizon, but the current evidence still fails the promotion rule because it lacks point-in-time receipts and cross-market replication. Keep the product descriptive and schedule a qualified panel replication before exposing a probability or rank.", "");
  } else {
    lines.push("The static holdout does not establish a stable positive matched effect whose uncertainty excludes a trivial or negative result. Ship the mathematically correct descriptive study, but withhold reversal probability, calibrated ranking, and Buy/Sell language.", "");
  }
  lines.push(`For reference, all-sample matched return differences are ${pct(all5.meanSignedReturnDifference)} at 5 bars and ${pct(all10.meanSignedReturnDifference)} at 10 bars; holdout differences are ${pct(holdout5.meanSignedReturnDifference)} and ${pct(holdout10.meanSignedReturnDifference)}. These are snapshot associations, not causal performance.`, "");

  lines.push("## Coverage and limitations", "");
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push("- Current repository inputs contain no admitted CN/HK panel and no committed broad intraday corpus; those claims remain unavailable.");
  lines.push("- Input files and hashes are preserved in the machine-readable receipt; no vendor marketing hit rate is treated as Mastermind evidence.", "");

  lines.push("## Reproduction", "");
  lines.push("From `terminal/` with dependencies installed:", "");
  lines.push("```bash", "node_modules/.bin/vite-node scripts/run-nine-bar-research.ts", "```", "");
  lines.push("The command rewrites this report and `NINE_BAR_RESEARCH_RESULTS_2026-10-13.json` from the admitted JSON panel and the canonical TypeScript kernel.", "");

  lines.push("## Input manifest summary", "");
  lines.push("| Symbol | Market | Bars | First | Last | Source | SHA-256 (prefix) |");
  lines.push("|---|---|---:|---|---|---|---|");
  for (const input of inputs) lines.push(`| ${input.symbol} | ${input.market} | ${input.bars} | ${input.first} | ${input.last} | ${input.source} | \`${input.sha256.slice(0, 16)}…\` |`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const { series, inputs } = loadSeries();
const report = buildNineBarResearchReport(series);
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const codeHash = sha256(readFileSync(path.join(terminalRoot, "lib", "nineBarResearch.ts")));
const receiptWithoutHash = {
  schema: "terminal.nine_bar_research_receipt.v1",
  protocol: "docs/research/NINE_BAR_RESEARCH_PROTOCOL_2026-10-13.md",
  methods: "docs/research/NINE_BAR_RESEARCH_METHODS_V1_2026-10-13.md",
  dataCensus: "docs/research/NINE_BAR_DATA_CENSUS_2026-10-13.md",
  sourceHead,
  algorithmVersion: report.algorithmVersion,
  codeSha256: codeHash,
  inputs,
  report,
};
const receiptBody = `${JSON.stringify(receiptWithoutHash, null, 2)}\n`;
const receiptHash = sha256(receiptBody);
const receipt = { ...receiptWithoutHash, receiptSha256: receiptHash };
mkdirSync(path.dirname(outputJson), { recursive: true });
writeFileSync(outputJson, `${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(outputMarkdown, markdown(report, inputs, receiptHash, codeHash, sourceHead));

console.log(JSON.stringify({
  outputJson: path.relative(repositoryRoot, outputJson),
  outputMarkdown: path.relative(repositoryRoot, outputMarkdown),
  receiptSha256: receiptHash,
  coverage: report.coverage,
  all5: effectRow(report, "all", 5),
  all10: effectRow(report, "all", 10),
  holdout5: effectRow(report, "holdout", 5),
  holdout10: effectRow(report, "holdout", 10),
}, null, 2));
