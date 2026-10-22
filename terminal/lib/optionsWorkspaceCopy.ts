import type { Lang } from "./i18n";

const OPTIONS_WORKSPACE_COPY = {
  browseCategories: ["Swipe to browse more categories", "左右滑动查看更多类别"],
} as const;

export function optionsWorkspaceCopy(lang: Lang, key: keyof typeof OPTIONS_WORKSPACE_COPY): string {
  return OPTIONS_WORKSPACE_COPY[key][lang === "zh" ? 1 : 0];
}
