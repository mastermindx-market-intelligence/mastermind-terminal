/** A source event remains history even when its recency changes the regime read. */
export interface OracleHistoricalSignal {
  type: string;
  chartTs: string;
  /** Explicit source availability only; a chart/bar date never fills this field. */
  knownTs: string | null;
  label: string;
  date: string;
  confirmed: boolean;
}

export interface OracleEntryAvailability {
  status: "UNAVAILABLE_DATA";
  label: string;
  reason: string;
}

/** No qualified Oracle strategy/horizon/current-entry owner is bound to this consumer.
 * Prophet B4 availability is strategy-specific and cannot qualify an Oracle entry. */
export function oracleEntryAvailability(zh = false): OracleEntryAvailability {
  return {
    status: "UNAVAILABLE_DATA",
    label: zh ? "入场机会尚未核实" : "Entry availability not verified",
    reason: zh ? "缺少适用于神谕的当前入场数据源" : "No qualified current Oracle entry source",
  };
}

export interface Verdict {
  historicalSignal?: OracleHistoricalSignal | null;
  entryAvailability?: OracleEntryAvailability;
  label: string;
  color: string;
  raw: string | null;
  /** small sub-line under the verdict: signal date (oracle) / data as-of date (desk) */
  sub?: string | null;
  /** true = too old (or undated) to render as a live opinion — the UI strips its visual authority */
  dim?: boolean;
  /** extra tooltip context: horizon label, signal price, lane disagreements */
  note?: string | null;
  /** primary line is a STANCE (posture read from current regime state), not a signal event.
   *  Stances are descriptive nouns — never a Buy/Sell verb — and render in the stance style
   *  (no tint, hollow star) so they can't be mistaken for an evidence-cleared signal. */
  stance?: boolean;
  /** a real, dated engine event that is NOT in the scored lane (RECLAIM re-entry) — renders
   *  dated and colored but without full signal authority (hollow treatment). */
  soft?: boolean;
  /** the engine refused an entry trigger that is still live (dated, within the staleness
   *  window) — true whether that refusal IS the primary read or rides under a fresher
   *  anchor, so the same engine state can never render as two different-looking cards. */
  blocked?: boolean;
  /** the refused entry sits inside a deep group washout (ratified 2026-08-10; live notch
   *  `WASHOUT_NOTCH`) — a DISPLAY class on the same refusal, never a permission to enter. */
  overrideCandidate?: boolean;
  /** the anchor IS a waived entry (signal era gc_v2_wo2): either the regime gate refused it
   *  and the washout conditional took it (`override_take`), or the keeper blocked it and the
   *  ratified reclaim waiver dropped its 200-reclaim leg (`reclaim_override_take`). A REAL
   *  entry — the verdict keeps the ordinary entry label and color — carrying the washout
   *  context beside it. */
  overrideTake?: boolean;
  /** the anchor is a RETRO PROJECTION: a pre-fence refusal today's rule would have entered.
   *  A counterfactual, never a call — it is display-only, so it never actually reaches this
   *  field through the scored lane; it is here for the surfaces that render marked history. */
  retro?: boolean;
  /** second glance-tier line under the verdict. Today only the washout-override disclosure
   *  uses it: the card says which group is washed out and by how much, in plain words. */
  line2?: string | null;
}

// A verdict older than this many calendar days (≈5 of the engine's 3-day bars) is history,
// not an opinion — it renders dimmed with its date instead of at full color strength.
export const ORACLE_STALE_DAYS = 21;

/** shared staleness test for manifest rows carrying `vts` (the scored verdict's availability date) —
 *  screener/search/portfolio pills demote to the .stale treatment past the threshold */
export function verdictIsStale(vts?: string | null, now: number = Date.now()): boolean {
  if (!vts) return false; // undated rows keep today's render; only a KNOWN old date demotes
  const t = Date.parse(vts);
  return Number.isFinite(t) && (now - t) / DAY_MS > ORACLE_STALE_DAYS;
}

const DAY_MS = 86_400_000;

function ageDays(ts: string | null | undefined, now: number): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
}

function fmtDate(ts: string, zh: boolean): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return ts;
  return new Date(t).toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Availability-date contract for signal reads. `ts` remains the chart/bar coordinate;
 *  `known_ts` is when the event was actually observable. Legacy slices fall back to `ts`. */
export function signalKnownTs(
  signal?: { ts?: unknown; known_ts?: unknown } | null,
): string | null {
  const known = signal?.known_ts;
  if (typeof known === "string" && known && Number.isFinite(Date.parse(known))) return known;
  const chartTs = signal?.ts;
  return typeof chartTs === "string" && chartTs ? chartTs : null;
}

/** trend state as computed client-side by lib/trend.ts (TrendRow already ships it) */
export type StanceTrend = "UPTREND" | "PULLBACK" | "RANGE" | "DOWNTREND" | null;

/** the per-ticker slice.json — only the fields the verdict reads */
interface OracleSlice {
  indicator?: {
    state?: {
      last_signal?: string | null;
      last_scored_signal?: string | null;
      last_scored_ts?: string | null;
      position_hint?: string | null;
      bars_since_signal?: number | null;
      /** basis of the signal that set position_hint — "structure_stop" on a stopped-out flat */
      last_scored_basis?: string | null;
      /** DEPRECATED MISNOMER: carries strong_bull (weekly+monthly bull & above 200d).
       *  NOT overbought, and NOT the cycles pipeline's "Extended — don't chase" caution
       *  (that one rides `overbought`). Read strong_bull/overbought by name; this alias
       *  exists only so pre-2026-07-15 slices keep parsing. Do not add new readers. */
      extended?: boolean | null;
      strong_bull?: boolean | null;
      /** the true Pine extendedNow (RSI>=70 or %K>=80) — absent on pre-2026-07-15 slices */
      overbought?: boolean | null;
      weeklyBull?: boolean | null;
      above200?: boolean | null;
    } | null;
    signals?: Array<{
      ts: string; known_ts?: string | null; type?: string; price?: number | null;
      quality?: string | null; quality_reason?: string | null; scored?: boolean | null;
      subtype?: string | null;
      prior_stop_level?: number | null;
      sweep_low?: number | null;
      risk_basis?: string | null;
      /** what machine produced the event — "structure_stop" on every SELL */
      basis?: string | null;
      /** the v2 regime gate REFUSED this entry; type still reads BUY/REBUY for back-compat */
      blocked?: boolean | null;
      /** SELL only: the confirmed swing low the daily close broke */
      stop_level?: number | null;
      /** display-tier washout-override class (signal_layer/washout_override.py). Set only on
       *  a refusal that qualified — a TAKEN override carries `quality:"override_take"` and
       *  no flag, because it is an entry, not a decorated refusal. */
      override_candidate?: boolean | null;
      /** display-only retro projection: today's rule would have entered this pre-fence
       *  refusal. Never an entry — see `isRetroOverride`. */
      retro_override?: boolean | null;
      retro_ctx?: { group_id?: string | null; name?: string | null; name_zh?: string | null } | null;
      override_ctx?: {
        group_id?: string | null;
        /** peer-median 252d drawdown as a NEGATIVE fraction (−0.388 = 38.8% off the high) */
        peer_dd?: number | null;
        basis?: string | null;
        thresholds_hit?: number[] | null;
        as_of?: string | null;
        name?: string | null;
        name_zh?: string | null;
      } | null;
    }> | null;
  } | null;
}

