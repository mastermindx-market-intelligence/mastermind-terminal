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
 * member sees today — no skill, validation or direction claim is made here.
 */

import type { Lang } from "@/lib/i18n";

export const PROPHET_GATE_LEX = {
  title: ["Unlock the Prophet desk", "解锁 Prophet 预言台"],
  body: [
    "Prophet is Mastermind's managed-pick research desk — nightly model plans from the factor engine, each with its trade geometry and management read, plus the strategy evaluation that measures the book against simply owning the market. Access requires an Essential or Pro plan — sign up to start the free 7-day trial.",
    "Prophet 是 Mastermind 的主动选股研究台 —— 因子引擎每晚发布的模型计划（含交易结构与管理解读），以及将模型组合与直接持有大盘对比的策略评估。需订阅 Essential 或 Pro 计划方可使用 —— 注册即可开启 7 天免费试用。",
  ],
  f1: ["Nightly Macro Plans from the factor engine", "因子引擎每晚发布的宏观计划"],
  f2: ["Per-plan trade geometry and management read", "每个计划的交易结构与管理解读"],
  f3: ["Strategy evaluation vs simply owning the market", "对比直接持有大盘的策略评估"],
  f4: ["Options Alpha research lane — shadow, display only", "期权阿尔法研究通道 —— 影子模式，仅供展示"],
} as const;

export type ProphetGateKey = keyof typeof PROPHET_GATE_LEX;

export function getProphetGateStr(lang: Lang, key: ProphetGateKey): string {
  const entry = PROPHET_GATE_LEX[key];
  return lang === "zh" ? entry[1] : entry[0];
}
