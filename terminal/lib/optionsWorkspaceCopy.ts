import type { Lang } from "./i18n";

export function optionsWorkspaceCopy(lang: Lang) {
  const pick = (en: string, zh: string) => lang === "zh" ? zh : en;
  return {
    browseCategories: pick("Swipe to browse more categories", "左右滑动查看更多类别"),
  };
}
