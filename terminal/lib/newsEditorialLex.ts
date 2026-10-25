/** Feature-local EN/ZH tuples; the panel receives its language from the Terminal. */
export const NEWS_EDITORIAL_LEX = {
  viewLabel: ["News view", "新闻视图"],
  "view.news": ["News & announcements", "新闻与公告"],
  "view.company": ["Company mentions", "公司提及"],
  "view.all": ["Broader coverage", "更广泛报道"],
  "description.news": [
    "Curated reports and announcements. Identified roundups, commentary and investment templates are hidden.",
    "精选报道与公告，隐藏已识别的综述、评论和模板化投资文章。",
  ],
  "description.company": [
    "Company names or marked tickers in the headline or available summary. Mentions may be incidental.",
    "标题或可用摘要中出现公司名称或明确标注的股票代码，提及可能并非报道重点。",
  ],
  "description.all": [
    "Broader curated coverage, including roundups and investment formats.",
    "更广泛的精选报道，包括综述与投资类文章。",
  ],
  limitedNames: [
    "Company-name coverage is limited; this view currently checks marked ticker references.",
    "公司名称覆盖有限；此视图目前仅检查明确标注的股票代码。",
  ],
  companyQuiet: [
    "No matching company mentions. Try News & announcements or Broader coverage.",
    "没有符合条件的公司提及。可切换至“新闻与公告”或“更广泛报道”。",
  ],
  "format.roundup": ["Roundup", "综述"],
  "format.investment_template": ["Investment template", "模板化投资文章"],
  "format.commentary": ["Commentary", "评论"],
  "mention.headline": ["Headline mention", "标题提及"],
  "mention.summary": ["Summary mention", "摘要提及"],
} as const satisfies Record<string, readonly [string, string]>;

export function newsEditorialText(key: keyof typeof NEWS_EDITORIAL_LEX, lang: "en" | "zh"): string {
  return NEWS_EDITORIAL_LEX[key][lang === "zh" ? 1 : 0];
}
