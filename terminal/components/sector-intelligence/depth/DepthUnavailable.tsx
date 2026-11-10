"use client";

import { useSectorDepthT } from "@/lib/sectorDepthLex";
import styles from "./DepthUnavailable.module.css";

/** Reader-facing display names for the carried field ids (review S5): the
 * wire id still rides the section's data attribute for tests, but the body
 * copy shows the localized capability name — never the raw internal id in the
 * ZH surface. An unmapped id renders verbatim (still an internal name, and a
 * signal to add its lex entry). */
const FIELD_LABEL_KEYS: Record<string, string> = {
  action_board: "siDepthFieldActionBoard",
  bottoming_watch: "siDepthFieldBottomingWatch",
  etf_flows: "siDepthFieldEtfFlows",
  confluence: "siDepthFieldConfluence",
  theme_table: "siThemeTableTitle",
};

/** Reader-facing owner names for the owner ids callers pass. */
const OWNER_LABEL_KEYS: Record<string, string> = {
  macro_sector_generation: "siDepthOwnerMacroGen",
};

/** Typed "unavailable by input" state for the retained depth surfaces. Rendered
 * when the selected native generation does not carry a capability's field. The
 * missing field and its Macro owner are named in the customer-facing surface —
 * never a blank panel, and never synthesized values in its place. */
export function DepthUnavailable({
  field,
  owner,
  title,
}: {
  /** The generation field this capability reads (wire id; displayed localized). */
  field: string;
  /** The owner that must supply the field, as an owner id (displayed localized). */
  owner: string;
  /** Capability heading so the reader knows what is not shown. */
  title: string;
}) {
  const t = useSectorDepthT();
  const fieldKey = FIELD_LABEL_KEYS[field];
  const ownerKey = OWNER_LABEL_KEYS[owner];
  return (
    <section className={styles.root} aria-label={title} data-depth-unavailable={field}>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.state}>{t("siDepthUnavailableTitle")}</p>
      <p className={styles.body}>
        {t("siDepthUnavailableBody", { field: fieldKey ? t(fieldKey) : field })}
      </p>
      <p className={styles.owner}>
        {t("siDepthUnavailableOwner", { owner: ownerKey ? t(ownerKey) : owner })}
      </p>
    </section>
  );
}