type OracleState = NonNullable<NonNullable<OracleSlice["indicator"]>["state"]>;
type OracleSignal = NonNullable<NonNullable<OracleSlice["indicator"]>["signals"]>[number];

const BUYISH = ["BUY", "REBUY", "ADD"];
const SELLISH = ["SELL", "CUT", "TRIM"];
// engine-flagged soft qualities: annotate the tooltip; regime_blocked additionally means
// "the engine refused this entry" — it must never anchor the verdict (contracts.py contract).
// Exported: ChartPanel.renderSignals gates marker softness on this SAME set, so a new
// engine quality string lands on both surfaces at once (add it here, nowhere else).
//
// "override_take" is DELIBERATELY ABSENT and must stay absent: it is an entry the mask took,
// not a refusal the engine flagged, so softening it would subordinate a marker the engine
// stands behind. Its distinctness is carried by the amber outline and the disclosure line,
// never by demoting the entry.
export const SOFT_Q: ReadonlySet<string> = new Set(["pending", "block", "regime_blocked"]);

/** A prominent, risk-defined bottom candidate. It is intentionally not a confirmed BUY:
 *  the own-name washout context is present, but the classic trend gate has not cleared. */
export function isBottomWatch(
  s?: { type?: unknown } | null,
): boolean {
  return !!s && String(s.type ?? "").toUpperCase() === "BOTTOM_WATCH";
}

/** A fast thesis re-arm after price closes back above a freshly broken structure stop. */
export function isStopSweepReclaim(
  s?: { type?: unknown; quality?: unknown } | null,
): boolean {
  return !!s
    && String(s.type ?? "").toUpperCase() === "RECLAIM"
    && String(s.quality ?? "").toLowerCase() === "stop_sweep_reclaim";
}

/** Keep the two opportunity producers visually distinct without teaching the chart their
 *  evolving definition slugs. Unknown/legacy sources retain the Prophet fallback. */
export function opportunityMarkerGlyph(source?: unknown): "P" | "R" {
  return String(source ?? "").toLowerCase().includes("reversal") ? "R" : "P";
}

/** HK-O1: the v2 regime gate REFUSED this entry. The emitter keeps `type` at BUY/REBUY so
 *  every pre-existing reader still parses, so THIS — never the type — is the render and
 *  scoring key. Reads the explicit flag first and falls back to the legacy quality string
 *  (slices emitted before 2026-08-08 carry only the string).
 *  Contract: a blocked setup is never drawn with buy geometry, never enters a Buy panel
 *  state or the latest-signal card, and never anchors a verdict. */
export function isBlockedSignal(
  s?: { blocked?: unknown; quality?: unknown } | null,
): boolean {
  if (!s) return false;
  return s.blocked === true || String(s.quality ?? "").toLowerCase() === "regime_blocked";
}

/** The display-tier washout-override class: a regime-refused entry whose thematic-basket peers
 *  sat ≥25% below their 252d highs the day it fired. Ratified 2026-08-10 (Macro Dashboard
 *  research/BLOCKED_ENTRY_RATIFICATION_PACKET_2026-08-10.md §2/§4, threshold 25%).
 *
 *  STRICT on the emitter's flag. The class is only ever minted point-in-time by
 *  signal_layer/washout_override.py from the `quality:"regime_blocked"` cohort — a keeper
 *  `block` (a different refusal) never carries it — so the client re-derives nothing. It
 *  changes how a refusal LOOKS, never what it is: the entry is still refused. */
export function isOverrideCandidate(
  s?: { override_candidate?: unknown } | null,
): boolean {
  return !!s && s.override_candidate === true;
}

/** The engine quality string of a TAKEN washout override (signal_layer/contracts.py
 *  OVERRIDE_TAKE_QUALITY). Its own class, not a keeper verdict — see below. */
export const OVERRIDE_TAKE_QUALITY = "override_take";

/** The engine quality string of a fire whose KEEPER 200-reclaim leg was waived (Arm T,
 *  signal era gc_v2_wo2; signal_layer/washout_override.RECLAIM_OVERRIDE_TAKE_QUALITY).
 *
 *  A SIBLING of the class above, never the same string. Both are entries the engine stands
 *  behind and both behave identically on every surface — the difference is which refusal was
 *  relieved (the regime veto vs one leg of the keeper's counter-trend confirmation) and,
 *  downstream, which forward ledger grades them. Two rules, two track records, two strings. */
export const RECLAIM_OVERRIDE_TAKE_QUALITY = "reclaim_override_take";

/** The live washout notch, in percent. SOURCE OF TRUTH IS PYTHON —
 *  signal_layer/washout_override.WASHOUT_OVERRIDE_NOTCH — and `tests/test_notch_parity.py`
 *  greps this file so the two can never drift silently. Moving it is an era event there;
 *  here it is only ever a mirror of that move. */
export const WASHOUT_NOTCH: number = 20;

/** The notch the published per-trade evidence was measured at. NOT the same thing as the live
 *  notch, and deliberately a separate constant: a dial move does not re-measure a result, so
 *  the two are free to diverge and the copy goes quiet when they do (see `washoutOverrideCopy`).
 *  They are equal today because the 20% row was re-graded and published for this build. */
export const WASHOUT_MEASURED_NOTCH: number = 20;

/** The washout-override ENTRY: a regime-refused fire the live enter mask TOOK because the
 *  name's thematic-basket peers sat at/below the ratified notch on the day it fired
 *  (signal era gc_v2_wo1; Macro Dashboard research/BLOCKED_ENTRY_CONDITIONAL_PREREG.md §4/§5).
 *
 *  This is NOT `isOverrideCandidate`'s class and the two can never both be true. A candidate
 *  is a refusal wearing extra weight; this is an entry. Concretely, for a fire that reads
 *  true here: `isBlockedSignal` is false, it is absent from SOFT_Q, it anchors the verdict,
 *  it walks position_hint, and it fires alerts. Strict on the emitter's string for the same
 *  reason the candidate class is strict on its flag — the client re-derives nothing. */
export function isOverrideTake(
  s?: { quality?: unknown } | null,
): boolean {
  return !!s && String(s.quality ?? "").toLowerCase() === OVERRIDE_TAKE_QUALITY;
}

/** The KEEPER's waived entry (era gc_v2_wo2): a block whose next-bar hold PASSED and whose
 *  200-reclaim leg the ratified waiver dropped for a qualifying name. Everything said about
 *  `isOverrideTake` holds here verbatim — real entry, absent from SOFT_Q, anchors the
 *  verdict, walks position_hint, alerts. Strict on the emitter's string, like its sibling. */
export function isReclaimOverrideTake(
  s?: { quality?: unknown } | null,
): boolean {
  return !!s && String(s.quality ?? "").toLowerCase() === RECLAIM_OVERRIDE_TAKE_QUALITY;
}

/** EITHER waived entry class. The render key for every surface that treats the two alike —
 *  which is every surface except the one line of copy that names which leg was relieved. */
export function isWaivedEntry(
  s?: { quality?: unknown } | null,
): boolean {
  return isOverrideTake(s) || isReclaimOverrideTake(s);
}

/** The RETRO PROJECTION: a pre-fence refusal that today's rule would have entered
 *  (signal_layer/washout_override.mark_retro). Emitter-stamped, never re-derived here.
 *
 *  READ THIS AS A COUNTERFACTUAL, NOT A CALL. The engine refused this fire when it fired;
 *  the mark says only that the rule now in force would not have. Every surface that renders
 *  it must carry that distinction in words a reader can see WITHOUT hovering — a
 *  counterfactual painted as an entry is a track record nobody earned. */
