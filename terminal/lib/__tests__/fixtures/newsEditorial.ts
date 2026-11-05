import type { TickerNewsEditorialView, TickerNewsViewMode } from "@/lib/newsTypes";

export function editorialView(
  mode: TickerNewsViewMode = "news",
  revision = (mode === "news" ? "a" : mode === "company" ? "b" : "c").repeat(64),
): TickerNewsEditorialView {
  return {
    schema: "ticker_news.editorial_view.v1", rules: "ticker_news.editorial_rules.v1",
    mode, revision, name_coverage: "names_and_symbols",
  };
}

export const NEWS_VIEW = editorialView();
