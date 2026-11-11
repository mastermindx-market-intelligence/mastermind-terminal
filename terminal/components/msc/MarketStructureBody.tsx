"use client";
/**
 * MarketStructureBody — the Positioning tab's card set (Market Structure Core R0–R1.4).
 *
 * 2026-08-01 PRODUCTION SWEEP. The first pass laid 13 cards into one auto-fit grid with a
 * paragraph of copy per card; the operator reviewed it on production and called it what it
 * was. This rewrite is editorial:
 *
 *   • A 12-column grid with EXPLICIT spans (msc.module.css) — cards are curated into rows
 *     of similar height instead of auto-packed, so the giant stretch-voids are gone.
 *   • Three narrative sections: TODAY'S STRUCTURE (what the book forces at this spot),
 *     AGAINST ITS OWN HISTORY (is today unusual), ACROSS THE MARKET (who is at an extreme).
 *   • Copy discipline (MscCard): explanation lives in the ⓘ Tip; one visible foot line max.
 *   • The strike × expiry heatmap (MatrixHeatCard) — the payload was already fetched and
 *     never drawn as the grid every category leader ships.
 *   • Topology + expected-move cards merged into one KEY LEVELS rail: a trader reads
 *     "which level, how far, in EM units" as one question, not two cards.
 *
 * HONESTY (masterplan §4.1) is unchanged and non-negotiable: every card declares its tier;
 * Tier B carries the convention and the sensitivity verdict; no support/resistance claim
 * ships without a grade (R2.4).
 *
 * COLOUR LAW: hedge flow is a TRANSACTION SIDE → --flow-buy/--flow-sell (never flip under
 * html[data-updown="east"]). Severity uses --warn. Charts follow svgChart.ts R1–R9.
 */

import React, { useMemo, useRef } from "react";
import { Tip } from "@/components/ui/Tip";
import { fmtMn, fmtMnMag } from "@/lib/gexLadder";
import { buildMarketStructure, type MscMoves } from "@/lib/marketStructure";
import type { MarketStructure } from "@/lib/marketStructure";
import { makeMscT, type MscKey } from "./mscStrings";
import { MscCard, SectionRule, CardFoot, CardSpacer } from "./MscCard";
import { HedgingByStrikeCard, TermStructureCard, DailyHedgingCard } from "./HedgingCards";
import { AggTrendCard, SpotVolCard, ExtremesCard } from "./TrendCards";
import { FloatingStrikeCard, QuadScreenerCard } from "./QuadCards";
import { MatrixHeatCard } from "./MatrixHeatCard";
import { GradesCard, type GradesPayload } from "./GradesCard";
import { ProfileCard } from "./ProfileCard";
import { useChartWidth } from "@/components/charts/svgChart";
import s from "./msc.module.css";
import type { AggTrendPayload } from "@/lib/aggTrend";
import type { QuadPayload } from "@/lib/quadBoard";
import type { GexMatrix } from "@/lib/gexLadder";
import type { Lang } from "@/lib/i18n";
import type { GexPayload } from "@/components/gexdesk/GexDeskView";

interface Props {
  gex: GexPayload | null;
  /** `moves:{ROOT}` — expected-move band + containment calibration. Optional. */
  moves: MscMoves | null;
  /** `agg:{ROOT}` — whole-book series back to 2017/2012. Optional, independently cadenced. */
  agg?: AggTrendPayload | null;
  /** `matrix:{ROOT}` — the only store with strike AND expiry together. Optional. */
  matrix?: GexMatrix | null;
  /** `quad` — one cross-root board shared by every root. Optional. */
  quad?: QuadPayload | null;
  /** R2.4 report cards — the root's own and the universe aggregate. Optional. */
  grades?: GradesPayload | null;
  gradesUniverse?: GradesPayload | null;
  root?: string;
  /** Dated-replay mode (R2): the EM band never travels with an archived ladder. */
  archived?: boolean;
  lang: Lang;
}