export function isRetroOverride(
  s?: { retro_override?: unknown } | null,
): boolean {
  return !!s && s.retro_override === true;
}

/** A peer-median 252d drawdown → the glance-tier figure. Truncated toward zero, not rounded:
 *  understating a washout is the safe direction for a number that sits next to a refusal. */
function fmtPeerDd(peerDd: number | null | undefined): string | null {
  if (typeof peerDd !== "number" || !Number.isFinite(peerDd)) return null;
  const pct = Math.trunc(Math.abs(peerDd) * 100);
  return pct > 0 ? `−${pct}%` : null;
}

interface OverrideCtx {
  group_id?: string | null;
  peer_dd?: number | null;
  name?: string | null;
  name_zh?: string | null;
}

/** The washout-override disclosure: one glance line + the Tier-2 numbers behind it.
 *
 *  TWO SHAPES, ONE VOICE. `taken=false` (the default, and every pre-fence historical fire)
 *  is the DISPLAY class: the engine refused this entry and the washout is context. Since the
 *  gc_v2_wo1 era fence, `taken=true` is the ENTRY: the same washout is now the reason the
 *  engine took it. Only the lead clause differs — the two numbers behind it are the same
 *  evidence, and the stop clause matters MORE once the fire is a real entry, not less.
 *
 *  COPY LAW (docs/DESIGN_DOCTRINE.md + the terminal banned-vocabulary rule): plain words, no
 *  study names, no refutation language, and never a verb that reads as permission. The lead
 *  clause exists because the glance line alone is ambiguous in BOTH directions — a candidate
 *  could be misread as a green light, and an entry could be misread as an ordinary one when
 *  it is the one class that entered against the regime gate. Say which, first. The numbers
 *  are the packet's equal-notional read at the 25% notch (cell +26.5% vs complement +3.45%,
 *  held-out 2019+, stop honored on every trade); the stop-out clause is §3.5 ("stop-outs
 *  dominate trade count at every setting"). */
export function washoutOverrideCopy(
  ctx: OverrideCtx | null | undefined,
  zh: boolean,
  taken: boolean | WashoutCopyKind = false,
): { line: string; notes: string[] } | null {
  const kind: WashoutCopyKind = taken === true ? "entry" : taken === false ? "candidate" : taken;
  const dd = fmtPeerDd(ctx?.peer_dd);
  const group = (zh ? ctx?.name_zh || ctx?.name : ctx?.name) || null;
  const head = kind === "reclaim"
    ? (zh ? "免收复200日线入场" : "Reclaim waived — entry")
    : kind === "entry"
      ? (zh ? "深度洗盘例外入场" : "Washout override entry")
      : (zh ? "深度洗盘例外候选" : "Washout override candidate");
  // Four honest shapes, because the artifact may ship a name, a number, both, or neither —
  // and a disclosure line that prints an empty slot is worse than a shorter one.
  const who = group ?? (dd ? (zh ? "同类" : "peer group") : null);
  const where = who == null
    ? null
    : dd == null
      ? who
      : zh ? `${who}板块距高点 ${dd}` : `${who} ${dd} from highs`;
  const lead = kind === "reclaim"
    ? (zh
      ? "确认条件本会拦截 — 次根K线已站稳，只差收复200日线；同类深度洗盘是放行的唯一理由"
      : "the keeper would refuse this — it held the next bar but never reclaimed the 200-day; "
        + "the deep group washout is the one reason it stands")
    : kind === "entry"
      ? (zh
        ? "趋势闸本会拦截 — 同类深度洗盘是放行的唯一理由"
        : "the regime gate would refuse this — the deep group washout is the one reason it stands")
      : (zh
        ? "仍是被拦截的入场 — 洗盘标记是背景，不是放行"
        : "still a refused entry — the washout flag is context, not a green light");

  const notes = [lead];
  // THE MEASURED FIGURES ARE PINNED TO THE NOTCH THEY WERE MEASURED AT, and the guard below
  // is what keeps them there. The dial is an operator setting; the result is a measurement,
  // and a dial move does not re-measure anything. When the two constants diverge this line
  // goes SILENT rather than attach one notch's result to another notch's rule.
  //
  // Currently both are 20, so it prints the 20% row: equal-notional +21.97% inside qualifying
  // windows vs +3.05% outside, held-out 2019+, production-basis Gate B re-grade. Receipt:
  // macro repo research/blocked_entry_study/regrade_receipts.json →
  // gate_table["20"].B_PROD.{eq_notional_cell, eq_notional_complement}. (The +27%/+3% this
  // line carried before wo2 was the 25% row and is NOT interchangeable with it.)
  if (WASHOUT_NOTCH === WASHOUT_MEASURED_NOTCH) {
    notes.push(zh
      ? "同类深度洗盘中，这些被拦截信号每笔平均 +22%，其他情形 +3%（2019-2026，始终执行止损）"
      : "in deep group washouts like this, these blocked signals averaged +22% per trade vs +3% otherwise (2019-2026, stop always honored)");
  }
  notes.push(zh
    ? "多数仍会止损离场 — 止损才是保护"
    : "most still stop out — the stop is the protection");
  return { line: where ? `${head} — ${where}` : head, notes };
}

/** Which of the three washout copy shapes to write. `candidate` = a refusal wearing the
 *  washout as context; `entry` = the regime veto was overridden; `reclaim` = the keeper's
 *  200-reclaim leg was waived. One voice, three lead clauses. */
export type WashoutCopyKind = "candidate" | "entry" | "reclaim";

/** The RETRO PROJECTION disclosure — the counterfactual, said plainly, at glance tier.
 *
 *  COPY LAW: this is the one class on the chart the engine did NOT act on, so the line leads
 *  with the counterfactual mood ("would have") and the note states the fact plainly ("the
 *  system refused this live"). No study names, no refutation language, and — the point — no
 *  wording that could be read as a call the product made. The line is glance tier ON PURPOSE:
 *  a hover-only disclosure is invisible on touch, in a screenshot, and to anyone skimming. */
export function retroOverrideCopy(
  ctx: { group_id?: string | null; name?: string | null; name_zh?: string | null } | null | undefined,
  zh: boolean,
  ruleDate?: string | null,
): { line: string; notes: string[] } {
  const group = (zh ? ctx?.name_zh || ctx?.name : ctx?.name) || ctx?.group_id || null;
  const head = zh ? "按当前规则本会入场" : "Would have entered under today's rule";
  // WHICH rule the counterfactual is measured against, when the caller knows it. Optional so the
  // shape is unchanged for callers that do not name a date (the card's Tier-2 notes); the chart
  // marker names it, because a "current rule" a reader cannot date is a claim they cannot check.
  // The em dash rides the head so the undated string stays BYTE-IDENTICAL to the one that
  // shipped (spaces either side), while the dated zh form closes its full-width bracket straight
  // onto the dash — 中文 does not put a space after `）`, and the card's own row title reads
  // `按当前规则事后重标（2026-08-10）— …`.
  const reHead = ruleDate
    ? (zh ? `事后按当前规则重标（${ruleDate}）—` : `re-marked under the current rule (${ruleDate}) —`)
    : (zh ? "事后按当前规则重标 —" : "re-marked under the current rule —");
  return {
    line: group ? `${head} — ${group}` : head,
    notes: [
      zh
        ? `${reHead} 当时系统并未入场，这不是当时的判断`
        : `${reHead} the system refused this live, so it is not a call we made`,
      zh ? "仅供参考，不计入战绩" : "shown for context; it is not in the track record",
    ],
  };
}

