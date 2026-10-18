"use client";
import { useCallback } from "react";
import { useLang, useT } from "@/lib/i18n";

// Feature copy consumes the incumbent locale context; it owns no preference or provider.
export const SHARED_SHELL_COPY: Record<string, [string, string]> = {
  shellToday: ["Today","今日"],
  shellMonitor: ["Monitor","监测"],
  shellResearch: ["Research","研究"],
  shellMarkets: ["Markets","市场"],
  shellMarketUS: ["United States","美国"],
  shellMarketCN: ["China","中国"],
  shellMarketHK: ["Hong Kong","香港"],
  shellMarketCA: ["Canada","加拿大"],
  shellMarketIntl: ["International","全球"],
  shellWorkspace: ["Your workspace","您的工作区"],
  shellAllTools: ["All tools","全部工具"],
  shellSearchCompanies: ["Search companies","搜索公司"],
  shellSearchPlaceholder: ["Search any company…","搜索任何公司…"],
  shellOpenTerminal: ["Open Terminal","打开终端"],
  shellOpening: ["Opening your workspace","正在打开工作区"],
  shellUnavailableTitle: ["This page could not be opened","无法打开此页面"],
  shellUnavailableBody: ["Try again, or open the original page to continue your work.","请重试，或打开原始页面继续工作。"],
  shellRefreshTitle: ["Your workspace has been updated","您的工作区已更新"],
  shellRefreshBody: ["Refresh to load the current version and continue.","请刷新以加载当前版本并继续。"],
  shellRefresh: ["Refresh workspace","刷新工作区"],
  shellOpenOriginal: ["Open original page","打开原始页面"],
  shellDirectoryIntro: ["Explore your workspaces, markets, research, and tools.","探索工作区、市场、研究及工具。"],
  shellFindPage: ["Find a page or tool…","查找页面或工具…"],
  shellCategories: ["Page categories","页面类别"],
  shellSection_all: ["All","全部"],
  shellSection_workspaces: ["Workspaces","工作区"],
  shellSection_markets: ["Markets","市场"],
  shellSection_research: ["Research","研究"],
  shellSection_learn: ["Learn","学习"],
  shellSection_tools: ["Tools","工具"],
  shellSection_about: ["About","关于"],
  shellNoPages: ["No pages found","未找到页面"],
  shellNoPagesHint: ["Try another name, or use company search to find a business.","请尝试其他名称，或使用公司搜索。"],
  shellShowMore: ["Show more","显示更多"],
  shellPageCount: ["{count} destinations","{count} 个页面"],
  shellNavigation: ["Main navigation","主导航"],
  shellMenu: ["Open navigation","打开导航"],
  shellCloseMenu: ["Close navigation","关闭导航"],
  shellSkipContent: ["Skip to content","跳至内容"],
};

export function useSharedShellT() {
  const { lang } = useLang();
  const t = useT();
  return useCallback((key: string, fallback?: string) => {
    const entry = Object.hasOwn(SHARED_SHELL_COPY, key) ? SHARED_SHELL_COPY[key] : undefined;
    return entry ? entry[lang === "zh" ? 1 : 0] : t(key, fallback);
  }, [lang, t]);
}
