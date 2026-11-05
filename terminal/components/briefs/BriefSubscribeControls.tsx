"use client";

import type { BriefLang, BriefTargetKind } from "@/lib/briefs";

/**
 * Contextual scheduling is intentionally retired.
 *
 * Recurring Briefs are managed from the central Alerts → Briefs surface. Keep
 * this compatibility component inert while older workspaces still import it;
 * it performs no reads or writes and renders no UI.
 */
export default function BriefSubscribeControls(_props: {
  targetKind: BriefTargetKind;
  targetId?: string | null;
  listName?: string;
  lang: BriefLang;
}) {
  return null;
}
