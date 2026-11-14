"use client";

import { useLang } from "@/lib/i18n";
import { FactorHistoryPreview, type FactorPreviewItem } from "./FactorHistoryPreview";

const LEX = {
  adminUnavailable: [
    "Admin authorization is temporarily unavailable; no preview data is shown.",
    "管理员授权服务暂不可用，未显示预览数据。",
  ],
} as const;

/** Distinguish a transient authority outage from an affirmative denial. */
export function FactorAtlasGateUnavailable() {
  const { lang } = useLang();
  return <main role="alert">{LEX.adminUnavailable[lang === "zh" ? 1 : 0]}</main>;
}

/** Connect the presentation preview to the incumbent Terminal language context.
 * This owns no data, authentication, locale store, source permission or route.
 */
export default function FactorHistoryShellPreview({ items }: { items: readonly FactorPreviewItem[] }) {
  const { lang } = useLang();
  return <FactorHistoryPreview
    items={items}
    lang={lang}
    audience="synthetic-preview"
    urlState
    initialWindow={{ anchorDate: "2026-01-28", endDate: "2026-01-30" }}
  />;
}
