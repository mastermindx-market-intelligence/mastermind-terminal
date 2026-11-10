"use client";

import { useSectorDepthT } from "@/lib/sectorDepthLex";
import styles from "./DepthUnavailable.module.css";

/** Typed "unavailable by input" state for the retained depth surfaces. Rendered
 * when the selected native generation does not carry a capability's field. The
 * missing field and its Macro owner are named in the customer-facing surface —
 * never a blank panel, and never synthesized values in its place. */
export function DepthUnavailable({
  field,
  owner,
  title,
}: {
  /** The exact generation field this capability reads (customer-readable name). */
  field: string;
  /** The owner that must supply the field (e.g. the Macro generation lane). */
  owner: string;
  /** Capability heading so the reader knows what is not shown. */
  title: string;
}) {
  const t = useSectorDepthT();
  return (
    <section className={styles.root} aria-label={title} data-depth-unavailable={field}>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.state}>{t("siDepthUnavailableTitle")}</p>
      <p className={styles.body}>
        {t("siDepthUnavailableBody", { field })}
      </p>
      <p className={styles.owner}>{t("siDepthUnavailableOwner", { owner })}</p>
    </section>
  );
}
