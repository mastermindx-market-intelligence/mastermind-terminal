"use client";

import { useSectorDepthT } from "@/lib/sectorDepthLex";
import styles from "./DepthUnavailable.module.css";

/** Reader-facing display names for the carried field ids (review S5): the
 * wire id still rides the section's data attribute for tests, but the body
 * copy shows the localized capability name — never the raw internal id in the
 * ZH surface. An id with no entry renders the localized generic
 * (R3-N1) — never the raw key, "undefined", or (for a prototype-named id) a
 * function's source; the raw id stays findable in the data attributes. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  action_board: "siDepthFieldActionBoard",
  bottoming_watch: "siDepthFieldBottomingWatch",
  etf_flows: "siDepthFieldEtfFlows",
  confluence: "siDepthFieldConfluence",
  theme_table: "siThemeTableTitle",
  rs_history: "siDepthFieldRsHistory",
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
  // Ownership, not value lookup (R3-N1): a prototype-named id ("constructor",
  // "toString") must fall to the generic phrase rather than resolve through
  // Object.prototype — and "undefined" never reaches the reader.
  const fieldKey = Object.hasOwn(FIELD_LABEL_KEYS, field) ? FIELD_LABEL_KEYS[field] : undefined;
  const ownerKey = Object.hasOwn(OWNER_LABEL_KEYS, owner) ? OWNER_LABEL_KEYS[owner] : undefined;
  return (
    <section
      className={styles.root}
      aria-label={title}
      data-depth-unavailable={field}
      data-owner-id={owner}
    >
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.state}>{t("siDepthUnavailableTitle")}</p>
      <p className={styles.body}>
        {t("siDepthUnavailableBody", {
          field: fieldKey ? t(fieldKey) : t("siDepthFieldGeneric"),
        })}
      </p>
      <p className={styles.owner}>
        {t("siDepthUnavailableOwner", {
          owner: ownerKey ? t(ownerKey) : t("siDepthOwnerGeneric"),
        })}
      </p>
    </section>
  );
}
