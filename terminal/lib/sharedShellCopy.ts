"use client"; // plain-language-ok: React client boundary directive, never rendered as page copy.
import { useCallback } from "react";
import { useLang, useT } from "@/lib/i18n";

// Feature copy consumes the incumbent locale context; it owns no preference or provider.
type ShellLang = "en" | "zh";
const pick = (lang: ShellLang, en: string, zh: string): string => lang === "zh" ? zh : en;
export const SHARED_SHELL_COPY: Record<string, (lang: ShellLang) => string> = {
  shellToday: (lang) => pick(lang, "Today","今日"),
  shellMonitor: (lang) => pick(lang, "Monitor","监测"),
  shellResearch: (lang) => pick(lang, "Research","研究"),
  shellMarkets: (lang) => pick(lang, "Markets","市场"),
  shellMarketUS: (lang) => pick(lang, "United States","美国"),
  shellMarketCN: (lang) => pick(lang, "China","中国"),
  shellMarketHK: (lang) => pick(lang, "Hong Kong","香港"),
  shellMarketCA: (lang) => pick(lang, "Canada","加拿大"),
  shellMarketIntl: (lang) => pick(lang, "International","全球"),
  shellWorkspace: (lang) => pick(lang, "Your workspace","您的工作区"),
  shellAllTools: (lang) => pick(lang, "All tools","全部工具"),
  shellSearchCompanies: (lang) => pick(lang, "Search companies","搜索公司"),
  shellSearchPlaceholder: (lang) => pick(lang, "Search any company…","搜索任何公司…"),
  shellOpenCurrentChart: (lang) => pick(lang, "Open current chart","打开当前图表"),
  shellOpenTerminal: (lang) => pick(lang, "Open Terminal","打开终端"),
  shellPresentation: (lang) => pick(lang, "Appearance and language","外观与语言"),
  shellTheme: (lang) => pick(lang, "Theme","主题"),
  shellLightTheme: (lang) => pick(lang, "Light theme","浅色主题"),
  shellThemeLight: (lang) => pick(lang, "Light","浅色"),
  shellThemeDark: (lang) => pick(lang, "Dark","深色"),
  shellLanguage: (lang) => pick(lang, "Language","语言"),
  shellLanguageCode: (lang) => pick(lang, "EN","中文"),
  shellChineseLanguage: (lang) => pick(lang, "Chinese language","中文界面"),
  shellLanguageEnglish: (lang) => pick(lang, "English","英语"),
  shellLanguageChinese: (lang) => pick(lang, "Chinese","中文"),
  shellOpening: (lang) => pick(lang, "Opening your workspace","正在打开工作区"),
  shellUnavailableTitle: (lang) => pick(lang, "This page could not be opened","无法打开此页面"),
  shellUnavailableBody: (lang) => pick(lang, "Try again, or open the original page to continue your work.","请重试，或打开原始页面继续工作。"),
  shellRefreshTitle: (lang) => pick(lang, "Your workspace has been updated","您的工作区已更新"),
  shellRefreshBody: (lang) => pick(lang, "Refresh to load the current version and continue.","请刷新以加载当前版本并继续。"),
  shellRefresh: (lang) => pick(lang, "Refresh workspace","刷新工作区"),
  shellOpenOriginal: (lang) => pick(lang, "Open original page","打开原始页面"),
  shellDirectoryIntro: (lang) => pick(lang, "Explore your workspaces, markets, research, and tools.","探索工作区、市场、研究及工具。"),
  shellFindPage: (lang) => pick(lang, "Find a page or tool…","查找页面或工具…"),
  shellCategories: (lang) => pick(lang, "Page categories","页面类别"),
  shellSection_all: (lang) => pick(lang, "All","全部"),
  shellSection_workspaces: (lang) => pick(lang, "Workspaces","工作区"),
  shellSection_markets: (lang) => pick(lang, "Markets","市场"),
  shellSection_research: (lang) => pick(lang, "Research","研究"),
  shellSection_learn: (lang) => pick(lang, "Learn","学习"),
  shellSection_tools: (lang) => pick(lang, "Tools","工具"),
  shellSection_about: (lang) => pick(lang, "About","关于"),
  shellNoPages: (lang) => pick(lang, "No pages found","未找到页面"),
  shellNoPagesHint: (lang) => pick(lang, "Try another name, or use company search to find a business.","请尝试其他名称，或使用公司搜索。"),
  shellShowMore: (lang) => pick(lang, "Show more","显示更多"),
  shellPageCount: (lang) => pick(lang, "{count} destinations","{count} 个页面"),
  shellNavigation: (lang) => pick(lang, "Main navigation","主导航"),
  shellMenu: (lang) => pick(lang, "Open navigation","打开导航"),
  shellCloseMenu: (lang) => pick(lang, "Close navigation","关闭导航"),
  shellSkipContent: (lang) => pick(lang, "Skip to content","跳至内容"),
};

export function useSharedShellT() {
  const { lang } = useLang();
  const t = useT();
  return useCallback((key: string, fallback?: string) => {
    const entry = Object.hasOwn(SHARED_SHELL_COPY, key) ? SHARED_SHELL_COPY[key] : undefined;
    return entry ? entry(lang) : t(key, fallback);
  }, [lang, t]);
}
