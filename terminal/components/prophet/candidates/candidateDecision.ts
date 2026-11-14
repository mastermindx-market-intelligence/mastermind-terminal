/** Presentation copy from Macro _us_candidate_pool_rows.html.j2 at d8a12a7.
 * The engine owns each decision. Unknown codes stay inspectable and never gain a new interpretation.
 */
import type { Lang } from "@/lib/i18n";
const LABELS: Readonly<Record<string, readonly [string, string]>> = {
  "sector_cap_overflow": [
    "Sector display limit reached",
    "达到板块展示上限"
  ],
  "dual_class_duplicate": [
    "Another share class is shown",
    "已展示另一股份类别"
  ],
  "buy_slice_cap": [
    "Main-list display limit reached",
    "达到主榜展示上限"
  ],
  "event_blackout": [
    "Earnings blackout",
    "财报禁入期"
  ],
  "sector_label_unreadable": [
    "Sector data needs repair",
    "板块数据待修复"
  ],
  "off_board_reason_unknown": [
    "Exclusion reason unavailable",
    "排除原因暂不可用"
  ],
  "conviction_low": [
    "No setup yet",
    "暂无买点"
  ],
  "ran_too_far": [
    "Ran too far — waiting for a pullback",
    "涨得太急 — 等回调"
  ],
  "stood_down": [
    "Standing aside for now",
    "暂时回避"
  ],
  "pending_expired": [
    "Confirmation window expired",
    "确认窗口已过期"
  ],
  "already_open": [
    "Already has a plan running",
    "已有在跑的计划"
  ],
  "base_after_event": [
    "Passed the board's checks — its base re-formed after the signal fired",
    "通过了榜单检查 — 但基底在信号触发后重新形成"
  ],
  "validation_failed": [
    "Passed the board's checks — tonight's plan data didn't verify",
    "通过了榜单检查 — 但今晚的计划数据未能核验"
  ],
  "plan_not_built": [
    "Cleared every check — no entry plan came together tonight",
    "各项检查都通过 — 但今晚没能形成完整计划"
  ],
  "board_featured": [
    "Featured on the main list",
    "主榜重点展示"
  ],
  "cleared_admission": [
    "Admission checks passed",
    "已通过准入检查"
  ],
  "ticks_unknown": [
    "Price ticks are unavailable",
    "价格数据不可用"
  ],
  "ticks_stale": [
    "Price ticks are stale",
    "价格数据过期"
  ],
  "provisional": [
    "Observation is still provisional",
    "观察仍为暂定"
  ],
  "antichase_blocked": [
    "Anti-chase protection blocked entry",
    "防追高保护阻止入场"
  ],
  "extended": [
    "Price has extended",
    "价格已延伸"
  ],
  "alpha_unknown": [
    "Alpha is unavailable",
    "阿尔法数据不可用"
  ],
  "alpha_below_floor": [
    "Alpha is below the required floor",
    "阿尔法低于要求下限"
  ],
  "earnings_blackout": [
    "Earnings blackout",
    "财报禁入期"
  ],
  "featured_cap": [
    "Main-list display limit reached",
    "达到主榜展示上限"
  ],
  "sector_cap": [
    "Sector display limit reached",
    "达到板块展示上限"
  ],
  "not_evaluated": [
    "Not evaluated for the main list",
    "未评估主榜资格"
  ],
  "entry_status_buy_now": [
    "Entry is ready now",
    "现在符合入场条件"
  ],
  "entry_status_partial": [
    "Entry is partially ready",
    "入场条件部分就绪"
  ],
  "entry_status_await_confluence": [
    "Waiting for signals to align",
    "等待信号共振"
  ],
  "entry_status_buy_soon": [
    "Entry may be near",
    "入场可能临近"
  ],
  "entry_status_watch": [
    "Watch only for now",
    "暂仅观察"
  ],
  "entry_status_wait_pullback": [
    "Wait for a pullback",
    "等待回调"
  ],
  "entry_status_hold": [
    "Hold the existing position",
    "持有现有仓位"
  ],
  "entry_status_extended": [
    "Price has extended",
    "价格已延伸"
  ],
  "entry_status_bounce_wait": [
    "Wait for a bounce",
    "等待反弹"
  ],
  "entry_status_topping": [
    "Price is topping",
    "价格见顶"
  ],
  "entry_status_exit": [
    "Exit conditions are active",
    "退出条件生效"
  ],
  "entry_status_avoid": [
    "Avoid this security",
    "回避此证券"
  ],
  "entry_status_blocked": [
    "Entry is blocked",
    "入场受阻"
  ],
  "entry_status_later": [
    "Entry is not due yet",
    "入场时机未到"
  ],
  "entry_status_await": [
    "Waiting for confirmation",
    "等待确认"
  ],
  "entry_status_unknown": [
    "Entry status is unavailable",
    "入场状态不可用"
  ],
  "stage_live": [
    "Setup is live",
    "形态已生效"
  ],
  "stage_setting_up": [
    "Setup is forming",
    "形态正在形成"
  ],
  "stage_ran": [
    "Setup has run",
    "形态已走完"
  ],
  "stage_basing": [
    "Setup is building a base",
    "形态正在筑底"
  ],
  "stage_blocked": [
    "Setup is blocked",
    "形态受阻"
  ],
  "tier_T1": [
    "Tier T1",
    "T1 等级"
  ],
  "tier_T2": [
    "Tier T2",
    "T2 等级"
  ],
  "tier_T3": [
    "Tier T3",
    "T3 等级"
  ],
  "tier_T4": [
    "Tier T4",
    "T4 等级"
  ],
  "tier_unknown": [
    "Tier is unavailable",
    "等级不可用"
  ],
  "tier_not_buyable": [
    "Signal tier is not actionable",
    "信号等级暂不可操作"
  ],
  "not_yet": [
    "Entry conditions pending",
    "入场条件待确认"
  ],
  "not_ready": [
    "Setting up, but the entry hasn't come",
    "形态在走，入场点还没到"
  ],
  "grade_low": [
    "Signal too weak to act on",
    "信号强度不足以行动"
  ],
  "pointing_down": [
    "Still heading down",
    "方向仍朝下"
  ],
  "no_trigger": [
    "No entry trigger yet",
    "还没有入场触发"
  ],
  "unknown": [
    "Held back for another reason",
    "另有原因，暂未纳入"
  ]
};
export function candidateDecision(reason: string | null, lang: Lang): string {
  if (!reason) return lang === "zh" ? "未提供决策说明" : "Decision not supplied";
  return LABELS[reason]?.[lang === "zh" ? 1 : 0] ?? (lang === "zh" ? "未标注的决策代码" : "Unlabelled decision code");
}
export function candidateDecisionKnown(reason: string | null): boolean { return !!reason && Object.hasOwn(LABELS, reason); }
