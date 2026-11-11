/**
 * prophetGateStrings.ts — bilingual EN/ZH strings for the Prophet variant of
 * the entitlement gate (ruling D10): /prophet and /prophet/evaluation are
 * gated by the SAME `terminal_live_options` entitlement as /options, but the
 * gate must pitch the product the visitor is actually standing on.
 *
 * This is desk-local product copy, so it lives beside the desk's own strings
 * (prophetSectorStrings.ts) instead of the global LEX: 17 evidence packets
 * pin lib/i18n.tsx's bytes, and none of them crop this gate.
 *
 * Only the product copy differs from the Options gate (title, body, feature
 * bullets); the plan eyebrow, CTA and sub line stay the shared OptionsPaywall
 * keys. The entitlement rule itself is unchanged (same rule, same tiers, same
 * server gate, same 401).
 *
 * HONESTY DOCTRINE (DESIGN_DOCTRINE + prophetStrings law): copy is grounded
 * in the desk's own shipped vocabulary and describes only what an entitled
 * member sees today — the Macro Plans lane with its nightly-EOD cadence, the
 * per-plan geometry ladder (entry/stop/targets) and management rows, the
 * strategy evaluation page, and the #1460 sector journey. No skill,
 * validation or direction claim is made here.
 */

import type { Lang } from "@/lib/i18n";

export const PROPHET_GATE_LEX = {
  title: ["Unlock the Prophet desk", "解锁 Prophet 预言台"],
  // D12/E5: ONE sentence — what Prophet is, and which plan it needs. The
  // trial lives on the shared CTA/sub line, not repeated here.
  body: [
    "Prophet is Mastermind's managed-pick research desk — nightly factor-engine Macro Plans and the strategy evaluation against simply owning the market — and it needs an Essential or Pro plan.",
    "Prophet 是 Mastermind 的主动选股研究台 —— 因子引擎每晚发布的宏观计划，以及对比直接持有大盘的策略评估 —— 需订阅 Essential 或 Pro 计划。",
  ],
  f1: ["Nightly Macro Plans from the factor engine", "因子引擎每晚发布的宏观计划"],
  // D12/E5: plain words for the reader benefit, not the widget names — what
  // "trade geometry and management read" gives you: the plan's own price
  // levels, and the management read as the plan plays out.
  f2: ["Each plan's entry, stop and target levels, plus its management read as it plays out", "每个计划的入场、止损与目标位，以及随行情演进的应对解读"],
  f3: ["Strategy evaluation vs simply owning the market", "对比直接持有大盘的策略评估"],
  // D12/E5: the sector journey #1460 shipped — sector members, each
  // company's setup, and their sources.
  f4: ["Sector journey — every sector member and each company's setup, with sources", "行业旅程 —— 各行业成分与每家公司的交易设定，附来源"],
} as const;

export type ProphetGateKey = keyof typeof PROPHET_GATE_LEX;

export function getProphetGateStr(lang: Lang, key: ProphetGateKey): string {
  const entry = PROPHET_GATE_LEX[key];
  return lang === "zh" ? entry[1] : entry[0];
}
