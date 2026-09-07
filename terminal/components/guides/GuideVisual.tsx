"use client";

import { type CSSProperties, type ReactNode } from "react";
import {
  getGuideVisualMetadata,
  localizeGuideText,
  type GuideLanguage,
  type GuideVisualId,
} from "@/lib/guides/experience";
import styles from "./GuideVisual.module.css";
import { GUIDE_PROOF_DURATION_MS, useGuidePlayback } from "./useGuidePlayback";

export interface GuideVisualProps {
  suiteKey: string;
  moduleKey: string;
  lang: GuideLanguage;
}

type CandleDatum = readonly [x: number, open: number, close: number, high: number, low: number];

const PRICE_CANDLES: readonly CandleDatum[] = [
  [68, 240, 225, 255, 214],
  [100, 224, 232, 240, 207],
  [132, 231, 205, 245, 196],
  [164, 206, 214, 225, 192],
  [196, 213, 183, 220, 174],
  [228, 184, 164, 198, 151],
  [260, 165, 177, 187, 154],
  [292, 176, 143, 184, 132],
  [324, 144, 153, 166, 130],
  [356, 152, 124, 161, 113],
  [388, 125, 133, 144, 116],
  [420, 132, 101, 141, 89],
  [452, 102, 117, 129, 92],
  [484, 116, 89, 125, 78],
  [516, 90, 101, 111, 80],
  [548, 100, 74, 109, 63],
  [580, 75, 86, 98, 65],
  [612, 85, 58, 94, 48],
  [644, 59, 70, 80, 50],
] as const;

const SWING_CANDLES: readonly CandleDatum[] = [
  [72, 204, 187, 218, 176],
  [108, 187, 164, 197, 151],
  [144, 163, 178, 190, 154],
  [180, 177, 141, 187, 130],
  [216, 142, 158, 172, 133],
  [252, 157, 121, 166, 110],
  [288, 122, 138, 151, 114],
  [324, 137, 176, 187, 126],
  [360, 175, 194, 207, 163],
  [396, 195, 168, 205, 157],
  [432, 167, 185, 198, 158],
  [468, 184, 145, 196, 133],
  [504, 146, 118, 156, 108],
  [540, 117, 132, 145, 109],
  [576, 131, 93, 141, 82],
  [612, 94, 108, 119, 84],
  [648, 107, 73, 116, 62],
] as const;

const PULSE_PATH =
  "M48 204 C82 198 96 142 126 148 S166 252 204 246 S248 108 286 124 S332 236 370 217 S410 84 451 105 S491 232 532 220 S575 118 607 132 S645 193 681 155";
const RSI_PATH =
  "M48 210 C88 207 96 171 132 178 S188 117 224 134 S276 222 314 202 S352 101 395 121 S446 194 482 177 S523 91 563 112 S620 178 680 139";
const MACD_PATH =
  "M48 204 C88 212 105 236 144 220 S195 139 235 151 S281 213 322 191 S369 100 410 123 S455 208 498 186 S545 91 585 117 S630 173 680 149";
const SIGNAL_PATH =
  "M48 198 C88 201 111 218 146 209 S196 158 234 163 S281 198 323 183 S369 126 408 139 S455 191 497 179 S544 117 585 129 S631 163 680 153";

function Grid({ split = false }: { split?: boolean }) {
  const xs = [48, 138, 228, 318, 408, 498, 588, 678];
  const ys = split ? [52, 96, 140, 184, 228, 272, 316] : [52, 104, 156, 208, 260, 312];
  return (
    <g className="gp-visual-grid" aria-hidden="true">
      {xs.map((x) => <path key={`x-${x}`} d={`M${x} 38V322`} />)}
      {ys.map((y) => <path key={`y-${y}`} d={`M38 ${y}H690`} />)}
    </g>
  );
}

function Candles({
  data = PRICE_CANDLES,
  opacity = 1,
  stateColors = false,
}: {
  data?: readonly CandleDatum[];
  opacity?: number;
  stateColors?: boolean;
}) {
  return (
    <g className="gp-visual-candles" opacity={opacity} aria-hidden="true">
      {data.map(([x, open, close, high, low], index) => {
        const up = close < open;
        const state = stateColors
          ? index < 5 ? "defensive" : index < 9 ? "transition" : index < 14 ? "constructive" : "expansion"
          : up ? "up" : "down";
        const width = 12;
        return (
          <g className={`gp-visual-candle gp-visual-candle-${state}`} key={x}>
            <path d={`M${x} ${high}V${low}`} />
            <rect
              x={x - width / 2}
              y={Math.min(open, close)}
              width={width}
              height={Math.max(4, Math.abs(close - open))}
              rx="2"
            />
          </g>
        );
      })}
    </g>
  );
}

function Tag({
  x,
  y,
  children,
  tone = "accent",
  width,
}: {
  x: number;
  y: number;
  children: ReactNode;
  tone?: "bull" | "bear" | "accent" | "warn" | "muted";
  width?: number;
}) {
  const tagWidth = width ?? Math.max(52, String(children).length * 7 + 18);
  return (
    <g className={`gp-visual-tag gp-visual-tag-${tone}`} transform={`translate(${x} ${y})`}>
      <rect width={tagWidth} height="24" rx="12" />
      <text x={tagWidth / 2} y="16" textAnchor="middle">{children}</text>
    </g>
  );
}

function Point({ x, y, tone = "accent", r = 5 }: {
  x: number;
  y: number;
  tone?: "bull" | "bear" | "accent" | "warn";
  r?: number;
}) {
  return <circle className={`gp-visual-point gp-visual-point-${tone}`} cx={x} cy={y} r={r} />;
}

function AxisLabel({ x, y, children, anchor = "start" }: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
}) {
  return <text className="gp-visual-axis-label" x={x} y={y} textAnchor={anchor}>{children}</text>;
}

function Arrow({ x1, y1, x2, y2, tone = "accent" }: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone?: "bull" | "bear" | "accent" | "warn";
}) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 8;
  const p1x = x2 - size * Math.cos(angle - Math.PI / 6);
  const p1y = y2 - size * Math.sin(angle - Math.PI / 6);
  const p2x = x2 - size * Math.cos(angle + Math.PI / 6);
  const p2y = y2 - size * Math.sin(angle + Math.PI / 6);
  return (
    <g className={`gp-visual-arrow gp-visual-arrow-${tone}`}>
      <path d={`M${x1} ${y1}L${x2} ${y2}`} />
      <path d={`M${p1x} ${p1y}L${x2} ${y2}L${p2x} ${p2y}`} />
    </g>
  );
}

