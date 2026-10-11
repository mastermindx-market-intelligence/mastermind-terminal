"use client";
import { useCallback } from "react";
import { useLang } from "./i18n";

/**
 * E05 feature-local EN/ZH copy for watchlist note/flag sync. Language state stays the shared
 * LangProvider; the strings stay here so the shared LEX (and every screen evidenced against it)
 * is untouched. `{n}` is the only placeholder.
 */
export const WATCHLIST_ANNOTATION_LEX: Record<string, [string, string]> = {
  wasChecking: ["Checking sync…", "正在检查同步…"],
  wasSaving: ["Saving to your account…", "正在保存到账户…"],
  wasSynced: ["Notes & flags synced", "备注和旗标已同步"],
  wasRetrying: ["Not synced · {n} saved on this device only", "未同步 · {n} 项仅保存在本设备"],
  wasConflict: ["{n} sync conflict(s) — choose a version", "{n} 处同步冲突 —— 请选择版本"],
  wasUnavailable: ["Sync unavailable · saved on this device", "同步不可用 · 已保存在本设备"],
  wasAuth: ["Sync paused · this tab is no longer signed in as this account — reload or sign in", "同步已暂停 · 此标签页已不再以该账户登录 —— 请刷新或重新登录"],
  wasReadFailed: ["Couldn't read your other devices · retrying", "无法读取其他设备 · 正在重试"],
  wasRejected: ["{n} can't sync (too long or invalid)", "{n} 项无法同步（过长或无效）"],
  wasImportOffer: ["Import {n} guest note(s)/flag(s)", "导入 {n} 项访客备注/旗标"],
  wasRetryNow: ["Retry now", "立即重试"],
  // Compact chip labels; the full sentence above rides in the chip's title / accessible name.
  wasSyncedShort: ["Synced", "已同步"],
  wasSavingShort: ["Saving…", "保存中…"],
  wasCheckingShort: ["Checking…", "检查中…"],
  wasRetryingShort: ["Not synced · {n}", "未同步 · {n}"],
  wasConflictShort: ["Conflict · {n}", "冲突 · {n}"],
  wasUnavailableShort: ["Sync off", "同步不可用"],
  wasAuthShort: ["Sync paused", "同步已暂停"],
  wasReadFailedShort: ["Sync read failed", "同步读取失败"],
  wasRejectedShort: ["Can't sync · {n}", "无法同步 · {n}"],
  wasImportShort: ["Import guest · {n}", "导入访客 · {n}"],
  wasChipTitle: ["Watchlist notes and flags sync across your signed-in devices", "自选备注和旗标会在已登录的设备间同步"],
  wasNote: ["Note", "备注"],
  wasFlag: ["Flag", "旗标"],
  wasCleared: ["(none)", "（无）"],
  wasClose: ["Close", "关闭"],
  wasConflictTitle: ["Resolve sync conflict", "解决同步冲突"],
  wasConflictIntro: [
    "This was changed on another device while it was also changed here. Nothing has been overwritten — choose the version to keep.",
    "此项在另一台设备上被修改，同时本设备也做了修改。目前没有任何内容被覆盖 —— 请选择要保留的版本。",
  ],
  wasThisDevice: ["This device", "本设备"],
  wasOtherDevice: ["Other device", "其他设备"],
  wasKeepMine: ["Keep this device's", "保留本设备版本"],
  wasUseTheirs: ["Use other device's", "使用其他设备版本"],
  wasConflictCount: ["{n} remaining", "还剩 {n} 处"],
  wasImportTitle: ["Import guest notes and flags?", "导入访客备注和旗标？"],
  wasImportIntro: [
    "These were saved in this browser while signed out. Importing adds them to this account and syncs them to your other devices.",
    "这些内容是在未登录时保存在本浏览器中的。导入后会添加到当前账户，并同步到你的其他设备。",
  ],
  wasImportOriginals: [
    "The originals stay in this browser's guest notes until your account confirms the save.",
    "在账户确认保存之前，原始内容会保留在本浏览器的访客备注中。",
  ],
  wasImportCollisions: [
    "Not imported — this account already has a different value (the guest copy stays in this browser):",
    "未导入 —— 当前账户已有不同内容（访客副本仍保留在本浏览器中）：",
  ],
  wasImportConfirm: ["Import {n}", "导入 {n} 项"],
  wasImportLater: ["Not now", "暂不导入"],
  wasSymbol: ["Symbol", "代码"],
  wasAccountValue: ["Account", "账户"],
  wasGuestValue: ["Guest", "访客"],
};

export function useAnnotationT() {
  const { lang } = useLang();
  return useCallback((key: string, n?: number): string => {
    const pair = WATCHLIST_ANNOTATION_LEX[key];
    const text = pair ? pair[lang === "zh" ? 1 : 0] : key;
    return n === undefined ? text : text.replace("{n}", String(n));
  }, [lang]);
}