/** The date the current washout rule took effect — named in every retro surface so a reader can
 *  see WHICH rule the counterfactual is measured against, not merely that there is one. Lives
 *  beside the copy that prints it; ChartPanel imports it rather than keeping its own literal. */
export const RETRO_RULE_DATE = "2026-08-10";

/** What a chart marker's hover/tap tooltip says, in the reader's language.
 *
 *  ── WHY THIS IS HERE AND NOT IN ChartPanel ────────────────────────────────────────────────
 *
 *  Until the marker-tooltip repair, none of these strings had ever rendered: the signal layer is
 *  `pointer-events:none`, so no native SVG `<title>` on it displayed for anyone. They were
 *  therefore written as hand-rolled ENGLISH literals inside ChartPanel's render loop — near
 *  duplicates of the reviewed bilingual copy already in this module, and invisible to the
 *  bilingual-UI law because nobody could see them. Making them visible made that a live
 *  regression for zh readers, so they moved here and route through the reviewed copy.
 *
 *  Every clause below comes from copy that already shipped in both languages —
 *  `washoutOverrideCopy` / `retroOverrideCopy` for the washout classes, the rail card's own
 *  regime-gate and structure-stop sentences for the rest — so this function chooses COMPOSITION,
 *  never wording. It is the single source of truth for what a marker says; ChartPanel formats
 *  nothing and the rendered tooltip is this string verbatim.
 *
 *  Branch ORDER mirrors ChartPanel's draw order exactly and is load-bearing: a retro fire is
 *  excluded from the refusal branch (it wears entry geometry), and a washout candidate is still a
 *  REFUSAL, so it must say "not an entry" before it says anything about the washout. */
export function markerTooltipCopy(
  m: {
    t: string;
    type: string;
    quality?: string | null;
    reason?: string;
    blocked?: boolean;
    stopLevel?: number | null;
    overrideCandidate?: boolean;
    overrideTake?: boolean;
    reclaimWaived?: boolean;
    retro?: boolean;
    overrideCtx?: OverrideCtx | null;
    retroCtx?: { group_id?: string | null; name?: string | null; name_zh?: string | null } | null;
    basis?: string;
    scored?: boolean | null;
    subtype?: string | null;
    priorStopLevel?: number | null;
    sweepLow?: number | null;
    riskBasis?: string | null;
    source?: string | null;
    definition?: string | null;
    rank?: number | null;
    returnPct?: number | null;
    authority?: string | null;
  },
  zh: boolean,
): string | null {
  const at = `${m.t} · `;
  // the engine's `quality_reason` is a raw diagnostic slug and is passed through untranslated,
  // exactly as the rail card's own row hover does — parenthesised in zh, dashed in en.
  const reason = m.reason
    ? (zh ? `（${m.reason}）` : ` — ${m.reason}`)
    : "";

  // Prophet candidates are historical source receipts, never repainted as Oracle calls.
  if (m.type === "PROPHET") {
    const reversal = opportunityMarkerGlyph(m.source) === "R";
    const rank = m.rank != null ? (zh ? ` · 排名 #${m.rank}` : ` · rank #${m.rank}`) : "";
    const ret = m.returnPct != null ? ` · ${m.returnPct >= 0 ? "+" : ""}${m.returnPct.toFixed(1)}%` : "";
    if (reversal) return zh
      ? `${at}反转观察候选记录 — 非交易计划${rank}${ret}`
      : `${at}Reversal-watch candidate receipt — not a trade plan${rank}${ret}`;
    return zh
      ? `${at}Prophet 候选记录 — 非交易计划${rank}${ret}`
      : `${at}Prophet candidate receipt — not a trade plan${rank}${ret}`;
  }

  // The new glance-tier bottom lane: actionable as a risk-defined starter, but explicitly
  // outside the confirmed/scored BUY track record.
  if (isBottomWatch(m)) {
    const stop = m.stopLevel != null ? (zh ? ` · 参考止损 ${m.stopLevel}` : ` · stop reference ${m.stopLevel}`) : "";
    return zh
      ? `${at}底部观察 — 风险限定试仓，尚非确认买入${stop}${reason}`
      : `${at}bottom watch — risk-defined starter, not a confirmed buy${stop}${reason}`;
  }

  // 1. a REFUSED entry (and its promoted washout-candidate flavour). Never a retro re-mark.
  if ((m.blocked || m.quality === "regime_blocked") && !m.retro) {
    const head = zh
      ? `${at}${m.type} 被趋势闸拦截 — 非入场信号`
      : `${at}${m.type} blocked by the regime gate — not an entry`;
    if (!m.overrideCandidate) return `${head}${reason}`;
    const w = washoutOverrideCopy(m.overrideCtx, zh, "candidate");
    return `${head}${reason} · ${w ? w.line : ""}`;
  }

  // 2. the trailing structure stop — the rail card's sentence, verbatim.
  if (isStructureStop({ type: m.type, basis: m.basis })) {
    const lvl = m.stopLevel != null ? (zh ? ` ${m.stopLevel}` : ` at ${m.stopLevel}`) : "";
    return zh
      ? `${at}结构止损 — 日线收盘跌破前低${lvl}，非动量离场`
      : `${at}structure stop — the daily close broke the prior swing low${lvl}, not a momentum exit`;
  }

  // 3. the scored re-entry lane.
  if (isStopSweepReclaim(m)) {
    const old = m.priorStopLevel != null
      ? (zh ? ` · 重新站上 ${m.priorStopLevel}` : ` · reclaimed ${m.priorStopLevel}`)
      : "";
    const stop = m.stopLevel != null ? (zh ? ` · 新止损参考 ${m.stopLevel}` : ` · new stop reference ${m.stopLevel}`) : "";
    return zh
      ? `${at}流动性收复 — 止损后快速收复结构，未计分再入场观察${old}${stop}`
      : `${at}liquidity reclaim — structure recovered quickly after the stop; unscored re-entry watch${old}${stop}`;
  }
  if (m.type === "RECLAIM") {
    const kind = m.quality === "block_repair"
      ? (zh ? "空头拦截已修复" : "bear-block repaired")
      : (zh ? "趋势重新收复" : "trend reclaim");
    return zh
      ? `${at}再入场（${kind}）— ${m.scored === false ? "未计分观察" : "计分再入场通道"}`
      : `${at}re-entry (${kind}) — ${m.scored === false ? "unscored watch" : "scored reclaim lane"}`;
  }

  // 4. a TAKEN washout entry, in either waived flavour. Line + lead + the stop-out clause, which
  //    is the same three-part shape the rail card prints, so hover and card agree.
  if (m.overrideTake) {
    const w = washoutOverrideCopy(m.overrideCtx, zh, m.reclaimWaived ? "reclaim" : "entry");
    if (w) return `${at}${m.type} — ${w.line} · ${w.notes[0]} · ${w.notes[w.notes.length - 1]}`;
  }

  // 5. the RETRO projection — the counterfactual, dated.
  if (m.retro) {
    const r = retroOverrideCopy(m.retroCtx, zh, RETRO_RULE_DATE);
    return `${at}${m.type} — ${r.line} · ${r.notes[0]}`;
  }

  // 6. any other engine-refused mark: name the veto, since the dim pill alone cannot say why.
  //    The qualifier is bracketed in en and dashed in zh — bracketing BOTH the qualifier and the
  //    reason slug leaves 中文 reading `BUY（待定）（bear_block: …）`, two bracket groups running
  //    together, which is the english-shaped-zh trap rather than a translation.
  if (m.quality != null && SOFT_Q.has(m.quality)) {
    const q = m.quality === "pending"
      ? (zh ? "试仓 — 等待确认" : "starter — awaiting confirmation")
      : m.quality === "block"
        ? (zh ? "试仓 — 确认条件未通过" : "starter — confirmation filter failed")
        : (zh ? "拦截" : "blocked");
    return zh
      ? `${at}${m.type} — ${q}${m.reason ? `（${m.reason}）` : ""}`
      : `${at}${m.type} (${q})${reason}`;
  }

  return null;   // a plain scored entry — the pill says it; a tooltip would only repeat it
}

