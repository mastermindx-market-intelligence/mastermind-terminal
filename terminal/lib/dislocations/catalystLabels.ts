export type PlainLang = "en" | "zh";

export const CATALYST_CONTEXT_LABEL = {
  blocking_event_observed: ["Earnings filing in window", "窗口内有业绩公告"],
  event_classification_unknown: ["Filing in window, kind unclear", "窗口内有公告，类型待定"],
  event_aftermath_observed: ["Earnings aftermath", "业绩公告余波"],
  soft_event_observed: ["Minor event in window", "窗口内有次要事件"],
  no_blocking_event_observed: ["Checked: no earnings filing", "已核查：无业绩公告"],
} as const;

export const CATALYST_ON: [string, string] = ["Catalyst on file", "有催化剂记录"];
export const CATALYST_AGED: [string, string] = ["Catalyst aged out", "催化剂已过期"];
export const CATALYST_CHECK_AGED: [string, string] = ["Filing check aged out", "公告核查已过期"];

export type CatalystTone = "event" | "clear" | "aged";

function langIndex(lang: PlainLang): 0 | 1 {
  return lang === "zh" ? 1 : 0;
}

export function catalystPhrase(
  cat: { context_state?: string; coverage?: string },
  lang: PlainLang,
): string | null {
  const state = cat.context_state;
  if (state && state in CATALYST_CONTEXT_LABEL) {
    return CATALYST_CONTEXT_LABEL[state as keyof typeof CATALYST_CONTEXT_LABEL][langIndex(lang)];
  }
  if (cat.coverage) return cat.coverage;
  return null;
}

export function catalystLabel(
  cat: { context_state?: string; relevant_until: string } | undefined,
  knowableAt: string | null | undefined,
  lang: PlainLang,
): { label: string; tone: CatalystTone } | null {
  if (cat === undefined || knowableAt === null || knowableAt === undefined || knowableAt === "") {
    return null;
  }
  const i = langIndex(lang);
  const aged = cat.relevant_until < knowableAt;
  const clear = cat.context_state === "no_blocking_event_observed";

  if (aged) {
    return {
      label: (clear ? CATALYST_CHECK_AGED : CATALYST_AGED)[i],
      tone: "aged",
    };
  }

  const state = cat.context_state;
  if (state && state in CATALYST_CONTEXT_LABEL) {
    return {
      label: CATALYST_CONTEXT_LABEL[state as keyof typeof CATALYST_CONTEXT_LABEL][i],
      tone: clear ? "clear" : "event",
    };
  }

  return { label: CATALYST_ON[i], tone: "event" };
}
