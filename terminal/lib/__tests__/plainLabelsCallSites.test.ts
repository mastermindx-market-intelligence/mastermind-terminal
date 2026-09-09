import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = join(__dirname, "../../components");

function readOwned(rel: string): string {
  return readFileSync(join(COMPONENTS, rel), "utf8");
}

function lineContaining(src: string, needle: string | RegExp, label: string): string {
  const lines = src.split("\n").filter((line) =>
    typeof needle === "string" ? line.includes(needle) : needle.test(line),
  );
  expect(lines.length, `${label}: expected a matching line`).toBeGreaterThan(0);
  return lines[0]!;
}

describe("plain-language call sites — leaky fallbacks gone", () => {
  it("MarketStateCard.tsx: no || state; on the regimeLabel line; helper imported", () => {
    const src = readOwned("gexdesk/MarketStateCard.tsx");
    const regimeLine = lineContaining(src, /const regimeLabel\s*=/, "regimeLabel assignment");
    expect(regimeLine).not.toContain("|| state;");
    expect(src).toMatch(/from ["']@\/lib\/plainLabels["']/);
    expect(src).toMatch(/\bregimeLabel\b/);
    expect(src).toMatch(/(?:regimeLabel|plainRegime)\(/);
  });

  it("StockAnalysis.tsx: no raw trust/regime/macro chips; helpers present", () => {
    const src = readOwned("StockAnalysis.tsx");
    expect(src).not.toContain("|| glance.regime");
    expect(src).not.toContain("cap(dec?.trust_tier)");
    expect(src).not.toContain("{macro.duration_en}");
    expect(src).not.toContain("{macro.regime_en}");
    expect(src).not.toContain("{macro.inflation_en}");
    expect(src).toContain("trustTierLabel(");
    expect(src).toContain("macroChipLabel(");
  });

  it("SurfacePane.tsx: no || glanceRow.regime", () => {
    const src = readOwned("surface/SurfacePane.tsx");
    expect(src).not.toContain("|| glanceRow.regime");
  });

  it("HeatmapTable.tsx: no ?? tile.sector; mappedOrNeutral present", () => {
    const src = readOwned("heatmap/HeatmapTable.tsx");
    expect(src).not.toContain("?? tile.sector");
    expect(src).toContain("mappedOrNeutral(");
  });

  it("IndicatorsModal.tsx: no CAT_TKEY[ / visible SUITE_TIER_LABEL; helpers present", () => {
    const src = readOwned("IndicatorsModal.tsx");
    expect(src).not.toContain("CAT_TKEY[");
    expect(src).not.toContain(">{SUITE_TIER_LABEL[");
    expect(src).toContain("classicCategoryLabel(");
    expect(src).toContain("planTierLabel(");
  });

  it("ScreenerView.tsx: no || r.mscRegime; notClassified helper on the regime line", () => {
    const src = readOwned("ScreenerView.tsx");
    const gexLine = lineContaining(src, "regime${r.mscRegime}", "mscRegime gexT line");
    expect(gexLine).not.toContain("|| r.mscRegime");
    expect(gexLine).toContain("notClassified(lang)");
    expect(gexLine).not.toContain("Not classified");
    expect(src).not.toContain("|| r.mscRegime");
    expect(src).toContain("verdictLabel(");
  });

  it("StockAnalysis.tsx: AnalystGauge ratingVerdict uses lang, never hardcoded English", () => {
    const src = readOwned("StockAnalysis.tsx");
    const line = lineContaining(src, "ratingVerdict(", "ratingVerdict call");
    expect(line).not.toMatch(/ratingVerdict\([^)]*,\s*false\s*\)/);
    expect(line).toMatch(/lang\s*===\s*["']zh["']/);
  });

  it("StockAnalysis.tsx: entry chip tries urgency then falls through to status", () => {
    const src = readOwned("StockAnalysis.tsx");
    const line = lineContaining(src, "entryStatusLabel(", "entry chip");
    expect(line).not.toContain("entry.urgency || entry.status");
    expect(line).toMatch(/entryStatusLabel\(\s*entry\.urgency/);
    expect(line).toContain("entry.status");
  });

  it("OptionsHubView.tsx: ZH premium column is 总权利金, never 总保费", () => {
    const src = readOwned("OptionsHubView.tsx");
    expect(src).not.toContain("总保费");
    expect(src).toContain("总权利金");
  });

  it("i18n.tsx: ohNightlyPending English names the symbol, not a root", () => {
    const src = readFileSync(join(__dirname, "../i18n.tsx"), "utf8");
    expect(src).toContain('ohNightlyPending: ["Nightly data pending for this symbol."');
    expect(src).not.toContain('ohNightlyPending: ["Nightly data pending for this root"');
  });

  it("i18n.tsx: gpGuardrail English names when not to trust it", () => {
    const src = readFileSync(join(__dirname, "../i18n.tsx"), "utf8");
    expect(src).toContain('gpGuardrail: ["When not to trust it"');
    expect(src).not.toContain('gpGuardrail: ["Guardrail"');
  });

  it("ChartPanel.tsx: oracle chip routes glance text through verdictLabel", () => {
    const src = readOwned("ChartPanel.tsx");
    expect(src).toContain('from "@/lib/plainLabels"');
    const chip = src.match(/const vLabel[\s\S]*?verdictRef\.current\.textContent/);
    expect(chip, "vLabel assignment").not.toBeNull();
    expect(chip![0]).toContain("verdictLabel(");
    expect(chip![0]).not.toContain("LIQUIDITY RECLAIM");
    expect(chip![0]).not.toContain("RE-ENTRY");
    expect(chip![0]).not.toMatch(/=\s*"STOP"/);
    expect(chip![0]).not.toMatch(/\?\s*"EARLY"/);
  });
});

describe("plain-language call sites — batch 2", () => {
  it("ChartConductor.tsx: live-steps titles route through t(), never English-only", () => {
    const src = readOwned("ChartConductor.tsx");
    expect(src).not.toContain('title={railOpen ? "Hide live steps" : "Show live steps"}');
    expect(src).not.toContain('title="Skip animations"');
    const toggle = lineContaining(src, "cmxHideSteps", "hide-steps");
    expect(toggle).toMatch(/\bt\(/);
  });

  it("IndicatorSource.tsx: read-only footnote routes through tPlain", () => {
    const src = readOwned("IndicatorSource.tsx");
    expect(src).not.toContain("Built-in indicators are read-only");
    expect(src).toMatch(/\btPlain\(/);
  });

  it("DiscoverWorkspace.tsx: tablist aria-label routes through t()", () => {
    const src = readOwned("workspaces/DiscoverWorkspace.tsx");
    expect(src).not.toContain('"Discover tabs"');
    expect(src).toContain('t("wtDiscoverTabs")');
  });

  it("ThesisWorkspace.tsx: subject kind routes through subjectKindLabel", () => {
    const src = readOwned("workspaces/ThesisWorkspace.tsx");
    expect(src).not.toContain("{entry.subject.kind}");
    expect(src).toContain("subjectKindLabel(");
  });

  it("OptionsPaywall.tsx: plan chip routes through t()", () => {
    const src = readOwned("OptionsPaywall.tsx");
    expect(src).not.toMatch(/>Essential · Pro</);
    expect(src).toContain('t("opwPlans")');
  });

  it("LoginFormLegacy.tsx: signup pitch routes through t()", () => {
    const src = readFileSync(join(__dirname, "../../app/login/LoginFormLegacy.tsx"), "utf8");
    expect(src).not.toContain("Free access to charts; Pro unlocks custom + proprietary indicators.");
    expect(src).toContain('t("lgSignupPitch")');
  });

  it("GuidePanel.tsx: academy chrome and teaching labels route through t(); tier uses planTierLabel", () => {
    const src = readOwned("GuidePanel.tsx");
    expect(src).not.toContain('"Indicator Academy"');
    expect(src).not.toContain('"At a glance"');
    expect(src).not.toContain("{candidate.tier}");
    expect(src).toContain('t("gpAcademy")');
    expect(src).toContain("planTierLabel(");
  });

  it("LevelsView.tsx: board chrome routes through t()", () => {
    const src = readOwned("levels/LevelsView.tsx");
    expect(src).not.toContain("No levels for this root yet");
    expect(src).not.toContain("Reading the gamma map");
    expect(src).not.toContain("New here? Learn the board");
    expect(src).toContain('t("lvNoLevels")');
    expect(src).toContain('t("lvLearnCta")');
  });

  it("LevelsLearn.tsx: teaching copy routes through t(), never English-only JSX", () => {
    const src = readOwned("levels/LevelsLearn.tsx");
    expect(src).not.toContain("Why price gets sticky or slippery");
    expect(src).not.toContain("The gamma weather map, in six reads");
    expect(src).not.toContain("leans against");
    expect(src).toContain('t("llHeroTitle")');
    expect(src).toContain('t("ll1title")');
  });
});

describe("plain-language call sites — batch 3", () => {
  it("OptionsFlowBoardView.tsx: chrome routes through pick(); vol>OI and side through helpers", () => {
    const src = readOwned("options/OptionsFlowBoardView.tsx");
    expect(src).not.toContain('lang === "zh" ? "资金流 · 仅供展示" : "Flow · display only"');
    expect(src).not.toContain("vol&gt;OI");
    expect(src).not.toContain("{event.side}");
    expect(src).not.toContain("~side remains heuristic");
    expect(src).not.toContain("~方向仍为启发式推断");
    expect(src).toMatch(/from ["']@\/lib\/plainLabels["']/);
    expect(src).toContain("pick(");
    expect(src).toContain("volAboveOiLabel(");
    expect(src).toContain("flowSideLabel(");
  });

  it("PineEditor.tsx: remaining chrome routes through t(), never English-only JSX", () => {
    const src = readOwned("PineEditor.tsx");
    expect(src).not.toContain(">Proprietary · read-only");
    expect(src).not.toContain('title={!isPro ? "Saving custom indicators requires Pro"');
    expect(src).not.toContain('dirty ? "Save changes"');
    expect(src).not.toContain("✓ Compiled with");
    expect(src).not.toContain("✓ Compiled successfully");
    expect(src).not.toContain("ready to add to chart");
    expect(src).not.toContain('s.locked ? "proprietary · read-only"');
    expect(src).not.toContain("${s.lang} · edited");
    expect(src).not.toContain("edited ${editedOn");
    expect(src).toContain('t("peReadOnly")');
    expect(src).toContain('t("peLangPine")');
    expect(src).toContain('t("peLangScript")');
    expect(src).toContain('t("peLastEdited")');
    expect(src).toContain('t("peNeedsPro")');
    expect(src).toContain('t("peSaveChanges")');
    expect(src).toContain('t("peCompiledOk")');
    expect(src).toContain('t("peUnsavedChanges")');
    expect(src).toContain('t("peReadyToAdd")');
  });

  it("FiltersPanel.tsx: caveats and reset route through pick()", () => {
    const src = readOwned("flowdesk/FiltersPanel.tsx");
    expect(src).not.toContain('"Direction is tick-rule heuristic — not NBBO-verified"');
    expect(src).not.toContain('"All expirations"');
    expect(src).not.toContain('"Sweep is heuristic — aggressor not NBBO-confirmed"');
    expect(src).not.toContain('"Detections from enrich artifact; absent/stale → v1 behavior, badges hidden."');
    expect(src).not.toContain('"Reset filters"');
    expect(src).not.toContain("~Buy lean");
    expect(src).not.toContain("~买方");
    expect(src).not.toContain("~Sell lean");
    expect(src).toContain("pick(");
    expect(src).toContain("flowSideLabel(");
  });

  it("FlowCard.tsx: OI token and honesty copy route through helpers / t()", () => {
    const src = readOwned("flowdesk/FlowCard.tsx");
    expect(src).not.toContain("OI {(ev.oi");
    expect(src).not.toContain("IV {((");
    expect(src).not.toContain('"spread — direction unreliable"');
    expect(src).not.toContain('"Direction lean"');
    expect(src).not.toContain('"tick-rule inferred, not NBBO-confirmed"');
    expect(src).toContain("statTokenLabel(");
    expect(src).toContain('statTokenLabel("iv"');
    expect(src).toContain('t("spreadUnreliable")');
    expect(src).toContain('t("scoreHonesty")');
    expect(src).toContain('t("directionLean")');
  });

  it("AlertDetail.tsx: dialog chrome routes through pick()", () => {
    const src = readOwned("alerts/AlertDetail.tsx");
    expect(src).not.toContain('lang === "zh" ? "警报详情" : "Alert detail"');
    expect(src).not.toContain('lang === "zh" ? "发生了什么" : "What changed"');
    expect(src).not.toContain('lang === "zh" ? "查看证据" : "View evidence"');
    expect(src).not.toContain('lang === "zh" ? "无证据链接" : "no evidence link"');
    expect(src).not.toContain('"no evidence link"');
    expect(src).toContain("pick(");
  });

  it("HeatmapView.tsx: legend and magnitude note route through t()", () => {
    const src = readOwned("heatmap/HeatmapView.tsx");
    expect(src).not.toContain('"magnitude only"');
    expect(src).not.toContain('"net put"');
    expect(src).not.toContain('"premium size"');
    expect(src).not.toContain('"net call"');
    expect(src).toContain('t("magnitudeOnly")');
    expect(src).toContain('t("netPut")');
    expect(src).toContain('t("premiumSize")');
    expect(src).toContain('t("netCall")');
  });

  it("Treemap.tsx: tooltip stats route through t() and deltaOiPutCallLabel; no raw OI token", () => {
    const src = readOwned("heatmap/Treemap.tsx");
    expect(src).not.toContain("ΔOI P/C");
    expect(src).not.toContain('"price/flow divergence — magnitude read"');
    expect(src).not.toContain('"direction is soft"');
    expect(src).not.toContain('"price only"');
    expect(src).toContain("deltaOiPutCallLabel(");
    expect(src).toContain('t("detailDivChip")');
    expect(src).toContain('t("directionIsSoft")');
    expect(src).toContain('t("tileNoFlow")');
  });

  it("CompanyIntelligenceV2Current.tsx: topic status and remaining English route through helpers / pick()", () => {
    const src = readOwned("fin/CompanyIntelligenceV2Current.tsx");
    expect(src).not.toContain('zh ? "结构已验证 · 主题增强暂不可用" : "Structure verified · topic enrichment unavailable"');
    expect(src).not.toContain('zh ? "在电话会中查看" : "Open in transcript"');
    expect(src).not.toContain("topic enrichment");
    expect(src).not.toContain("Open in transcript");
    expect(src).toContain("LEX.ciQaStructure");
    expect(src).toContain("LEX.ciOpenInTranscript");
    expect(src).toContain("topicStatusLabel(");
    expect(src).toContain("pick(");
  });

  it("CompanySourceManifest.tsx: kind and status interpolations route through helpers", () => {
    const src = readOwned("fin/CompanySourceManifest.tsx");
    expect(src).not.toContain("{source.status}");
    expect(src).toContain("sourceKindLabel(");
    expect(src).toContain("sourceStatusLabel(");
  });

  it("CompanySourceManifest.tsx: ids stay on data attributes; the visible label is house vocabulary", () => {
    const src = readOwned("fin/CompanySourceManifest.tsx");
    expect(src).not.toContain("return source.document_id");
    expect(src).not.toContain("${source.filing_key.cik}");
    expect(src).not.toContain("${source.filing_key.accession}");
    expect(src).not.toContain("{source.label}");
    expect(src).toContain("data-ci-document-id={source.document_id ?? undefined}");
    expect(src).toContain("data-ci-cik={source.filing_key?.cik}");
    expect(src).toContain("data-ci-accession={source.filing_key?.accession}");
    expect(src).toContain("sourceVisibleKindLabel(");
    // Round 5 R3a moved the label into a const so the note can be compared against it.
    expect(lineContaining(src, "const kindLabel =", "v2 visible label")).toContain("sourceVisibleKindLabel(");
    expect(lineContaining(src, "<strong>", "v2 visible label render")).toContain("{kindLabel}");
    expect(src).not.toContain("8-K / Exhibit 99.1");
    expect(src).not.toContain("EDGAR 采集行");
  });

  it("OptionCard.tsx: live/EOD quote chrome routes through t()", () => {
    const src = readOwned("prophet/OptionCard.tsx");
    expect(src).not.toContain('"Intraday live quote"');
    expect(src).not.toContain('"Intraday mid-price — updated within 20 min"');
    expect(src).not.toContain('"EOD mark — not a live quote"');
    expect(src).not.toContain('zh ? "实时" : "LIVE"');
    expect(src).not.toContain('zh ? "实时" : "Live"');
    expect(src).toContain('t("optionLiveQuote")');
    expect(src).toContain('t("optionLiveChip")');
    expect(src).toContain('t("optionLiveTip")');
    expect(src).toContain('t("optionEodTip")');
  });

  it("x/[slug]/page.tsx: snapshot chrome routes through T / TImg", () => {
    const src = readFileSync(join(__dirname, "../../app/x/[slug]/page.tsx"), "utf8");
    expect(src).not.toContain('alt="Chart snapshot"');
    expect(src).not.toContain("Created with");
    expect(src).toContain('k="xChartSnapshot"');
    expect(src).toContain('k="xCreatedWith"');
  });

  it("capture_pl6_batch3.cjs strips the Next indicator before the screenshot", () => {
    const src = readFileSync(join(__dirname, "../../e2e/tools/capture_pl6_batch3.cjs"), "utf8");
    const cropStart = src.indexOf("async function cropBox");
    const cropEnd = src.indexOf("async function cropLocator");
    expect(cropStart).toBeGreaterThan(0);
    expect(cropEnd).toBeGreaterThan(cropStart);
    const cropBox = src.slice(cropStart, cropEnd);
    expect(cropBox).toContain("assertNoNextIndicator");
    expect(cropBox.indexOf("assertNoNextIndicator")).toBeLessThan(cropBox.indexOf("page.screenshot"));
    expect(cropBox).toContain("AlertDetail-390");
    expect(cropBox).toContain("trimBottom");
    const desk = src.slice(src.indexOf("async function captureFlowDesk"), src.indexOf("async function installAlertFixtures"));
    expect(desk.indexOf("assertNoNextIndicator")).toBeGreaterThan(0);
    expect(desk.indexOf("assertNoNextIndicator")).toBeLessThan(desk.indexOf("page.screenshot"));
  });

  it("AlertTimeline.tsx: header routes through pick(); verdict through mappedOrNeutral", () => {
    const src = readOwned("alerts/AlertTimeline.tsx");
    expect(src).not.toContain('lang === "zh" ? "近期活动" : "Recent activity"');
    expect(src).not.toContain("{r.verdict}");
    expect(src).toContain("pick(");
    expect(src).toContain("mappedOrNeutral(");
  });
});

describe("plain-language call sites — batch 3 round 3", () => {
  const readLib = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

  it("OptionsFlowBoardView.tsx: the schema slug leaves every user-visible position", () => {
    const src = readOwned("options/OptionsFlowBoardView.tsx");
    expect(src).not.toContain('<code>{feedSchema');
    expect(src).toContain("data-options-flow-contract=");
    const codeLine = lineContaining(src, "<code", "feed chip");
    expect(codeLine).not.toContain("title=");
    expect(codeLine).toContain("pick(");
    expect(codeLine).not.toMatch(/>\{feedSchema/);
    expect(src).not.toMatch(/title=\{feedSchema/);
  });

  it("OptionsFlowBoardView.tsx: the call/put chips and the card clock read as words", () => {
    const src = readOwned("options/OptionsFlowBoardView.tsx");
    expect(src).not.toContain('"All C/P"');
    expect(src).not.toContain("全部 C/P");
    expect(src).not.toContain("{value || (lang");
    expect(src).toContain("optionRightLabel(");
    expect(src).not.toContain("} ET</span>");
    const clock = lineContaining(src, "formatTime(event.ts)} ", "card clock");
    expect(clock).toContain("pick(");
    expect(clock).toContain("美东");
  });

  it("FiltersPanel.tsx: score and DTE options carry real Chinese, routed through pick()", () => {
    const src = readOwned("flowdesk/FiltersPanel.tsx");
    expect(src).not.toContain('{ v: 0,  label: "Any" }');
    expect(src).not.toContain('{ v: 90, label: "90+ Elite" }');
    expect(src).not.toContain('{ key: "0d",     label: "0DTE" }');
    expect(src).toContain('zh: "不限"');
    expect(src).toContain('zh: "90+ 顶级"');
    expect(src).toContain('zh: "当日到期"');
    expect(src).toContain('zh: "90天以上"');
    expect(lineContaining(src, "SCORE_OPTIONS.map", "score row")).toContain("zh: zl");
    expect(lineContaining(src, "DTE_OPTIONS.map", "dte row")).toContain("zh: zl");
  });

  it("PineEditor.tsx: the compiling line, the error count and the inputs heading route through t()", () => {
    const src = readOwned("PineEditor.tsx");
    expect(src).not.toContain("Compiling {active.name}");
    expect(src).not.toContain("<h4>Inputs</h4>");
    expect(src).not.toContain("{lines.length} lines");
    expect(src).not.toContain('error{diag.length === 1 ? "" : "s"}');
    expect(src).toContain('t("peCompiling")');
    expect(src).toContain('t("peErrorCount")');
    expect(src).toContain('t("peErrorCountOne")');
    expect(src).toContain('t("peInputsHeading")');
    expect(src).toContain('t("peLineCount")');
  });

  it("HeatmapView.tsx: sector chips go through sectorChipLabel, never the raw English map", () => {
    const src = readOwned("heatmap/HeatmapView.tsx");
    expect(src).not.toContain("label={sc.label}");
    expect(src).toContain("sectorChipLabel(lang, sc.sector, sc.label)");
    expect(src).toMatch(/from ["']@\/lib\/heatmapStrings["']/);
  });

  it("Treemap.tsx: the sector band is localized, not the raw English GICS token", () => {
    const src = readOwned("heatmap/Treemap.tsx");
    const band = lineContaining(src, "const abbrev =", "sector band label");
    expect(band).toContain("sectorChipLabel(");
    expect(band).toContain('zh ? "zh" : "en"');
    expect(src).toMatch(/from ["']@\/lib\/heatmapStrings["']/);
  });

  it("heatmapStrings.ts: the lean label drops the tilde fragment", () => {
    const src = readLib("heatmapStrings.ts");
    const leanEntry = lineContaining(src, "detailLean:", "detailLean entry");
    expect(leanEntry).not.toContain("~");
    expect(leanEntry).toContain('["Lean", "倾向"]');
    // tonePos / toneNeg / detailVerdictSoft still carry the "(~soft)" fragment; they are
    // off-crop (DetailPanel only) and out of this batch's diff — censused for batch 4.
    expect(src).toContain("sectorChipLabel");
  });

  it("i18n.tsx: the protected-script strings are plain, not ALL CAPS jargon", () => {
    const src = readLib("i18n.tsx");
    expect(src).not.toContain('["PROPRIETARY", "自研"]');
    expect(src).not.toContain("Proprietary — protected source, editing disabled");
    // Round 5 R2: the replacement must also be TRUE of what the editor renders.
    expect(src).not.toContain("Protected script — source not shown");
    expect(src).toContain("Protected script — you can view and run it, not edit it");
    expect(src).toContain("受保护脚本：可查看和运行，不可编辑");
  });

  it("FiltersPanel.tsx: honesty doctrine does not promote lean to a likelihood claim", () => {
    const src = readOwned("flowdesk/FiltersPanel.tsx");
    expect(src).not.toContain("Likely buying");
    expect(src).not.toContain("Likely selling");
    expect(src).toContain("Leans buy (approximate)");
    expect(src).toContain("偏买入（近似）");
    expect(src).toContain("we do NOT offer a");
    expect(src).toContain("directional green/red filter gate");
    expect(src).toContain("never an affirmative likelihood claim");
  });
});

describe("plain-language call sites — batch 3 round 5", () => {
  const readLib = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
  const readE2E = (rel: string) => readFileSync(join(__dirname, "../../e2e", rel), "utf8");

  it("CompanySourceManifest.tsx: the typed-absence note is a plain reason, never the upstream detail", () => {
    const src = readOwned("fin/CompanySourceManifest.tsx");
    expect(src).not.toContain("typed_absence.detail");
    expect(src).toContain("typedAbsenceReasonLabel(source.typed_absence.reason, zh)");
    expect(src).toMatch(/from ["']\.\.\/\.\.\/lib\/companyIntelligenceLabels["']/);
    const branch = lineContaining(src, "source.typed_absence)", "typed absence branch");
    expect(branch).toContain("typedAbsenceReasonLabel(");
  });

  it("CompanySourceManifest.tsx: the note is dropped when it would only repeat the kind label", () => {
    const src = readOwned("fin/CompanySourceManifest.tsx");
    expect(src).not.toContain("<small>{v2Note(source, zh)}</small>");
    expect(src).toContain("v2NoteText !== kindLabel");
  });

  it("PineEditor.tsx: the protected badge and lock chip still route through t(\"peProtected\")", () => {
    const src = readOwned("PineEditor.tsx");
    expect(src).toContain('title={t("peProtected")}');
    expect(src).toContain("readOnly={isLocked}");
  });

  it("companyIntelligenceLabels.ts: regulatory Chinese uses 披露, never 申报", () => {
    const src = readLib("companyIntelligenceLabels.ts");
    expect(src).not.toContain("申报");
    expect(src).toContain("无法匹配该披露文件。");
  });

  it("plainLabels.ts: an unclassified source kind is not labelled as a filing", () => {
    const src = readLib("plainLabels.ts");
    expect(src).toContain("Source not classified");
    expect(src).toContain("来源未分类");
    expect(src).toContain("isFilingFamilyKind(");
  });

  it("the e2e pins on user-visible copy are literals, not the constants the app renders from", () => {
    const ci = readE2E("company-intelligence.spec.ts");
    expect(ci).not.toContain("LEX.ciQaStructure");
    expect(ci).not.toContain("LEX.ciOpenInTranscript");
    expect(ci).not.toMatch(/import \{ LEX \}/);
    expect(ci).toContain("Structure is verified. Topic labels are not available yet.");
    expect(ci).toContain("结构已验证。主题标签暂不可用。");
    expect(ci).toContain("Open in the earnings call");
    expect(ci).toContain("在电话会中查看");
    const pine = readE2E("pine-editor-integrity.spec.ts");
    expect(pine).not.toContain("LEX.peUnsavedChanges");
    expect(pine).not.toMatch(/import \{ LEX \}/);
    expect(pine).toContain('"Unsaved changes"');
  });

  it("flowdeskStrings.ts: the lean tooltip's Chinese carries no English market tokens", () => {
    const src = readLib("flowdeskStrings.ts");
    const table = src.slice(src.indexOf("leanTooltip:"), src.indexOf("leanTooltip:") + 600);
    expect(table).toContain("由成交价变动规则推断，未经官方买卖报价确认");
    expect(table).not.toContain("倾向基于tick规则推算");
    expect(table).not.toContain("无NBBO时方向为近似值（约0.41正确率）");
  });
});