/** THE RETRO LEGEND — the disclosure of record for the retro projection.
 *
 *  Load-bearing, and worth knowing why before editing it. On the chart, a re-marked fire is
 *  drawn IDENTICALLY to a live waived entry (operator order 2026-08-10): same star, same
 *  amber, no marker-level tag. The marker's `<title>` does not carry the difference either.
 *  For the whole of this class's history it COULD not — the signal layer is
 *  `pointer-events:none`, so no native SVG tooltip on it had ever rendered — and since the
 *  marker-tooltip repair made it visible on hover and tap it still does not, because a hover
 *  is invisible on touch until tapped, invisible in a screenshot, and invisible to anyone
 *  skimming. That leaves this line as the only place the product tells a reader that some of
 *  those stars are counterfactuals rather than calls it made.
 *
 *  So it is built to need nothing from the reader: no hover, no tap, no zoom. It renders
 *  whenever a re-marked fire is in the visible signal list, and it RESOLVES THE LABEL — it
 *  quotes the "(retro)" suffix the rows carry and says what it means, because a label a
 *  reader cannot resolve is not a disclosure. Plain words, no study names, no era slugs. */
export function retroLegendCopy(zh: boolean): string {
  return zh
    ? "（事后重标）— 按当前规则重新标注；这笔入场当时被系统拒绝，因此不是我们当时的判断。"
    : "(retro) — re-marked under the current rule; the system refused this entry when it "
      + "fired, so it is not a call we made.";
}

/** HK-O1: every SELL the SLICE emits is the ARM→CONFIRM structure break — a TRAILING STOP on
 *  a swing-low break, not a momentum/oracle exit (the MACD-RSI cross-down has not been emitted
 *  to this stream since the GC v2 unification). Surfaces must say so.
 *
 *  STRICT on `basis` by design. Slices emitted before 2026-08-08 carry no basis, and a bare
 *  slice SELL is the same machine — but the CLIENT-PINE FALLBACK (ChartPanel.oracleSignals,
 *  used when a name ships no signal history) emits a genuinely momentum-sourced SELL with no
 *  basis either. So the legacy default is applied at the slice boundary, where provenance is
 *  known (sliceSignalBasis), never by guessing from a bare marker here. */
export function isStructureStop(
  s?: { type?: unknown; basis?: unknown } | null,
): boolean {
  if (!s) return false;
  return String(s.type ?? "").toUpperCase() === "SELL"
    && String(s.basis ?? "").toLowerCase() === "structure_stop";
}

/** Normalize a signal read off `slice.indicator.signals` — and ONLY off there. Every SELL in
 *  that stream comes from v2 sell_confirms, so a pre-2026-08-08 slice's bare SELL gets the
 *  basis it always had in fact. Returns undefined for every other event kind (basis is
 *  SELL-only; a default on entries would be a claim nobody made). */
export function sliceSignalBasis(
  s?: { type?: unknown; basis?: unknown } | null,
): string | undefined {
  const b = s?.basis;
  if (typeof b === "string" && b) return b.toLowerCase();
  return String(s?.type ?? "").toUpperCase() === "SELL" ? "structure_stop" : undefined;
}

/** THE scored-lane anchor rule — the newest signal the engine did NOT refuse
 *  (quality !== 'regime_blocked'; contracts.py: a vetoed entry must never anchor a verdict).
 *  Shared by the rail card (oracleVerdict), the chart chip (ChartPanel.paintStatus) and the
 *  copilot get_signals staleness read, so the three surfaces can't drift.
 *  `maxTs` (ISO date) bounds the scan — the replay / stale-cache guard: signals dated after
 *  the last visible bar never anchor. Also returns the newest refused signal NEWER than the
 *  anchor (`blockedTail`) — the rail card's "blocked — not an entry" note. */
export function anchorSignal<S extends { ts?: unknown; type?: unknown; quality?: unknown; blocked?: unknown }>(
  signals: readonly (S | null | undefined)[] | null | undefined,
  maxTs?: string | null,
): { anchor: S | null; blockedTail: S | null } {
  let blockedTail: S | null = null;
  if (Array.isArray(signals)) {
    for (let i = signals.length - 1; i >= 0; i--) {
      const s = signals[i];
      if (!s || !s.type || typeof s.ts !== "string" || !s.ts) continue;
      if (maxTs != null && s.ts > maxTs) continue;
      // gate on the explicit HK-O1 flag OR the legacy quality string — either alone is enough
      // to refuse the anchor, so neither can be the single point that re-opens the hole.
      if (isBlockedSignal(s)) {
        if (!blockedTail) blockedTail = s;
        continue;
      }
      return { anchor: s, blockedTail };
    }
  }
  return { anchor: null, blockedTail };
}

/** A refused entry trigger recent enough to still be a caution: BUY-side, dated, within the
 *  staleness window. Shared by the fresh-anchor branch (where it rides along with the anchor)
 *  and the caution branch (where it IS the read), so one rule decides "is this block still live". */
function freshBlockedEntry<S extends { type?: unknown; ts?: unknown; known_ts?: unknown; quality_reason?: unknown }>(
  blockedTail: S | null,
  now: number,
): S | null {
  if (!blockedTail) return null;
  const u = String(blockedTail.type ?? "").toUpperCase();
  if (!BUYISH.includes(u) && u !== "RECLAIM") return null;
  const age = ageDays(signalKnownTs(blockedTail), now);
  return age != null && age <= ORACLE_STALE_DAYS ? blockedTail : null;
}

function eventColor(u: string): string {
  if (u === "BOTTOM_WATCH") return "var(--signal)";
  return BUYISH.includes(u) || u === "RECLAIM"
    ? "var(--buy)"
    : SELLISH.includes(u)
      ? "var(--sell)"
      : "var(--signal)";
}

/** HK-O1 — the structure stop's own name, everywhere a SELL is spelled out.
 *  Glance tier stays inside the word budget; the swing-low mechanic lives in the note. */
export const STRUCTURE_STOP_LABEL: [string, string] = ["Structure stop", "结构止损"];

