"use client";

import { useLang } from "@/lib/i18n";

/** Scoped EN/ZH tuples follow the Options companion's bilingual copy contract. */
export const TAPE_VIEW_LEX = {
  tapeViewSide: ["Inferred side", "推断方向"],
  tapeViewSwept: ["Swept", "扫单"],
  tapeViewShare: ["Share Tape view", "分享期权流视图"],
  tapeViewTitle: ["Link to this Tape view", "此期权流视图链接"],
  tapeViewCopy: ["Copy link", "复制链接"],
  tapeViewCopied: ["Link copied", "链接已复制"],
  tapeViewCopyFailed: ["Select the link and copy it manually.", "请选择链接并手动复制。"],
  tapeViewNote: ["Restores your filters and sort order using the recipient’s latest available feed. It does not save a snapshot or grant access.", "使用接收者最新可用的数据恢复筛选条件和排序，不保存数据快照，也不授予访问权限。"],
  tapeViewClose: ["Close share link", "关闭分享链接"],
  tapeViewInvalid: ["This Tape view could not be restored", "无法恢复此期权流视图"],
  tapeViewInvalidBody: ["The link contains unsupported filters. No unfiltered results are shown. Open the default Tape to start again.", "链接包含不支持的筛选条件。当前不显示未筛选的结果。请打开默认期权流重新开始。"],
  tapeViewClearCombined: ["Clear combined conditions", "清除组合条件"],
  tapeViewCombinedDetails: ["View combined conditions", "查看组合条件"],
  tapeViewOpenDefault: ["Open default Tape", "打开默认期权流"],
} as const;

export function useTapeViewText() {
  const { lang } = useLang();
  return (key: keyof typeof TAPE_VIEW_LEX) => TAPE_VIEW_LEX[key][lang === "zh" ? 1 : 0];
}