const pct = (v: number | null | undefined, dp = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(dp)}%`;
const num = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(dp);
const price = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function MarketStructureBody({
  gex,
  moves,
  agg = null,
  matrix = null,
  quad = null,
  grades = null,
  gradesUniverse = null,
  root = "",
  archived = false,
  lang,
}: Props) {
  const t = makeMscT(lang);

  const ms: MarketStructure | null = useMemo(() => {
    if (!gex?.by_strike?.length) return null;
    const withFull = gex as GexPayload & { by_strike_full_n?: number | null };
    return buildMarketStructure({
      byStrike: gex.by_strike,
      byExpiry: gex.by_expiry ?? null,
      byStrikeFullN: withFull.by_strike_full_n ?? null,
      spot: gex.spot_ref,
      levels: [
        { key: "call_wall", price: gex.call_wall },
        { key: "put_wall", price: gex.put_wall },
        { key: "flip", price: gex.gamma_flip },
        { key: "max_pain", price: gex.max_pain ?? null },
        { key: "magnet", price: gex.magnet ?? null },
      ],
      moves,
    });
  }, [gex, moves]);

  // The absolute-gamma strike is derived, not published — joined into the EM frame here.
  const emLevels = useMemo(() => {
    if (!ms) return [];
    const absK = ms.topology.absGammaStrike;
    if (absK == null || !Number.isFinite(gex?.spot_ref ?? NaN)) return ms.em.levels;
    if (ms.em.levels.some((l) => l.price === absK)) return ms.em.levels;
    const spot = gex!.spot_ref as number;
    const distEm =
      ms.em.emAbs1sig && ms.em.emAbs1sig > 0 ? Math.abs(absK - spot) / ms.em.emAbs1sig : null;
    return [
      ...ms.em.levels,
      {
        key: "abs_gamma",
        price: absK,
        distEm,
        distPct: ((absK - spot) / spot) * 100,
        side: (absK > spot ? "above" : absK < spot ? "below" : "at") as "above" | "below" | "at",
        reachable: distEm == null ? null : distEm <= 1.5,
      },
    ].sort((a, b) => (a.distEm ?? Infinity) - (b.distEm ?? Infinity));
  }, [ms, gex]);

  if (!ms) return <div style={EMPTY}>{t("noData")}</div>;

  const hasHistory = Boolean(agg?.series?.length);
  const hasQuad = Boolean(quad?.rows?.length);

  return (
    <div id="msc-panel-body" className={s.grid}>
      <SectionRule label={t("secToday")} />

      {/* The flagship: exposure as a FUNCTION of spot (§4.2 profile). Renders its
          honest empty until the first post-profile nightly publishes the block. */}
      <ProfileCard gex={gex} lang={lang} />
      <KeyLevelsCard ms={ms} t={t} levels={emLevels} spot={gex?.spot_ref ?? null} archived={archived} />

      <HedgingByStrikeCard
        byStrike={gex?.by_strike ?? null}
        spot={gex?.spot_ref ?? null}
        callWall={gex?.call_wall ?? null}
        putWall={gex?.put_wall ?? null}
        windowNote={
          ms.agg.windowed
            ? t("windowed")
                .replace("{n}", String(ms.agg.nStrikes))
                .replace("{full}", String(ms.agg.nStrikesFull))
            : null
        }
        lang={lang}
      />
      <ExpiryCard ms={ms} t={t} />

      <TermStructureCard byExpiry={gex?.by_expiry ?? null} asof={gex?.asof ?? null} lang={lang} />
      <DailyHedgingCard agg={ms.agg} emPct1sig={ms.em.emPct1sig} lang={lang} />
      <SignCard ms={ms} t={t} convention={gex?.convention ?? null} />

      <ScenarioCard ms={ms} t={t} convention={gex?.convention ?? null} />
      <RankedStrikesCard ms={ms} t={t} spot={gex?.spot_ref ?? null} />

      <MatrixHeatCard
        matrix={matrix}
        spot={gex?.spot_ref ?? null}
        callWall={gex?.call_wall ?? null}
        putWall={gex?.put_wall ?? null}
        lang={lang}
      />

      <SectionRule label={t("secHistory")} />
      {hasHistory && <AggTrendCard agg={agg} lang={lang} />}
      {hasHistory && <SpotVolCard agg={agg} lang={lang} />}
      <FloatingStrikeCard byDelta={gex?.by_delta ?? null} lang={lang} />
      <ExtremesCard
        matrix={matrix}
        spot={gex?.spot_ref ?? null}
        asof={gex?.asof ?? null}
        lang={lang}
      />
      {/* R2.4 — the graded record closes the history section: after "how does today
          compare", the reader asks "and do these levels actually hold?" */}
      <GradesCard
        rootGrades={grades}
        universeGrades={gradesUniverse}
        root={root}
        lang={lang}
      />

      {hasQuad && (
        <>
          <SectionRule label={t("secMarket")} />
          <QuadScreenerCard quad={quad} root={root} lang={lang} />
        </>
      )}
    </div>
  );
}

type T = (k: MscKey) => string;

function Stat({ label, value, tone, tip }: { label: string; value: string; tone?: string; tip?: string }) {
  return (
    <div style={STAT}>
      <span style={STAT_LBL}>
        {tip ? (
          <Tip label={tip} side="top" size="card">
            <span tabIndex={0} style={HINT}>{label}</span>
          </Tip>
        ) : (
          label
        )}
      </span>
      <span style={{ ...STAT_VAL, ...(tone ? { color: tone } : null) }}>{value}</span>
    </div>
  );
}

// ─── Key levels — the EM frame + gamma topology, one rail (Tier B, mixed) ────────────

const LEVEL_LABEL: Record<string, MscKey> = {
  call_wall: "lvlCallWall",
  put_wall: "lvlPutWall",
  flip: "lvlFlip",
  abs_gamma: "lvlAbsGamma",
  max_pain: "lvlMaxPain",
  magnet: "lvlMagnet",
};

function KeyLevelsCard({
  ms,
  t,
  levels,
  spot,
  archived,
}: {
  ms: MarketStructure;
  t: T;
  levels: MarketStructure["em"]["levels"];
  spot: number | null;
  archived: boolean;
}) {
  const em = ms.em;
  const tp = ms.topology;
  return (
    <MscCard
      title={t("klTitle")}
      info={`${t("emLead")} ${t("topoAbsWhy")}`}
      tier={t("tierB")}
      tierWhy={t("emTierWhy")}
      span={4}
    >
      <div style={ROW}>
        <Stat label={t("klSpot")} value={price(spot)} />
        <Stat
          label={t("emOneSigma")}
          value={em.emPct1sig == null ? "—" : pct(em.emPct1sig, 2)}
        />
        <Stat
          label={t("topoShare")}
          value={tp.concentrationShare == null ? "—" : pct(tp.concentrationShare * 100)}
          tip={t("topoAbsWhy")}
        />
      </div>

      {!levels.length ? (
        <CardFoot>{t("emNone")}</CardFoot>
      ) : (
        <table style={TABLE}>
          <thead>
            <tr>
              <th style={TH}>{t("emColLevel")}</th>
              <th style={{ ...TH, textAlign: "right" }}>{t("emColPrice")}</th>
              <th style={{ ...TH, textAlign: "right" }}>{t("emColDist")}</th>
              <th style={{ ...TH, textAlign: "right" }}>{t("emColEm")}</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => {
              const key = LEVEL_LABEL[l.key];
              return (
                <tr key={l.key}>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>{key ? t(key) : l.key}</td>
                  <td style={{ ...TD, textAlign: "right" }}>{price(l.price)}</td>
                  <td style={{ ...TD, textAlign: "right", color: "var(--text-2)" }}>
                    {pct(l.distPct)}
                  </td>
                  <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                    {l.distEm == null ? (
                      "—"
                    ) : (
                      <>
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{num(l.distEm, 2)}</span>
                        <span
                          style={{
                            ...EM_CHIP,
                            color: l.reachable ? "var(--text-2)" : "var(--text-dim)",
                          }}
                        >
                          {l.reachable ? t("emReachable") : t("emFar")}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <CardSpacer />
      <CardFoot>
        {em.emPct1sig == null
          ? t(archived ? "emArchived" : "emNoBand")
          : [
              em.horizonDays != null ? t("emHorizon").replace("{d}", String(em.horizonDays)) : null,
              em.containedRate != null && em.nSessions != null
                ? t("emCalib")
                    .replace("{pct}", `${(em.containedRate * 100).toFixed(1)}%`)
                    .replace("{n}", em.nSessions.toLocaleString())
                : null,
              em.ci
                ? t("emCalibCi")
                    .replace("{lo}", `${(em.ci[0] * 100).toFixed(1)}%`)
                    .replace("{hi}", `${(em.ci[1] * 100).toFixed(1)}%`)
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
      </CardFoot>
    </MscCard>
  );
}

// ─── Sign robustness (Tier B — the differentiator) ───────────────────────────────────

function SignCard({ ms, t, convention }: { ms: MarketStructure; t: T; convention: string | null }) {
  const s2 = ms.sign;
  const fragile = s2.verdict === "fragile";
  const verdictKey: MscKey =
    s2.verdict === "robust" ? "signRobust" : s2.verdict === "fragile" ? "signFragile" : "signUnknown";

  const wStar = s2.criticalWeight;
  const inRange = wStar != null && wStar >= -1 && wStar <= 1;

  // Mini curve: net gamma as a function of the call-side weight, drawn instead of the
  // old nine-number list. The zero crossing IS the critical weight.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const W = useChartWidth(boxRef, 280);
  const CH = 56;
  const CP = { l: 2, r: 2, t: 6, b: 6 };
  const curveGeom = useMemo(() => {
    const pts = s2.curve;
    if (pts.length < 2) return null;
    const ys = pts.map((p) => p.netMn);
    const lo = Math.min(...ys, 0);
    const hi = Math.max(...ys, 0);
    const innerW = Math.max(40, W - CP.l - CP.r);
    const innerH = CH - CP.t - CP.b;
    const sx = (w: number) => CP.l + ((w + 1) / 2) * innerW;
    const sy = (v: number) => CP.t + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
    return { sx, sy, innerW };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s2.curve, W]);

  return (
    <MscCard
      title={t("signTitle")}
      info={`${t("signLead")} ${t("signCurve")}.`}
      tier={t("tierB")}
      tierWhy={t("tierBWhy")}
      span={4}
    >
      <div style={ROW}>
        <Stat
          label={t("signTilt")}
          value={s2.tilt == null ? "—" : pct(s2.tilt * 100)}
          tone={fragile ? "var(--warn)" : undefined}
          tip={t("signTiltWhy")}
        />
        <Stat
          label={t("signCritical")}
          value={inRange ? num(wStar, 2) : t("signNoFlip")}
          tip={t("signCriticalWhy")}
        />
        <Stat
          label={t("signVerdictLbl")}
          value={t(verdictKey)}
          tone={fragile ? "var(--warn)" : undefined}
        />
      </div>

      {curveGeom && (
        <div ref={boxRef} style={{ width: "100%", marginBottom: 2 }}>
          <svg width={W} height={CH} viewBox={`0 0 ${W} ${CH}`} aria-hidden>
            <line
              x1={CP.l} x2={CP.l + curveGeom.innerW}
              y1={curveGeom.sy(0)} y2={curveGeom.sy(0)}
              stroke="var(--line-2)" strokeWidth={1}
            />
            <polyline
              fill="none"
              stroke={fragile ? "var(--warn)" : "var(--brand-2)"}
              strokeWidth={1.5}
              points={s2.curve.map((p) => `${curveGeom.sx(p.w)},${curveGeom.sy(p.netMn)}`).join(" ")}
            />
            {inRange && (
              <circle cx={curveGeom.sx(wStar!)} cy={curveGeom.sy(0)} r={2.5} fill={fragile ? "var(--warn)" : "var(--text-2)"} />
            )}
            <circle
              cx={curveGeom.sx(1)}
              cy={curveGeom.sy(s2.curve[s2.curve.length - 1]?.netMn ?? 0)}
              r={2.5}
              fill="var(--brand)"
            />
          </svg>
        </div>
      )}

      <div style={TRACK_AXIS}>
        <span>{t("signWeightMinus1")}</span>
        <span>{t("signWeight0")}</span>
        <span style={{ color: "var(--text-2)" }}>{t("signWeightPlus1")}</span>
      </div>

      <CardSpacer />
      <CardFoot>
        <span style={fragile ? { color: "var(--warn)" } : undefined}>
          {fragile ? t("signFragileNote") : t("signRobustNote")}
        </span>
        {convention ? ` · ${t("signConventionLabel")}: ${convention}` : ""}
      </CardFoot>
    </MscCard>
  );
}

// ─── Hedge-flow scenario grid (Tier B) ───────────────────────────────────────────────

function scenarioCoverageLine(ms: MarketStructure, t: T): string {
  const c = ms.scenario.coverage;
  const key = c.windowed ? "scenCoverageWindow" : "scenCoverage";
  return t(key)
    .replace("{known}", String(c.known))
    .replace("{offered}", String(c.offered))
    .replace("{full}", c.full == null ? "" : String(c.full));
}

function ScenarioCard({ ms, t, convention }: { ms: MarketStructure; t: T; convention: string | null }) {
  const g = ms.scenario;
  const scale = g.maxAbs > 0 ? g.maxAbs : 1;
  const gammaUnknown = g.coverage.known === 0;

  return (
    <MscCard
      title={t("scenTitle")}
      info={`${t("scenLead")} ${t("scenDisclose")}`}
      tier={t("tierB")}
      tierWhy={t("tierBWhy")}
      headRight={
        <span style={UNIT}>
          {gammaUnknown ? "—" : `${t("scenUnit")} ± ${fmtMnMag(g.maxAbs)}`}
        </span>
      }
      span={7}
    >
      <div style={SCEN_SCROLL}>
        <table style={{ ...TABLE, minWidth: 430 }}>
          <thead>
            <tr>
              <th style={{ ...TH, whiteSpace: "nowrap" }}>
                {t("scenAxisVol")} \ {t("scenAxisSpot")}
              </th>
              {g.dsPct.map((ds) => (
                <th key={ds} style={{ ...TH, textAlign: "right" }}>
                  {ds > 0 ? `+${ds}` : ds < 0 ? `−${Math.abs(ds)}` : "0"}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.dVolPts.map((dv, i) => (
              <tr key={dv}>
                <th scope="row" style={{ ...TD, color: "var(--text-2)", whiteSpace: "nowrap", textAlign: "left", fontWeight: 500 }}>
                  {dv > 0 ? `+${dv}` : dv < 0 ? `−${Math.abs(dv)}` : "0"} {t("scenVolUnit")}
                </th>
                {g.cells[i].map((v, j) => {
                  if (v == null) {
                    return (
                      <td key={g.dsPct[j]} style={{ ...TD, textAlign: "right" }}>
                        —
                      </td>
                    );
                  }
                  const a = Math.min(1, Math.abs(v) / scale);
                  const tone = v > 0 ? "var(--flow-buy)" : v < 0 ? "var(--flow-sell)" : "transparent";
                  return (
                    <td
                      key={g.dsPct[j]}
                      style={{
                        ...TD,
                        textAlign: "right",
                        // 0.30 ceiling keeps numerals legible over the tint at full scale.
                        background: v === 0 ? "transparent" : `color-mix(in srgb, ${tone} ${(a * 30).toFixed(1)}%, transparent)`,
                      }}
                    >
                      {fmtMn(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...ROW, marginTop: 8 }}>
        <Stat
          label={t("scenCharm")}
          value={g.charmPerDayMn == null ? "—" : fmtMn(g.charmPerDayMn)}
          tone={
            g.charmPerDayMn == null
              ? undefined
              : g.charmPerDayMn > 0
                ? "var(--flow-buy)"
                : g.charmPerDayMn < 0
                  ? "var(--flow-sell)"
                  : undefined
          }
          tip={t("scenCharmWhy")}
        />
      </div>

      <CardSpacer />
      <p className={s.foot} data-testid="msc-scenario-coverage">
        {scenarioCoverageLine(ms, t)}
      </p>
      <CardFoot>
        {t("scenLegend")}
        {!g.hasVanna ? ` · ${t("scenNoVanna")}` : ""}
        {!g.hasCharm ? ` · ${t("scenNoCharm")}` : ""}
        {convention
          ? ` · ${t("signConventionLabel")}: ${convention}`
          : ` · ${t("signConventionLabel")}: ${t("scenConventionUnstated")}`}
        {` · ${t("scenNotInterval")}`}
      </CardFoot>
    </MscCard>
  );
}

// ─── Ranked gamma strikes (Tier A) — SpotGamma "Large Gamma Strikes" / MenthorQ GEX 1..n ──

function RankedStrikesCard({ ms, t, spot }: { ms: MarketStructure; t: T; spot: number | null }) {
  const top = ms.topology.topStrikes;
  const spotAbs = ms.em.emAbs1sig;
  if (!top.length) {
    return (
      <MscCard title={t("rkTitle")} tier={t("tierA")} tierWhy={t("tierAWhy")} span={5}>
        <CardFoot>{t("topoNone")}</CardFoot>
      </MscCard>
    );
  }
  const maxAbs = top[0].absMn || 1;
  return (
    <MscCard
      title={t("rkTitle")}
      info={`${t("rkLead")} ${t("topoAbsWhy")}`}
      tier={t("tierA")}
      tierWhy={t("tierAWhy")}
      span={5}
    >
      <table style={TABLE}>
        <thead>
          <tr>
            <th style={TH}>#</th>
            <th style={TH}>{t("topoColStrike")}</th>
            <th style={{ ...TH, textAlign: "right" }}>{t("topoColAbs")}</th>
            <th style={{ ...TH, textAlign: "right" }}>{t("topoColShare")}</th>
            <th style={{ ...TH, textAlign: "right" }}>{t("emColEm")}</th>
          </tr>
        </thead>
        <tbody>
          {top.map((s2, i) => {
            const distEm =
              spotAbs && spotAbs > 0 && spot != null && Number.isFinite(spot)
                ? Math.abs(s2.strike - spot) / spotAbs
                : null;
            return (
              <tr key={s2.strike}>
                <td style={{ ...TD, color: "var(--text-dim)" }}>{i + 1}</td>
                <td style={{ ...TD, fontWeight: i === 0 ? 700 : 500 }}>{price(s2.strike)}</td>
                <td style={{ ...TD, textAlign: "right" }}>
                  <span style={BAR_WRAP}>
                    <span style={{ ...BAR, width: `${Math.max(2, (s2.absMn / maxAbs) * 100)}%` }} />
                  </span>
                  {fmtMnMag(s2.absMn)}
                </td>
                <td style={{ ...TD, textAlign: "right", color: "var(--text-2)" }}>
                  {pct(s2.share * 100)}
                </td>
                <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                  {distEm == null ? (
                    "—"
                  ) : (
                    <>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{num(distEm, 2)}</span>
                      <span style={{ ...EM_CHIP, color: distEm <= 1.5 ? "var(--text-2)" : "var(--text-dim)" }}>
                        {distEm <= 1.5 ? t("emReachable") : t("emFar")}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <CardSpacer />
      <CardFoot>{t("rkFoot")}</CardFoot>
    </MscCard>
  );
}

// ─── Front expiry & the book after it (Tier B) ───────────────────────────────────────

function ExpiryCard({ ms, t }: { ms: MarketStructure; t: T }) {
  const e = ms.expiry;
  if (!e.nExp) {
    return (
      <MscCard title={t("expTitle")} tier={t("tierB")} tierWhy={t("tierBWhy")} span={4}>
        <CardFoot>{t("expNone")}</CardFoot>
      </MscCard>
    );
  }
  return (
    <MscCard
      title={t("expTitle")}
      info={t("expLead")}
      tier={t("tierB")}
      tierWhy={t("tierBWhy")}
      span={4}
    >
      <div style={STAT_GRID}>
        <Stat label={t("expNext")} value={e.nextExp ?? "—"} />
        <Stat
          label={t("expGammaShare")}
          value={pct(e.gammaSharePct)}
          tone={e.concentrated ? "var(--warn)" : undefined}
        />
        {e.deltaSharePct != null && <Stat label={t("expDeltaShare")} value={pct(e.deltaSharePct)} />}
        <Stat label={t("expCurrent")} value={fmtMn(e.currentNetMn)} />
        <Stat
          label={t("expAfter")}
          value={e.postExpiryNetMn == null ? "—" : fmtMn(e.postExpiryNetMn)}
          tone={e.signFlipsOnExpiry ? "var(--warn)" : undefined}
        />
      </div>

      {e.concentrated && (
        <Tip label={t("expConcentratedWhy")} side="top" size="card">
          <p style={{ ...WARN_LINE }} tabIndex={0}>
            {t("expConcentrated")}
          </p>
        </Tip>
      )}
      {e.signFlipsOnExpiry && (
        <Tip label={t("expSignFlipWhy")} side="top" size="card">
          <p style={{ ...WARN_LINE }} tabIndex={0}>
            {t("expSignFlip")}
          </p>
        </Tip>
      )}

      <CardSpacer />
      {e.postExpiryNetMn == null && <CardFoot>{t("expNoAfter")}</CardFoot>}
    </MscCard>
  );
}

// ─── Local styles (v5 tokens only) ───────────────────────────────────────────────────

const EMPTY: React.CSSProperties = {
  padding: "28px 12px",
  textAlign: "center",
  fontSize: 12,
  color: "var(--muted)",
};

const ROW: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px 16px",
  marginBottom: 8,
};

const STAT_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
  gap: "8px 14px",
  marginBottom: 8,
};

const STAT: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 };

const STAT_LBL: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const STAT_VAL: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text)",
  fontVariantNumeric: "tabular-nums",
};

const HINT: React.CSSProperties = {
  borderBottom: "1px dotted var(--line-3)",
  cursor: "help",
};

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 11,
};

const TH: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 500,
  fontSize: "var(--fs-micro)",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  padding: "3px 5px",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
};

const TD: React.CSSProperties = {
  padding: "3px 5px",
  color: "var(--text)",
  borderBottom: "1px solid var(--hairline)",
  fontVariantNumeric: "tabular-nums",
};

const SCEN_SCROLL: React.CSSProperties = { overflowX: "auto", minWidth: 0 };

const BAR_WRAP: React.CSSProperties = {
  display: "inline-block",
  width: 42,
  height: 4,
  marginRight: 6,
  background: "var(--inset)",
  borderRadius: 2,
  overflow: "hidden",
  verticalAlign: "middle",
};

const BAR: React.CSSProperties = {
  display: "block",
  height: "100%",
  background: "var(--text-dim)",
};

const TRACK_AXIS: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 6,
  marginTop: 2,
  fontSize: "var(--fs-micro)",
  color: "var(--text-dim)",
};

const EM_CHIP: React.CSSProperties = {
  marginLeft: 5,
  fontSize: "var(--fs-micro)",
  letterSpacing: ".03em",
};

const UNIT: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  letterSpacing: ".03em",
  color: "var(--text-dim)",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const WARN_LINE: React.CSSProperties = {
  margin: "0 0 4px",
  fontSize: 10.5,
  lineHeight: 1.45,
  color: "var(--warn)",
  cursor: "help",
};