function eventLabel(u: string, zh: boolean, basis?: string | null, quality?: string | null): string {
  if (isStructureStop({ type: u, basis })) return zh ? STRUCTURE_STOP_LABEL[1] : STRUCTURE_STOP_LABEL[0];
  if (u === "BOTTOM_WATCH") return zh ? "底部观察" : "Bottom watch";
  if (u === "RECLAIM") return isStopSweepReclaim({ type: u, quality })
    ? (zh ? "流动性收复" : "Liquidity reclaim")
    : (zh ? "重新入场" : "Re-entry");
  if (zh) {
    const labels: Record<string, string> = {
      BUY: "买入",
      REBUY: "再次买入",
      ADD: "加仓",
      SELL: "卖出",
      CUT: "止损",
      TRIM: "减仓",
    };
    if (labels[u]) return labels[u];
  }
  return u.charAt(0) + u.slice(1).toLowerCase();
}

// ── the stance ladder — the Pine compTxt analog, from ALREADY-SHIPPED state fields ─────────
// Fires only when the effective event is stale/undated. Priority-ordered, first match wins.
// Direction words ride --up/--down (they flip correctly under zh east mode); caution rungs
// ride the non-flipping --warn/--signal per the severity-color law. No Buy/Sell verb ever.
export function computeStance(st: OracleState, trend: StanceTrend, zh: boolean): { label: string; color: string } | null {
  const pos = st.position_hint === "long" ? "long" : "flat";
  const sb = Boolean(st.strong_bull ?? st.extended);
  const ob = Boolean(st.overbought);
  const wb = Boolean(st.weeklyBull);
  const a2 = Boolean(st.above200);
  if (pos !== "long" && ob && (a2 || wb))
    return { label: zh ? "过热 — 勿追高" : "Extended — don't chase", color: "var(--warn)" };
  if (pos === "long" && ob)
    return { label: zh ? "持有 — 过热勿加仓" : "Hold — extended, don't add", color: "var(--warn)" };
  if (pos === "long" && sb)
    return { label: zh ? "持有 — 偏多" : "Hold — long bias", color: "var(--up)" };
  if (pos === "long")
    return { label: zh ? "持有 — 趋势转弱" : "Hold — trend weakening", color: "var(--signal)" };
  if (sb && (trend === "UPTREND" || trend === "PULLBACK"))
    return { label: zh ? "强势上行 — 等回调买点" : "Strong uptrend — awaiting pullback entry", color: "var(--up)" };
  if ((a2 && wb) || trend === "UPTREND")
    return { label: zh ? "上升趋势 — 无入场信号" : "Uptrend — no entry signal", color: "var(--up)" };
  if (trend === "RANGE")
    return { label: zh ? "区间震荡 — 无优势" : "Range — no edge", color: "var(--text-2)" };
  if (trend === "DOWNTREND" || (!a2 && !wb))
    return { label: zh ? "下行趋势 — 观望" : "Downtrend — stand aside", color: "var(--down)" };
  return { label: zh ? "空仓 — 等待再入场" : "Flat — awaiting re-entry", color: "var(--text-2)" };
}