function OscillatorFrame({ kind, children }: { kind: "pulse" | "rsi" | "macd"; children: ReactNode }) {
  const labels = kind === "rsi" ? [["70", 102], ["50", 180], ["30", 258]] : [["+100", 76], ["0", 180], ["−100", 284]];
  return (
    <>
      <Grid />
      <g className={`gp-visual-oscillator-zones gp-visual-oscillator-zones-${kind}`}>
        <rect x="38" y="38" width="652" height={kind === "rsi" ? "64" : "38"} rx="10" />
        <rect x="38" y={kind === "rsi" ? "258" : "284"} width="652" height={kind === "rsi" ? "64" : "38"} rx="10" />
      </g>
      {labels.map(([label, y]) => (
        <g key={String(label)}>
          <path className="gp-visual-threshold" d={`M38 ${y}H690`} />
          <AxisLabel x={64} y={Number(y) - 7}>{label}</AxisLabel>
        </g>
      ))}
      {children}
    </>
  );
}

function DivergenceScene({ kind, lang }: { kind: "pulse" | "rsi" | "macd"; lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const lowerPath = kind === "rsi"
    ? "M54 286 C112 269 153 291 210 278 S302 247 356 259 S450 286 514 256 S606 229 680 237"
    : "M54 286 C104 303 158 293 210 278 S297 251 355 264 S449 292 510 259 S599 227 680 239";
  const accentLabel = kind === "pulse" ? "PULSE" : kind === "rsi" ? "RSI" : "MACD";
  return (
    <>
      <Grid split />
      <path className="gp-visual-divider" d="M38 178H690" />
      <path className="gp-visual-price-line" d="M54 134 C116 118 155 139 213 120 S308 91 359 105 S454 128 514 96 S604 62 680 68" />
      <path className="gp-visual-line-accent" d={lowerPath} />
      <path className="gp-visual-divergence-price" d="M514 96L680 68" />
      <path className="gp-visual-divergence-osc" d="M510 259L680 239" />
      <Point x={514} y={96} tone="bear" />
      <Point x={680} y={68} tone="bear" />
      <Point x={510} y={259} tone="bull" />
      <Point x={680} y={239} tone="bull" />
      <AxisLabel x={54} y={66}>PRICE</AxisLabel>
      <AxisLabel x={54} y={216}>{accentLabel}</AxisLabel>
      <Tag x={488} y={136} tone="bull" width={174}>{l("BULLISH DIVERGENCE", "看涨背离")}</Tag>
      <Arrow x1={576} y1={161} x2={615} y2={235} tone="bull" />
    </>
  );
}

function MtfScene({ kind, lang }: { kind: "pulse" | "rsi" | "macd"; lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const timeframes = [l("CHART", "图表"), "2×", "4×"];
  const rows = kind === "pulse"
    ? [l("STATE", "状态"), l("SIGNAL", "信号"), l("DIVERGENCE", "背离")]
    : kind === "rsi"
      ? ["RSI", l("SIGNAL", "信号"), l("DIVERGENCE", "背离")]
      : ["MACD", l("SIGNAL", "信号"), l("PHASE", "阶段")];
  const values = kind === "rsi"
    ? [["42", "58", "64"], ["TURN", "UP", "UP"], ["B+", "—", "—"]]
    : kind === "macd"
      ? [["−34", "18", "47"], ["TURN", "UP", "UP"], ["ACC", "EXP", "EXP"]]
      : [["−28", "12", "55"], ["TURN", "BUY", "UP"], ["B+", "—", "—"]];
  const toneGrid = [
    ["bear", "warn", "bull"],
    ["warn", "bull", "bull"],
    ["bull", "muted", "muted"],
  ];
  return (
    <>
      <Grid />
      <g className="gp-visual-mtf-card">
        <rect x="64" y="54" width="592" height="250" rx="18" />
        <text x="88" y="83" className="gp-visual-mtf-title">
          {kind.toUpperCase()} · {l("CHART + COMPLETED BLOCKS", "图表＋已完成区块")}
        </text>
        {timeframes.map((tf, col) => (
          <g key={tf}>
            <rect x={314 + col * 104} y="98" width="90" height="30" rx="8" />
            <text x={359 + col * 104} y="118" textAnchor="middle">{tf}</text>
          </g>
        ))}
        {rows.map((row, rowIndex) => (
          <g key={row}>
            <text x="88" y={163 + rowIndex * 53}>{row}</text>
            {values[rowIndex].map((value, col) => (
              <g
                key={`${row}-${timeframes[col]}`}
                className={`gp-visual-mtf-cell gp-visual-mtf-cell-${toneGrid[rowIndex][col]}`}
              >
                <rect x={314 + col * 104} y={140 + rowIndex * 53} width="90" height="34" rx="8" />
                <text x={359 + col * 104} y={162 + rowIndex * 53} textAnchor="middle">{value}</text>
              </g>
            ))}
          </g>
        ))}
      </g>
    </>
  );
}

function DashboardScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const metrics = [
    [l("VOLATILITY", "波动率"), "24.3%", "accent"],
    [l("COMPRESSION", "压缩"), "7.8", "warn"],
    [l("TREND", "趋势"), "▲ 3", "bull"],
    [l("PRESSURE", "压力"), "▲ 2", "bull"],
  ] as const;
  return (
    <>
      <Grid />
      <g className="gp-visual-dashboard-card">
        <rect x="58" y="48" width="604" height="264" rx="18" />
        <text className="gp-visual-dashboard-title" x="84" y="80">{l("MARKET STATE", "市场状态")}</text>
        <Tag x={540} y={58} tone="bull" width={92}>A−</Tag>
        {metrics.map(([label, value, tone], index) => (
          <g className={`gp-visual-metric gp-visual-metric-${tone}`} key={label}>
            <rect x={84 + (index % 2) * 286} y={100 + Math.floor(index / 2) * 66} width="262" height="50" rx="10" />
            <text x={102 + (index % 2) * 286} y={121 + Math.floor(index / 2) * 66}>{label}</text>
            <text x={326 + (index % 2) * 286} y={132 + Math.floor(index / 2) * 66} textAnchor="end">{value}</text>
          </g>
        ))}
        <text className="gp-visual-dashboard-subtitle" x="84" y="250">{l("CHART + RESAMPLED TREND", "图表＋重采样趋势")}</text>
        {[l("CHART", "图表"), "2×", "4×"].map((tf, index) => (
          <g className={`gp-visual-mini-state gp-visual-mini-state-${index < 2 ? "bull" : "warn"}`} key={tf}>
            <rect x={352 + index * 90} y="230" width="76" height="36" rx="9" />
            <text x={390 + index * 90} y="253" textAnchor="middle">{tf} {index < 2 ? "▲" : "◆"}</text>
          </g>
        ))}
      </g>
    </>
  );
}

function Histogram({ phase = false }: { phase?: boolean }) {
  const values = [-30, -46, -58, -50, -35, -18, 8, 28, 48, 68, 82, 65, 43, 22, 7, -12, -33, -47, -38, -21, 5, 22];
  return (
    <g className="gp-visual-histogram" aria-hidden="true">
      {values.map((value, index) => {
        const x = 54 + index * 29;
        const height = Math.abs(value);
        const positive = value >= 0;
        const rising = index === 0 || Math.abs(value) >= Math.abs(values[index - 1]);
        const phaseClass = phase
          ? index < 6 ? "accumulation" : index < 11 ? "expansion" : index < 16 ? "distribution" : "contraction"
          : positive ? rising ? "positive-rising" : "positive-falling" : rising ? "negative-rising" : "negative-falling";
        return (
          <rect
            className={`gp-visual-histogram-bar gp-visual-histogram-bar-${phaseClass}`}
            key={x}
            x={x}
            y={positive ? 180 - height : 180}
            width="18"
            height={height}
            rx="3"
          />
        );
      })}
    </g>
  );
}

function StructureMarketScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <Candles data={SWING_CANDLES} opacity={0.9} />
      <path className="gp-visual-swing-line" d="M72 218L180 130L288 114L396 205L504 108L648 62" />
      <path className="gp-visual-level gp-visual-level-bear" d="M180 130H392" />
      <path className="gp-visual-level gp-visual-level-bull" d="M288 114H528" />
      <Point x={396} y={205} tone="bear" />
      <Point x={504} y={108} tone="bull" />
      <Tag x={305} y={137} tone="bear" width={92}>CHoCH ↓</Tag>
      <Tag x={532} y={80} tone="bull" width={82}>BOS ↑</Tag>
      <AxisLabel x={84} y={294}>{l("CONTROL HAND-OFF", "控制权交接")}</AxisLabel>
      <Arrow x1={260} y1={280} x2={392} y2={208} tone="bear" />
    </>
  );
}

function StructureOrderBlockScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const leadIn: readonly CandleDatum[] = [
    [72, 178, 164, 188, 153],
    [106, 164, 184, 193, 154],
    [140, 181, 205, 216, 169],
  ];
  const origin: readonly CandleDatum[] = [[174, 201, 229, 241, 191]];
  const displacement: readonly CandleDatum[] = [
    [210, 230, 176, 238, 164],
    [246, 177, 143, 187, 132],
    [282, 144, 116, 154, 105],
    [318, 117, 94, 127, 84],
  ];
  const returnLeg: readonly CandleDatum[] = [
    [354, 95, 119, 130, 86],
    [390, 118, 151, 161, 108],
    [426, 150, 184, 195, 140],
    [462, 183, 217, 230, 174],
  ];
  const rejection: readonly CandleDatum[] = [
    [498, 218, 170, 227, 158],
    [534, 171, 139, 180, 128],
    [570, 140, 108, 151, 98],
    [606, 109, 78, 119, 68],
    [642, 79, 58, 91, 49],
  ];
  return (
    <>
      <Grid />
      <g className={styles.obLeadIn} aria-hidden="true">
        <Candles data={leadIn} opacity={0.58} />
      </g>
      <g className={styles.obOrigin} data-proof-beat="origin">
        <rect className={styles.originHalo} x="158" y="187" width="32" height="58" rx="8" />
        <Candles data={origin} />
        <Tag x={105} y={254} tone="bear" width={136}>{l("ORIGIN CANDLE", "起始 K 线")}</Tag>
      </g>
      <g className={styles.obDisplacement} data-proof-beat="displacement">
        <Candles data={displacement} />
        <path className={styles.impulsePath} d="M174 229L210 176L246 143L282 116L318 94" />
        <Tag x={220} y={57} tone="bull" width={132}>{l("DISPLACEMENT", "位移确认")}</Tag>
      </g>
      <g className={`gp-visual-zone gp-visual-zone-bull ${styles.obZone}`} data-proof-beat="zone">
        <rect x="158" y="201" width="510" height="42" rx="8" />
        <path className={styles.zoneOuterEdge} d="M158 243H668" />
        <AxisLabel x={202} y={236}>{l("ACTIVE UNTIL A CLOSE BELOW", "收盘跌破前保持有效")}</AxisLabel>
      </g>
      <g className={styles.obMitigation} data-proof-beat="mitigation">
        <Candles data={returnLeg} />
        <path className={styles.returnPath} d="M318 94C365 99 407 144 462 217" />
        <Point x={462} y={217} tone="warn" r={7} />
        <Tag x={390} y={251} tone="warn" width={130}>{l("FIRST RETURN", "首次回补")}</Tag>
      </g>
      <g className={styles.obRejection} data-proof-beat="rejection">
        <Candles data={rejection} />
        <path className={styles.rejectionPath} d="M462 217C500 198 545 129 642 58" />
        <Tag x={510} y={46} tone="bull" width={126}>{l("REJECTION", "拒绝后延续")}</Tag>
      </g>
      <g
        className={styles.obInvalidation}
        data-proof-beat="invalidation"
        data-proof-outcome="alternative-failure"
      >
        <path className={styles.failureProbe} d="M462 217C482 238 505 270 536 282" />
        <path className={styles.failureCross} d="M526 276L546 288M546 276L526 288" />
        <Tag x={438} y={300} tone="bear" width={230}>
          {l("ALTERNATIVE · CLOSE BELOW", "另一结果 · 收盘跌破")}
        </Tag>
      </g>
    </>
  );
}

function StructureFvgScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <Candles />
      <g className="gp-visual-fvg-open">
        <rect x="274" y="112" width="260" height="44" rx="7" />
        <path d="M274 112H534M274 156H534" />
      </g>
      <g className="gp-visual-fvg-fill">
        <rect x="435" y="112" width="99" height="44" rx="7" />
      </g>
      <Tag x={286} y={78} tone="accent" width={102}>{l("OPEN FVG", "未填补 FVG")}</Tag>
      <Tag x={446} y={164} tone="muted" width={94}>62% {l("FILLED", "已填补")}</Tag>
      <path className="gp-visual-inversion-line" d="M534 156H674" />
      <Tag x={570} y={173} tone="bear" width={72}>iFVG</Tag>
      <Arrow x1={600} y1={168} x2={605} y2={151} tone="bear" />
    </>
  );
}

function StructurePdScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <g className="gp-visual-range-zones">
        <rect className="gp-visual-range-premium" x="62" y="54" width="596" height="112" rx="14" />
        <rect className="gp-visual-range-equilibrium" x="62" y="166" width="596" height="30" />
        <rect className="gp-visual-range-discount" x="62" y="196" width="596" height="112" rx="14" />
        <rect className="gp-visual-golden-pocket" x="62" y="230" width="596" height="26" />
      </g>
      <path className="gp-visual-range-swing" d="M92 286L622 72" />
      <Point x={92} y={286} tone="bull" r={7} />
      <Point x={622} y={72} tone="bear" r={7} />
      <AxisLabel x={86} y={82}>{l("PREMIUM", "溢价")}</AxisLabel>
      <AxisLabel x={86} y={188}>{l("EQUILIBRIUM · 0.50", "均衡 · 0.50")}</AxisLabel>
      <AxisLabel x={86} y={294}>{l("DISCOUNT", "折价")}</AxisLabel>
      <Tag x={464} y={236} tone="warn" width={156}>{l("GOLDEN POCKET", "黄金口袋")}</Tag>
    </>
  );
}

function StructureLiquidityScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <Candles data={SWING_CANDLES} opacity={0.88} />
      <path className="gp-visual-liquidity-line" d="M112 126H574" />
      {[145, 286, 435, 548].map((x, index) => <Point key={x} x={x} y={126} tone={index === 3 ? "bear" : "warn"} r={index === 3 ? 7 : 5} />)}
      <g className="gp-visual-liquidity-bubbles">
        {[0, 1, 2, 3, 4].map((index) => <circle key={index} cx={410 + index * 21} cy={102 - (index % 2) * 8} r={4 + index} />)}
      </g>
      <path className="gp-visual-sweep-path" d="M548 126L576 70L600 153L638 112" />
      <Tag x={102} y={88} tone="warn" width={158}>{l("EQUAL-HIGH POOL", "等高流动性池")}</Tag>
      <Tag x={560} y={44} tone="bear" width={82}>{l("SWEEP", "扫单")}</Tag>
      <Tag x={595} y={159} tone="bull" width={82}>{l("RECLAIM", "收回")}</Tag>
    </>
  );
}

function StructureSfpScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <Candles data={SWING_CANDLES} opacity={0.86} />
      <path className="gp-visual-level gp-visual-level-accent" d="M78 126H650" />
      <rect className="gp-visual-deviation-zone" x="515" y="69" width="92" height="57" rx="9" />
      <path className="gp-visual-sfp-wick" d="M548 126L575 62L594 157" />
      <path className="gp-visual-invalidation" d="M516 58H626" />
      <Point x={594} y={157} tone="bull" r={7} />
      <Tag x={452} y={75} tone="bear" width={92}>{l("DEVIATION", "偏离")}</Tag>
      <Tag x={548} y={166} tone="bull" width={116}>{l("CLOSE INSIDE", "收回区间")}</Tag>
      <AxisLabel x={626} y={53} anchor="end">{l("INVALIDATION", "失效位")}</AxisLabel>
      <Arrow x1={474} y1={200} x2={585} y2={161} tone="bull" />
    </>
  );
}

function StructureSrScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const levels = [
    { y: 92, score: "84", tone: "bear" },
    { y: 178, score: "96", tone: "accent" },
    { y: 262, score: "71", tone: "bull" },
  ] as const;
  return (
    <>
      <Grid />
      <Candles data={SWING_CANDLES} opacity={0.76} />
      {levels.map(({ y, score, tone }) => (
        <g className={`gp-visual-ranked-level gp-visual-ranked-level-${tone}`} key={y}>
          <path d={`M62 ${y}H658`} />
          <rect x="612" y={y - 14} width="46" height="28" rx="8" />
          <text x="635" y={y + 5} textAnchor="middle">{score}</text>
        </g>
      ))}
      {[142, 280, 410].map((x) => <Point key={x} x={x} y={178} tone="accent" />)}
      <path className="gp-visual-role-flip" d="M428 178L478 138L528 190L590 150" />
      <Tag x={394} y={194} tone="warn" width={106}>{l("ROLE FLIP", "角色互换")}</Tag>
      <AxisLabel x={74} y={72}>{l("REACTION SCORE", "反应评分")}</AxisLabel>
    </>
  );
}

function StructureMfpScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const profile = [48, 72, 108, 152, 202, 248, 286, 238, 184, 128, 82, 54];
  const pricePath = "M58 253C102 238 120 201 160 208S211 155 242 168";
  const valueAreaTop = 97;
  return (
    <>
      <Grid />
      <g className={styles.mfpAuction} aria-hidden="true">
        <path className="gp-visual-price-line" d={pricePath} />
        <path className={styles.auctionBaseline} d="M330 42V318" />
        <AxisLabel x={56} y={305}>{l("AUCTION BUILDS THE PROFILE", "价格拍卖构建分布")}</AxisLabel>
      </g>
      <g className={`gp-visual-profile ${styles.mfpProfile}`} data-proof-beat="profile-build">
        {profile.map((width, index) => (
          <rect
            className={styles.profileBar}
            key={`${width}-${index}`}
            x="344"
            y={57 + index * 20}
            width={width}
            height="13"
            rx="4"
            style={{ "--bar-index": index } as CSSProperties}
          />
        ))}
      </g>
      <g className={styles.mfpPoc} data-proof-beat="poc">
        <path className="gp-visual-poc" d="M330 177H668" />
        <Tag x={588} y={150} tone="warn" width={70}>POC</Tag>
      </g>
      <g className={styles.mfpValueArea} data-proof-beat="value-area">
        <rect className="gp-visual-value-area" x="330" y={valueAreaTop} width="338" height="160" rx="10" />
        <path className={styles.valueEdge} d={`M330 ${valueAreaTop}H668M330 257H668`} />
        <Tag x={340} y={268} tone="accent" width={102}>{l("VALUE AREA", "价值区")}</Tag>
      </g>
      <g className={styles.mfpEdgeTest} data-proof-beat="edge-test">
        <path className={styles.edgeApproach} d={`M242 168C275 151 302 126 330 ${valueAreaTop}`} />
        <Point x={330} y={valueAreaTop} tone="accent" r={7} />
        <AxisLabel x={222} y={148}>{l("TEST THE EDGE", "测试价值区边界")}</AxisLabel>
      </g>
      <g className={styles.mfpOutcomes} data-proof-beat="acceptance-rejection">
        <g data-proof-outcome="acceptance-outside">
          <path
            className={styles.acceptPath}
            d={`M330 ${valueAreaTop}C360 82 392 75 424 78S480 69 526 72`}
          />
          <Point x={526} y={72} tone="bull" r={5} />
          <Tag x={488} y={42} tone="bull" width={180}>
            {l("HOLD OUTSIDE · ACCEPT", "区外企稳 · 接受")}
          </Tag>
        </g>
        <g data-proof-outcome="rejection-back-inside">
          <path
            className={styles.rejectPath}
            d={`M330 ${valueAreaTop}C362 80 390 76 415 82C435 88 441 118 478 137`}
          />
          <Point x={478} y={137} tone="bear" r={5} />
          <Tag x={470} y={110} tone="bear" width={198}>
            {l("BACK INSIDE · REJECT", "返回区内 · 拒绝")}
          </Tag>
        </g>
      </g>
    </>
  );
}

function StructurePatternScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <Candles data={SWING_CANDLES} opacity={0.58} />
      <path className="gp-visual-pattern-boundary" d="M82 106L474 150" />
      <path className="gp-visual-pattern-boundary" d="M82 236L474 280" />
      <path className="gp-visual-pattern-boundary gp-visual-threshold" d="M82 171L474 215" />
      <path className="gp-visual-breakout-path" d="M474 150L530 105L590 79L660 64" />
      <Point x={482} y={144} tone="bull" r={7} />
      <path className="gp-visual-target-line" d="M520 62H670" />
      <Arrow x1={530} y1={148} x2={530} y2={64} tone="warn" />
      <Tag x={405} y={171} tone="bull" width={118}>{l("CONFIRMED", "突破确认")}</Tag>
      <Tag x={548} y={30} tone="warn" width={100}>{l("TARGET", "量度目标")}</Tag>
      <AxisLabel x={94} y={302}>{l("PARALLEL CHANNEL", "平行通道")}</AxisLabel>
    </>
  );
}

function TrendEngineScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const railY = 166;
  const retestX = 324;
  const beforeFlip: readonly CandleDatum[] = [
    [72, 113, 139, 151, 102],
    [108, 138, 121, 148, 110],
    [144, 122, 151, 163, 111],
    [180, 150, 132, 160, 121],
  ];
  const flipAndDrive: readonly CandleDatum[] = [
    [216, 133, 102, 143, 91],
    [252, 103, 78, 113, 68],
    [288, 79, 98, 109, 69],
  ];
  const retestAndTrend: readonly CandleDatum[] = [
    [retestX, 97, 128, railY, 87],
    [360, 127, 110, 137, 99],
    [396, 111, 87, 121, 76],
    [432, 88, 101, 112, 78],
    [468, 100, 72, 110, 61],
    [504, 73, 84, 95, 63],
    [540, 83, 55, 93, 44],
    [576, 56, 68, 79, 46],
    [612, 67, 42, 77, 32],
  ];
  return (
    <>
      <Grid />
      <g className={styles.trendContext} aria-hidden="true">
        <Candles data={beforeFlip} opacity={0.62} />
        <path className={styles.bearRail} d="M58 91H202V116H232" />
        <AxisLabel x={60} y={77}>{l("BEAR RAIL", "空头轨道")}</AxisLabel>
      </g>
      <g className={styles.trendFlip} data-proof-beat="rail-flip">
        <Candles data={flipAndDrive} />
        <path className={styles.flipPath} d="M180 132L216 102L252 78" />
        <path className={styles.bullRailStart} d={`M206 ${railY}H342`} />
      </g>
      <g className={styles.trendEntry} data-proof-beat="entry">
        <Point x={216} y={102} tone="bull" r={8} />
        <Arrow x1={275} y1={213} x2={220} y2={112} tone="bull" />
        <Tag x={244} y={210} tone="bull" width={86}>BUY +</Tag>
      </g>
      <g
        className={styles.trendRetest}
        data-proof-beat="retest"
        data-retest-x={retestX}
        data-rail-y={railY}
      >
        <Candles data={retestAndTrend} />
        <path className={styles.retestPath} d={`M288 98C301 109 313 145 ${retestX} ${railY}C337 157 350 123 360 110`} />
        <Point x={retestX} y={railY} tone="warn" r={7} />
        <Arrow x1={390} y1={255} x2={329} y2={176} tone="warn" />
        <Tag x={338} y={258} tone="warn" width={124}>{l("HELD RETEST", "回测守住")}</Tag>
      </g>
      <g className={styles.trendInvalidation} data-proof-beat="invalidation">
        <path className="gp-visual-stop-rail" d="M206 166H342V158H414V133H486V111H558V88H646" />
        <Tag x={506} y={214} tone="bear" width={124}>{l("TRAIL = EXIT", "轨道 = 退出")}</Tag>
      </g>
      <g className={styles.trendTargets} data-proof-beat="targets">
        {[["TP1", 90], ["TP2", 64], ["TP3", 38]].map(([label, y], index) => (
          <g
            className={`gp-visual-target-rung ${styles.targetRung}`}
            data-target-hit="true"
            data-target-y={y}
            key={String(label)}
            style={{ "--target-index": index } as CSSProperties}
          >
            <path d={`M420 ${y}H668`} />
            <Tag x={354} y={Number(y) - 12} tone={index === 2 ? "warn" : "bull"} width={58}>{label}</Tag>
            <text x="676" y={Number(y) + 5}>✓</text>
          </g>
        ))}
      </g>
    </>
  );
}

function TrendFlowBandScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <Candles opacity={0.78} />
      <path className="gp-visual-flow-cloud" d="M52 262 C140 254 190 219 266 213 S374 163 450 148 S563 93 680 82 L680 116 C570 121 518 151 450 171 S337 210 266 237 S137 283 52 286Z" />
      <path className="gp-visual-flow-edge" d="M52 262 C140 254 190 219 266 213 S374 163 450 148 S563 93 680 82" />
      <path className="gp-visual-flow-edge gp-visual-flow-edge-secondary" d="M52 286 C137 283 193 254 266 237 S373 192 450 171 S570 121 680 116" />
      <Point x={392} y={180} tone="bull" r={8} />
      <Arrow x1={388} y1={239} x2={392} y2={191} tone="bull" />
      <Tag x={298} y={241} tone="bull" width={152}>{l("FIRST RETEST · 87", "首次回测 · 87")}</Tag>
      <AxisLabel x={524} y={67}>{l("FLOW EXPANSION", "资金流扩张")}</AxisLabel>
    </>
  );
}

function TrendVoltScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <path className="gp-visual-envelope-fill" d="M48 114 C145 101 216 122 304 111 S483 88 680 102 L680 256 C502 246 400 262 304 248 S143 254 48 243Z" />
      <path className="gp-visual-envelope-upper" d="M48 114 C145 101 216 122 304 111 S483 88 680 102" />
      <path className="gp-visual-envelope-lower" d="M48 243 C143 254 216 235 304 248 S502 246 680 256" />
      <Candles data={SWING_CANDLES} opacity={0.9} />
      <path className="gp-visual-overextension" d="M468 145L510 74L545 122" />
      <Point x={510} y={74} tone="warn" r={9} />
      <Point x={545} y={122} tone="bull" r={7} />
      <Tag x={430} y={43} tone="warn" width={126}>{l("OVEREXTENDED", "过度延伸")}</Tag>
      <Tag x={535} y={133} tone="bull" width={112}>{l("BACK INSIDE", "回到带内")}</Tag>
    </>
  );
}

function TrendCandlePainterScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <Candles data={SWING_CANDLES} stateColors />
      <path className="gp-visual-state-rail" d="M70 287H252V276H395V264H540V249H666" />
      <Tag x={66} y={295} tone="bear" width={112}>{l("DEFENSIVE", "防御")}</Tag>
      <Tag x={264} y={286} tone="warn" width={116}>{l("TRANSITION", "过渡")}</Tag>
      <Tag x={470} y={272} tone="bull" width={138}>{l("CONSTRUCTIVE", "建设性")}</Tag>
      <g className="gp-visual-mode-chips">
        {[l("TREND", "趋势"), l("MOMENTUM", "动量"), l("VOLUME", "成交量")].map((label, index) => (
          <g key={label}>
            <rect x={432 + index * 78} y="44" width="70" height="25" rx="8" />
            <text x={467 + index * 78} y="61" textAnchor="middle">{label}</text>
          </g>
        ))}
      </g>
    </>
  );
}

function PulseWaveScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <OscillatorFrame kind="pulse">
      <path className="gp-visual-pulse-area" d={`${PULSE_PATH} L681 180L48 180Z`} />
      <path className="gp-visual-line-accent" d={PULSE_PATH} />
      <Point x={204} y={246} tone="warn" r={8} />
      <Arrow x1={203} y1={294} x2={204} y2={257} tone="warn" />
      <Tag x={120} y={288} tone="warn" width={142}>{l("SLOPE TURNS FIRST", "斜率率先转向")}</Tag>
      <Point x={286} y={124} tone="bull" />
      <Tag x={300} y={130} tone="bull" width={112}>{l("ZERO RECLAIM", "收复零轴")}</Tag>
    </OscillatorFrame>
  );
}

function PulseSignalScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <OscillatorFrame kind="pulse">
      <path className="gp-visual-pulse-area" d={`${PULSE_PATH} L681 180L48 180Z`} />
      <path className="gp-visual-line-accent" d={PULSE_PATH} />
      <g className="gp-visual-diamond gp-visual-diamond-warn" transform="translate(199 246) rotate(45)">
        <rect x="-7" y="-7" width="14" height="14" rx="2" />
      </g>
      <Point x={451} y={105} tone="bear" r={7} />
      <Tag x={236} y={241} tone="bull" width={72}>BUY</Tag>
      <Tag x={418} y={66} tone="bear" width={72}>SELL</Tag>
      <path className="gp-visual-gapped-cross" d="M516 202L528 214M516 214L528 202" />
      <AxisLabel x={535} y={214}>{l("GAPPED CROSS", "间隔交叉")}</AxisLabel>
    </OscillatorFrame>
  );
}

function PulseVolumeScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const volumes = [26, 40, 31, 48, 62, 92, 55, 44, 73, 106, 136, 88, 61, 38, 54, 82, 118, 76, 46, 30];
  return (
    <OscillatorFrame kind="pulse">
      <g className="gp-visual-volume-map">
        {volumes.map((height, index) => (
          <rect key={`${height}-${index}`} x={54 + index * 31} y={306 - height} width="18" height={height} rx="4" />
        ))}
      </g>
      <path className="gp-visual-line-accent" d={PULSE_PATH} />
      <Tag x={324} y={57} tone="accent" width={146}>{l("1.8× PARTICIPATION", "1.8× 参与度")}</Tag>
      <Arrow x1={394} y1={85} x2={391} y2={197} tone="accent" />
      <AxisLabel x={516} y={299}>{l("RELATIVE VOLUME", "相对成交量")}</AxisLabel>
    </OscillatorFrame>
  );
}

function PulseFlowScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <OscillatorFrame kind="pulse">
      <path className="gp-visual-pulse-area" d={`${PULSE_PATH} L681 180L48 180Z`} />
      <path className="gp-visual-line-accent" d={PULSE_PATH} />
      <path className="gp-visual-money-flow" d="M48 230 C112 214 159 225 212 196 S311 163 365 178 S451 140 506 153 S599 119 680 132" />
      <path className="gp-visual-cvd-flow" d="M48 252 C107 260 160 244 216 248 S314 215 370 221 S467 184 522 193 S611 158 680 164" />
      <Tag x={518} y={91} tone="bull" width={70}>MFI</Tag>
      <Tag x={568} y={177} tone="accent" width={70}>CVD</Tag>
      <g className="gp-visual-pressure-wedge">
        <path d="M480 247L664 247L664 203Z" />
      </g>
      <AxisLabel x={489} y={269}>{l("PRESSURE BUILDS", "压力累积")}</AxisLabel>
    </OscillatorFrame>
  );
}

function RsiEngineScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <OscillatorFrame kind="rsi">
      <path className="gp-visual-rsi-area" d={`${RSI_PATH} L680 258L48 258Z`} />
      <path className="gp-visual-line-accent" d={RSI_PATH} />
      <path className="gp-visual-rsi-smooth" d="M48 217 C105 207 145 184 196 171 S286 181 331 169 S419 147 469 153 S562 132 680 144" />
      <Tag x={510} y={74} tone="warn" width={112}>{l("STRETCHED", "过度延伸")}</Tag>
      <Point x={563} y={112} tone="warn" />
      <Tag x={324} y={183} tone="accent" width={106}>{l("REGIME 50", "环境 50")}</Tag>
    </OscillatorFrame>
  );
}

function RsiSignalScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <OscillatorFrame kind="rsi">
      <path className="gp-visual-line-accent" d={RSI_PATH} />
      <Point x={314} y={202} tone="bull" r={8} />
      <Tag x={244} y={226} tone="bull" width={116}>{l("REVERSAL", "反转")}</Tag>
      <g className="gp-visual-deviation-steps">
        <path d="M314 202L395 121L482 177" />
        <text x="389" y="108">+1</text>
        <text x="475" y="165">+2</text>
      </g>
      <Point x={395} y={121} tone="warn" r={6} />
      <Point x={482} y={177} tone="warn" r={6} />
      <path className="gp-visual-rsi-cross" d="M520 151L535 166M520 166L535 151" />
      <Tag x={536} y={144} tone="accent" width={106}>{l("CROSS", "交叉确认")}</Tag>
    </OscillatorFrame>
  );
}

function RsiChannelScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <OscillatorFrame kind="rsi">
      <path className="gp-visual-rsi-channel-fill" d="M48 164 C105 154 151 132 202 142 S294 121 344 134 S439 104 492 116 S584 96 680 108 L680 188 C584 176 534 194 484 184 S395 198 344 185 S253 202 202 190 S106 213 48 220Z" />
      <path className="gp-visual-rsi-channel-edge" d="M48 164 C105 154 151 132 202 142 S294 121 344 134 S439 104 492 116 S584 96 680 108" />
      <path className="gp-visual-rsi-channel-edge" d="M48 220 C106 213 151 180 202 190 S293 173 344 185 S434 174 484 184 S584 176 680 188" />
      <path className="gp-visual-line-accent" d={RSI_PATH} />
      <Point x={563} y={112} tone="warn" r={8} />
      <Arrow x1={585} y1={69} x2={565} y2={101} tone="warn" />
      <Tag x={506} y={44} tone="warn" width={146}>{l("CHANNEL EXPANSION", "通道扩张")}</Tag>
      <Tag x={332} y={194} tone="bull" width={146}>{l("MEAN REVERSION", "均值回归")}</Tag>
    </OscillatorFrame>
  );
}

function MacdEngineScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <OscillatorFrame kind="macd">
      <path className="gp-visual-macd-area" d={`${MACD_PATH} L680 180L48 180Z`} />
      <path className="gp-visual-line-accent" d={MACD_PATH} />
      <path className="gp-visual-signal-line" d={SIGNAL_PATH} />
      <Point x={235} y={151} tone="bull" />
      <Point x={410} y={123} tone="bull" />
      <Tag x={174} y={112} tone="bull" width={112}>{l("CROSS + SLOPE", "交叉＋斜率")}</Tag>
      <Tag x={520} y={73} tone="accent" width={116}>{l("NORMALIZED", "标准化")}</Tag>
    </OscillatorFrame>
  );
}

function MacdSignalScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <OscillatorFrame kind="macd">
      <path className="gp-visual-line-accent" d={MACD_PATH} />
      <path className="gp-visual-signal-line" d={SIGNAL_PATH} />
      <rect className="gp-visual-extreme-window" x="82" y="214" width="142" height="70" rx="14" />
      <Point x={144} y={220} tone="bear" r={7} />
      <path className="gp-visual-rotation-arc" d="M126 247Q150 202 196 180" />
      <Arrow x1={151} y1={225} x2={195} y2={181} tone="bull" />
      <Tag x={83} y={288} tone="bear" width={142}>{l("EXTREME ≠ ENTRY", "极值 ≠ 入场")}</Tag>
      <Tag x={192} y={147} tone="bull" width={120}>{l("ROTATION", "旋转触发")}</Tag>
    </OscillatorFrame>
  );
}

function MacdHistogramScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  return (
    <>
      <Grid />
      <path className="gp-visual-threshold" d="M38 180H690" />
      <Histogram />
      <path className="gp-visual-line-accent" d={MACD_PATH} />
      <Tag x={212} y={67} tone="bull" width={98}>{l("RISING", "正向增强")}</Tag>
      <Tag x={350} y={113} tone="warn" width={98}>{l("FADING", "正向减弱")}</Tag>
      <Tag x={493} y={239} tone="bear" width={96}>{l("FLIP", "零轴翻转")}</Tag>
      <Arrow x1={523} y1={232} x2={520} y2={189} tone="bear" />
    </>
  );
}

function MacdTrendScene({ lang }: { lang: GuideLanguage }) {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  const phases = [
    [48, 186, "accumulation", l("ACCUMULATION", "吸筹")],
    [186, 332, "expansion", l("EXPANSION", "扩张")],
    [332, 492, "distribution", l("DISTRIBUTION", "派发")],
    [492, 680, "contraction", l("CONTRACTION", "收缩")],
  ] as const;
  return (
    <>
      <Grid />
      <g className="gp-visual-phase-bands">
        {phases.map(([start, end, tone, label]) => (
          <g className={`gp-visual-phase gp-visual-phase-${tone}`} key={tone}>
            <rect x={start} y="42" width={end - start} height="276" />
            <text x={(start + end) / 2} y="65" textAnchor="middle">{label}</text>
          </g>
        ))}
      </g>
      <Histogram phase />
      <path className="gp-visual-line-accent" d={MACD_PATH} />
      <path className="gp-visual-signal-line" d={SIGNAL_PATH} />
      <Arrow x1={140} y1={291} x2={264} y2={88} tone="bull" />
      <Arrow x1={420} y1={85} x2={570} y2={256} tone="bear" />
    </>
  );
}

