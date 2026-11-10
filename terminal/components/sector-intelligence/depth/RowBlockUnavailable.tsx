"use client";

import { useSectorDepthT } from "@/lib/sectorDepthLex";
import type { RowBlockReason } from "@/lib/sectorDepthRows";
import styles from "./DepthUnavailable.module.css";

/** Lexicon key per classified reason. The raw reason word never reaches the
 * reader in either locale — the data attribute stays off this surface so the
 * wire word cannot leak into any DOM. An out-of-set reason (a hostile prop)
 * falls to the generic unknown copy, never to an undefined key. */
const REASON_COPY_KEYS: Record<RowBlockReason, string> = {
  audience_not_entitled: "siRowsReasonEntitled",
  not_produced: "siRowsReasonNotProduced",
  invalid_shape: "siRowsReasonInvalidShape",
  block_too_large: "siRowsReasonTooLarge",
  unknown: "siRowsReasonUnknown",
};

function reasonCopyKey(reason: string): string {
  return Object.hasOwn(REASON_COPY_KEYS, reason)
    ? REASON_COPY_KEYS[reason as RowBlockReason]
    : REASON_COPY_KEYS.unknown;
}

/** Honest per-block unavailable state for the rows-increment carried blocks
 * (wire v1.1 §4). Unlike DepthUnavailable — which names a missing generation
 * FIELD and its owner — this state names WHY a carried row block reads
 * unavailable, in reader words. Never a blank panel, never a partial table. */
export function RowBlockUnavailable({
  reason,
  title,
}: {
  /** The classified reason (closed set; `unknown` covers anything else). */
  reason: RowBlockReason;
  /** Capability heading so the reader knows what is not shown. */
  title: string;
}) {
  const t = useSectorDepthT();
  return (
    <section className={styles.root} aria-label={title} data-block-state="unavailable">
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.state}>{t("siDepthUnavailableTitle")}</p>
      <p className={styles.body}>{t(reasonCopyKey(reason))}</p>
    </section>
  );
}