// Golden Oracle verdict for the rail card. Sources, in trust order:
//   1. slice.indicator.signals — the newest marker the engine did NOT refuse
//      (quality !== 'regime_blocked'): the dated verdict anchor. A fresh anchor renders as
//      the event (RECLAIM = soft/unscored authority); when the anchor is stale/undated, a
//      FRESH refused entry trigger (regime_blocked tail) renders first-class as an amber
//      "Entry trigger — regime-blocked" caution, else the primary becomes the STANCE from
//      state (computeStance).
//   2. manifest row.verdict (scored lane) — undated fallback when there is no slice: dimmed.
// Either way this is a swing-timing overlay read (3D bars), never an investment view — the
// horizon rides along in `note` so the button tooltip says so.
/** Consumer projection only: never edits signal history, scoring or engine clocks. */
export function oracleVerdict(
  v?: string | null,
  slice?: OracleSlice | null,
  zh = false,
  now: number = Date.now(),
  trend: StanceTrend = null,
): Verdict {
  const read = oracleVerdictRead(v, slice, zh, now, trend);
  const { anchor } = anchorSignal(slice?.indicator?.signals);
  let historicalSignal: OracleHistoricalSignal | null = null;
  if (anchor) {
    const type = String(anchor.type).toUpperCase();
    const knownTs = typeof anchor.known_ts === "string" && Number.isFinite(Date.parse(anchor.known_ts))
      ? anchor.known_ts : null;
    const quality = String(anchor.quality ?? "").toLowerCase();
    const starter = BUYISH.includes(type) && (quality === "block" || quality === "pending");
    const confirmed = BUYISH.includes(type) && knownTs != null && Date.parse(knownTs) <= now
      && !SOFT_Q.has(quality) && anchor.scored !== false && !isRetroOverride(anchor);
    const event = starter ? (zh ? "试仓" : "Starter")
      : eventLabel(type, zh, sliceSignalBasis(anchor), anchor.quality);
    historicalSignal = {
      type,
      chartTs: anchor.ts,
      knownTs,
      label: confirmed ? (zh ? `已确认${event}` : `Confirmed ${event}`) : event,
      date: knownTs ? new Date(knownTs).toLocaleDateString(zh ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : (zh ? "信号可知日期未核实" : "Signal date unverified"),
      confirmed,
    };
  }
  return { ...read, historicalSignal, entryAvailability: oracleEntryAvailability(zh) };
}

/** Both Oracle consumers use the same visible history/stance wording and source clock. */
export function oraclePresentation(verdict: Pick<Verdict, "label" | "sub" | "stance" | "blocked" | "historicalSignal"> & Partial<Pick<Verdict, "raw">>, zh = false): { heading: string; label: string; sub: string | null } {
  const history = verdict.historicalSignal;
  const showsHistory = history != null && !verdict.stance && verdict.raw === history.type;
  return {
    heading: verdict.stance ? (zh ? "当前姿态" : "Current regime")
      : (zh ? "历史信号" : "Historical signal"),
    label: showsHistory ? history.label : verdict.label,
    sub: showsHistory && !verdict.blocked ? history.date : verdict.sub ?? null,
  };
}

function oracleVerdictRead(
  v?: string | null,
  slice?: OracleSlice | null,
  zh = false,
  now: number = Date.now(),
  trend: StanceTrend = null,
): Verdict {
  const st = slice?.indicator?.state ?? null;
  const sigsRaw = slice?.indicator?.signals;
  const sigs: OracleSignal[] = Array.isArray(sigsRaw) ? sigsRaw : [];

  // effective event = newest marker the engine did not refuse (regime_blocked markers are
  // display artifacts of vetoed entries — contracts.py: "never treat as an entry").
  const { anchor: eff, blockedTail } = anchorSignal(sigs);

  const mv = v ? String(v).toUpperCase() : null;
  const scored = st?.last_scored_signal ? String(st.last_scored_signal).toUpperCase() : null;
  if (!eff && !scored && !mv)
    return { label: "—", color: "var(--muted)", raw: null, sub: null, dim: false, note: null };

  const horizon = zh ? "3日K线摆动择时信号 — 非投资观点" : "swing-timing overlay on 3D bars — not an investment view";
  const effKnownTs = signalKnownTs(eff);
  const age = ageDays(effKnownTs, now);
  const effU = eff ? String(eff.type).toUpperCase() : null;
  const stale = age == null || age > ORACLE_STALE_DAYS;
  // HK-O1: what machine produced the anchor. `eff` came off the slice stream, so the legacy
  // default is sound here; a stale/absent anchor falls back to the state block's own record.
  const effBasis = eff ? (sliceSignalBasis(eff) ?? null) : (st?.last_scored_basis ?? null);
  const stopped = isStructureStop({ type: effU, basis: effBasis });
  // the mechanic, in plain words — the glance label stays two words, this rides the tooltip
  const stopNote = (lvl?: number | null) => (zh
    ? `跟踪止损 — 日线收盘跌破前低${lvl != null ? ` ${lvl}` : ""}，非动量离场`
    : `trailing stop — the daily close broke the prior swing low${lvl != null ? ` at ${lvl}` : ""}, not a momentum exit`);

  // ── fresh effective event: it IS the verdict (today's full-authority path) ──
  if (eff && effU && !stale) {
    // RECLAIM keeps the hollow (soft) glyph regardless of scoring — the glyph law says a
    // re-entry never wears the solid backtested star. The NOTE tells the scoring truth:
    // scored (reclaim_lane promoted 2026-07-16) vs legacy display-tier scored:false.
    const soft = effU === "RECLAIM" || effU === "BOTTOM_WATCH";
    const notes: string[] = [horizon];
    if (eff.price != null) notes.push(`@ ${eff.price}`);
    // a stop-out must never be readable as an oracle-momentum call (forensic §1)
    if (stopped) notes.push(stopNote(eff.stop_level));
    const q = String(eff.quality || "").toLowerCase();
    // Keeper block/pending is position-backed but carries starter authority while
    // confirmation is incomplete. It is neither a full green entry nor a regime refusal.
    const keeperStarter = BUYISH.includes(effU) && (q === "block" || q === "pending");
    if (effU === "BOTTOM_WATCH") {
      notes.push(zh
        ? "风险限定试仓观察 — 不计入确认买入战绩"
        : "risk-defined starter watch — not in the confirmed-buy track record");
      if (eff.stop_level != null) notes.push(`${zh ? "止损参考" : "stop reference"} ${eff.stop_level}`);
    } else if (soft) {
      notes.push(eff.scored === false
        ? (zh ? "未计分再入场信号（不计入战绩）" : "unscored re-entry signal (not in the track record)")
        : (zh ? "再入场信号 — 计分回收通道" : "re-entry signal — scored reclaim lane"));
    }
    if (keeperStarter) {
      notes.push(q === "pending"
        ? (zh ? "试仓 — 等待确认" : "starter — awaiting confirmation")
        : (zh ? "试仓 — 确认条件未通过" : "starter — confirmation filter failed"));
      if (eff.quality_reason) notes.push(String(eff.quality_reason));
    } else if (SOFT_Q.has(q) && !soft) notes.push(String(eff.quality_reason || q));
    else if (soft && eff.quality_reason) notes.push(String(eff.quality_reason));
    // ── the washout-override ENTRY (era gc_v2_wo1) ──────────────────────────────────
    // It anchors like any entry, so the label and color below are the ordinary entry
    // language — that is the point: the mask took it, so the card says what it took. What
    // it must NOT do is arrive unexplained, because this is the one entry class that fired
    // against the regime gate. The disclosure rides the same line2 the refused class uses,
    // so the two states of one mechanism read as one mechanism.
    // Either waived class anchors identically; only the lead clause names which leg was
    // relieved, because that is the only thing about them that differs to a reader.
    const took = isWaivedEntry(eff)
      ? washoutOverrideCopy((eff as { override_ctx?: OverrideCtx | null }).override_ctx, zh,
                            isReclaimOverrideTake(eff) ? "reclaim" : "entry")
      : null;
    if (took) notes.push(...took.notes);
    // lane-disagreement note only between the two SCORED lanes (a RECLAIM primary is
    // EXPECTED to differ from the scored manifest verdict — not a data fault).
    if (!soft && mv && mv !== effU) notes.push(zh ? `数据通道不一致（清单通道：${mv}）` : `data lanes disagree (screener lane: ${mv})`);
    // ── the refused entry NEWER than this anchor still has to be disclosed ──
    // `blockedTail` is by construction newer than the anchor, so when the anchor is fresh it is
    // fresh too — yet this branch used to return before the caution branch below could speak,
    // and a refused entry trigger from days ago vanished behind a "Sell" from a week earlier.
    // Two names in identical engine states (flat, entries regime-gated) then rendered as
    // completely different cards purely on the age of the older sell. The anchor stays the
    // primary read — it is the scored truth — but the block rides with it, dated.
    const freshBlock = freshBlockedEntry(blockedTail, now);
    if (freshBlock) {
      notes.push(
        `${fmtDate(signalKnownTs(freshBlock)!, zh)} ${eventLabel(String(freshBlock.type).toUpperCase(), zh)} ` +
        (zh ? "被趋势闸拦截 — 非入场信号" : "blocked by the regime gate — not an entry") +
        (freshBlock.quality_reason ? ` (${freshBlock.quality_reason})` : ""),
      );
    }
    return {
      label: keeperStarter ? (zh ? "试仓" : "Starter") : eventLabel(effU, zh, effBasis, eff.quality),
      color: keeperStarter ? "var(--signal)" : eventColor(effU),
      raw: effU,
      sub: fmtDate(effKnownTs!, zh) + (freshBlock
        ? ` · ${zh ? "入场被拦截" : "entry blocked"} ${fmtDate(signalKnownTs(freshBlock)!, zh)}`
        : ""),
      dim: false,
      soft,
      blocked: !!freshBlock,
      overrideTake: !!took,
      line2: took?.line ?? null,
      note: notes.join(" · "),
    };
  }

  const hasRegime = st != null && (st.position_hint !== undefined || st.strong_bull !== undefined
    || st.extended !== undefined || st.weeklyBull !== undefined || st.above200 !== undefined);

  // ── stale/absent anchor but a FRESH refused entry trigger: first-class caution ──
  // 2026-08-02 (600547.SS washout diagnosis): the engine's entry trigger fired at the
  // low and was regime-vetoed; rendering only the stale-SELL stance buried the one dated
  // fact the panel exists to surface. A fresh refused trigger is now the primary read —
  // amber caution rung (non-flipping --signal), hollow glyph, explicit "not an entry"
  // language — and the stance demotes to tooltip context. Never green, never a Buy verb
  // (stance law); the engine's refusal stays the scored-lane truth (raw=BLOCKED_ENTRY,
  // never the event type, so no consumer can mistake it for an anchorable signal).
  const liveBlock = freshBlockedEntry(blockedTail, now);
  const btKnownTs = signalKnownTs(liveBlock);
  if (liveBlock) {
    const notes: string[] = [
      zh ? "入场触发被趋势闸拦截 — 非入场信号" : "entry trigger blocked by the regime gate — not an entry",
      horizon,
    ];
    if (liveBlock.price != null) notes.push(`@ ${liveBlock.price}`);
    if (liveBlock.quality_reason) notes.push(String(liveBlock.quality_reason));
    // ── the washout-override class rides ONLY where the refusal IS the primary read ──
    // Deliberately not added to the fresh-anchor branch above: there the newest read is the
    // anchor, and a second amber line under someone else's verdict is a different card.
    const wash = isOverrideCandidate(liveBlock)
      ? washoutOverrideCopy((liveBlock as { override_ctx?: OverrideCtx | null }).override_ctx, zh)
      : null;
    if (wash) notes.push(...wash.notes);
    const btStance = st && hasRegime ? computeStance(st, trend, zh) : null;
    if (btStance) notes.push(`${zh ? "当前姿态" : "current stance"}: ${btStance.label}`);
    const btEcho = effU ?? scored ?? mv;
    if (btEcho) {
      notes.push(
        `${zh ? "上次信号" : "last signal"}: ${eventLabel(btEcho, zh, effBasis)}` +
        (effKnownTs ? ` · ${fmtDate(effKnownTs, zh)}` : "") +
        (eff?.price != null ? ` @ ${eff.price}` : ""),
      );
    }
    return {
      label: zh ? "买点触发 — 趋势闸拦截" : "Entry trigger — regime-blocked",
      color: "var(--signal)",
      raw: "BLOCKED_ENTRY",
      sub: fmtDate(btKnownTs!, zh),
      dim: false,
      soft: true,
      blocked: true,
      overrideCandidate: !!wash,
      line2: wash?.line ?? null,
      note: notes.join(" · "),
    };
  }

  // ── stale or undated: the stance is the primary; the event demotes to a dated echo ──
  // Only when the state actually carries regime fields — a bare {last_signal} (legacy
  // shape) has nothing honest to stand on and keeps the dated/dimmed event render.
  if (st && hasRegime) {
    const stance = computeStance(st, trend, zh);
    if (stance) {
      const notes: string[] = [zh ? "姿态来自当前状态 — 非交易信号" : "stance from current regime state — not a trade signal", horizon];
      if (blockedTail) {
        notes.push(
          `${fmtDate(signalKnownTs(blockedTail)!, zh)} ${eventLabel(String(blockedTail.type).toUpperCase(), zh)} ` +
          (zh ? "已拦截 — 非入场信号" : "blocked — not an entry"),
        );
      }
      const echoU = effU ?? scored ?? mv;
      // The stance IS the read — the old event demotes all the way to tooltip context.
      // (A rendered "● Sell · 45d ago" echo under an Uptrend stance read as a mixed message;
      // the dated history is one tap away in Signal history.)
      if (echoU) {
        notes.push(
          `${zh ? "上次信号" : "last signal"}: ${eventLabel(echoU, zh, effBasis)}` +
          (effKnownTs ? ` · ${fmtDate(effKnownTs, zh)}` : "") +
          (eff?.price != null ? ` @ ${eff.price}` : ""),
        );
      }
      return {
        label: stance.label,
        color: stance.color,
        raw: echoU ?? null,
        sub: null,
        dim: false,          // a stance is a CURRENT read — authority comes from the stance style
        stance: true,
        note: notes.join(" · "),
      };
    }
  }

  // ── no state to stand on: today's dated/dimmed (or undated) event render ──
  const u = effU ?? scored ?? mv!;
  const notes: string[] = [horizon];
  if (eff?.price != null) notes.push(`@ ${eff.price}`);
  if (mv && mv !== u) notes.push(zh ? `数据通道不一致（清单通道：${mv}）` : `data lanes disagree (screener lane: ${mv})`);
  return {
    label: eventLabel(u, zh, effBasis),
    color: eventColor(u),
    raw: u,
    sub: effKnownTs ? fmtDate(effKnownTs, zh) : zh ? "无日期" : "undated",
    dim: true,
    note: notes.join(" · "),
  };
}

// Research Desk lean = intel.tape.ai_lean — the LIVE `cards`/`tape` schema.
// (The old intel.analysis.decision schema is deprecated and no longer populated.)
// ai_lean.dir is a deterministic band×entry mapping built upstream (pull_macro_intel.py), so the
// honest rendering re-derives intent from the fields shipped beside it:
//   - a BEAR whose only cause is band="low" (weak buy-readiness, e.g. entry="bounce_wait" =
//     "don't chase an unconfirmed bounce") is an entry-timing read, NOT a short call → "No setup";
//   - dir=BEAR keeps its red "Bearish" only for genuinely bearish entry states (exit/topping)
//     or legacy files that don't ship band/entry;
//   - dir=NEUTRAL with a known entry posture renders the POSTURE (await_confluence /
//     wait_pullback / bounce_wait) instead of a blank "Neutral" — the desk is an entry-timing
//     engine and its score is dip-entry READINESS (name_score.potential_score), labeled as such.
const EXIT_ENTRIES = new Set(["exit", "topping"]);

const ENTRY_POSTURE: Record<string, [string, string]> = {
  // entry status -> [en, zh] — descriptive posture, never a Buy/Sell verb
  await_confluence: ["Awaiting confluence", "等待共振触发"],
  wait_pullback: ["Wait for pullback", "等待回调"],
  bounce_wait: ["Bounce unconfirmed — wait", "反弹未确认 — 观望"],
};

export function deskVerdict(intel: any, zh = false, now: number = Date.now()): Verdict {
  const lean = intel?.tape?.ai_lean;
  const dir = String(lean?.dir || "").toUpperCase();
  const band = String(lean?.band || "").toLowerCase();
  const entry = String(lean?.entry || "").toLowerCase();
  const asof = (intel?.tape?.asof ?? null) as string | null;
  const age = ageDays(asof, now);
  const sub = asof
    ? `${zh ? "数据截至" : "as of"} ${fmtDate(asof, zh)}${age != null ? ` · ${age}${zh ? "天" : "d"}` : ""}`
    : null;
  const score = typeof lean?.score === "number" ? lean.score : null;
  // symmetric staleness guard: a desk read older than the display threshold loses authority too
  const dim = age != null && age > ORACLE_STALE_DAYS;
  const notes: string[] = [];
  // honest label: the desk score is name_score.potential_score = dip-entry READINESS
  // (it structurally rewards washed-out names), NOT directional conviction.
  if (score != null) notes.push(zh ? `回调买点就绪度 ${score}/100` : `dip-entry readiness ${score}/100`);

  if (dir === "BEAR" && band === "low" && !EXIT_ENTRIES.has(entry)) {
    notes.unshift(zh ? "低买点评分（band=low）— 非做空观点" : "weak buy-readiness read (band=low) — not a short call");
    return { label: zh ? "无买点" : "No setup", color: "var(--muted)", raw: "NO_SETUP", sub, dim, note: notes.join(" · ") };
  }

  const aj = intel?.cards?.ai_judgment;
  if (dir === "BEAR" && aj?.verdict && /constructive|bullish|accumulate|leader/i.test(String(aj.verdict)))
    notes.push(zh ? "来源分歧：AI判断偏建设性" : `sources disagree: AI judgment reads "${aj.verdict}"`);

  // NEUTRAL with a known entry posture: render the posture, not a blank "Neutral" —
  // "Neutral" on a market leader reads as an opinion; "Awaiting confluence" is the truth.
  if ((dir === "NEUTRAL" || !dir) && Object.prototype.hasOwnProperty.call(ENTRY_POSTURE, entry)) {
    const [en, zhLbl] = ENTRY_POSTURE[entry];
    notes.push(zh ? "入场时机读数 — 非方向观点" : "entry-timing read — not a directional view");
    return { label: zh ? zhLbl : en, color: "var(--signal)", raw: dir || "NEUTRAL", sub, dim, note: notes.join(" · ") };
  }

  const color = dir === "BULL" ? "var(--buy)" : dir === "BEAR" ? "var(--sell)" : "var(--signal)";
  const label =
    dir === "BULL" ? (zh ? "看多" : "Bullish")
      : dir === "BEAR" ? (zh ? "看空" : "Bearish")
        : (zh ? "中性" : "Neutral");
  return { label, color, raw: dir || null, sub, dim, note: notes.length ? notes.join(" · ") : null };
}