function VisualScene({ id, lang }: { id: GuideVisualId; lang: GuideLanguage }) {
  switch (id) {
    case "structure/ms": return <StructureMarketScene lang={lang} />;
    case "structure/ob": return <StructureOrderBlockScene lang={lang} />;
    case "structure/fvg": return <StructureFvgScene lang={lang} />;
    case "structure/pd": return <StructurePdScene lang={lang} />;
    case "structure/liq": return <StructureLiquidityScene lang={lang} />;
    case "structure/sfp": return <StructureSfpScene lang={lang} />;
    case "structure/sr": return <StructureSrScene lang={lang} />;
    case "structure/mfp": return <StructureMfpScene lang={lang} />;
    case "structure/pat": return <StructurePatternScene lang={lang} />;
    case "trend/te": return <TrendEngineScene lang={lang} />;
    case "trend/fb": return <TrendFlowBandScene lang={lang} />;
    case "trend/vb": return <TrendVoltScene lang={lang} />;
    case "trend/cp": return <TrendCandlePainterScene lang={lang} />;
    case "trend/dash": return <DashboardScene lang={lang} />;
    case "pulse/wave": return <PulseWaveScene lang={lang} />;
    case "pulse/sig": return <PulseSignalScene lang={lang} />;
    case "pulse/div": return <DivergenceScene kind="pulse" lang={lang} />;
    case "pulse/vmap": return <PulseVolumeScene lang={lang} />;
    case "pulse/flow": return <PulseFlowScene lang={lang} />;
    case "pulse/mtf": return <MtfScene kind="pulse" lang={lang} />;
    case "rsix/eng": return <RsiEngineScene lang={lang} />;
    case "rsix/sig": return <RsiSignalScene lang={lang} />;
    case "rsix/div": return <DivergenceScene kind="rsi" lang={lang} />;
    case "rsix/chan": return <RsiChannelScene lang={lang} />;
    case "rsix/mtf": return <MtfScene kind="rsi" lang={lang} />;
    case "macdx/eng": return <MacdEngineScene lang={lang} />;
    case "macdx/sig": return <MacdSignalScene lang={lang} />;
    case "macdx/hist": return <MacdHistogramScene lang={lang} />;
    case "macdx/div": return <DivergenceScene kind="macd" lang={lang} />;
    case "macdx/trend": return <MacdTrendScene lang={lang} />;
    case "macdx/mtf": return <MtfScene kind="macd" lang={lang} />;
  }
}

const SUITE_ACCENTS: Record<string, string> = {
  structure: "#70a5ff",
  trend: "#3ee2b8",
  pulse: "#b68cff",
  rsix: "#45c7ff",
  macdx: "#ffb45c",
};

/**
 * Responsive, accessible schematic used at the top of an indicator guide.
 *
 * The surrounding guide owns layout; all hooks intentionally use the `gp-visual`
 * prefix so the experience can be themed without coupling this component to the
 * legacy GuidePanel styles.
 */
export default function GuideVisual({ suiteKey, moduleKey, lang }: GuideVisualProps) {
  const metadata = getGuideVisualMetadata(suiteKey, moduleKey);
  const isPurposefulAnimation = !!metadata && metadata.experience !== "static";
  const {
    playState,
    playbackRun,
    pause,
    prefersReducedMotion,
    replay,
    rootRef,
    resume,
  } = useGuidePlayback(`${suiteKey}/${moduleKey}`, isPurposefulAnimation);
  if (!metadata) return null;

  const title = localizeGuideText(metadata.title, lang);
  const kicker = localizeGuideText(metadata.kicker, lang);
  const caption = localizeGuideText(metadata.caption, lang);
  const safeId = metadata.id.replace("/", "-");
  const titleId = `gp-visual-title-${safeId}`;
  const descriptionId = `gp-visual-description-${safeId}`;
  const style = {
    "--gp-visual-accent": SUITE_ACCENTS[suiteKey] ?? SUITE_ACCENTS.structure,
    "--guide-proof-duration": `${GUIDE_PROOF_DURATION_MS}ms`,
  } as CSSProperties;
  const playbackLabel = playState === "playing"
    ? (lang === "zh" ? "暂停动画" : "Pause animation")
    : playState === "paused"
      ? (lang === "zh" ? "继续动画" : "Resume animation")
      : (lang === "zh" ? "重播动画" : "Replay animation");
  const playbackText = playState === "playing"
    ? (lang === "zh" ? "暂停" : "Pause")
    : playState === "paused"
      ? (lang === "zh" ? "继续" : "Resume")
      : (lang === "zh" ? "重播" : "Replay");
  const playbackIcon = playState === "playing" ? "Ⅱ" : playState === "paused" ? "▶" : "↻";
  const togglePlayback = playState === "playing"
    ? pause
    : playState === "paused"
      ? resume
      : replay;
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;

  return (
    <figure
      className={`gp-visual gp-visual-${suiteKey} ${styles.figure}`}
      data-guide-visual={metadata.id}
      data-motion={prefersReducedMotion ? "reduced" : "full"}
      data-play-state={isPurposefulAnimation ? playState : "static"}
      data-proof-scene={isPurposefulAnimation ? metadata.experience : undefined}
      ref={rootRef}
      style={style}
    >
      <div className="gp-visual-frame">
        <div className="gp-visual-topline">
          <span className="gp-visual-kicker">{kicker}</span>
          {isPurposefulAnimation && (
            <div className="gp-visual-player-status">
              <span className="gp-visual-live" aria-hidden="true">
                <i className="gp-visual-live-dot" />{l("MODEL", "模型")}
              </span>
              {!prefersReducedMotion && (
                <button
                  aria-label={playbackLabel}
                  className="gp-visual-playback-button"
                  onClick={togglePlayback}
                  type="button"
                >
                  <span aria-hidden="true">{playbackIcon}</span>
                  <span className="gp-visual-playback-label">{playbackText}</span>
                </button>
              )}
            </div>
          )}
        </div>
        <svg
          className={`gp-visual-svg${isPurposefulAnimation ? ` ${styles.proofScene}` : ""}`}
          key={isPurposefulAnimation ? `${metadata.id}-${playbackRun}` : metadata.id}
          viewBox="0 0 720 360"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>{title}</title>
          <desc id={descriptionId}>{caption}</desc>
          <rect className="gp-visual-canvas" x="1" y="1" width="718" height="358" rx="18" />
          <VisualScene id={metadata.id} lang={lang} />
        </svg>
      </div>
      <figcaption className="gp-visual-caption">
        <div className="gp-visual-copy">
          <span className="gp-visual-title">{title}</span>
          <span className="gp-visual-description">{caption}</span>
        </div>
        <ul className="gp-visual-legend" aria-label={lang === "zh" ? "图例" : "Legend"}>
          {metadata.legend.map((item) => (
            <li className="gp-visual-legend-item" key={item.label.en}>
              <span
                className={`gp-visual-legend-swatch gp-visual-legend-swatch-${item.tone}`}
                aria-hidden="true"
              />
              {localizeGuideText(item.label, lang)}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
