"use client";

import { useSectorDepthT } from "@/lib/sectorDepthLex";
import { sameSiteHref } from "@/lib/sectorDepthHref";
import styles from "./EmergenceMark.module.css";

/** Independent-emergence mark (v1.1, R6-09 "Company strength is early").
 *
 * Rendering law — the flag is OWNER-CARRIED, never derived:
 * - renders ONLY when the owner engine set `emerging === true`; absent, null
 *   and false all render nothing;
 * - `emergence_href` is actionable ONLY as a same-site relative path beginning
 *   with exactly one "/" (review N4): no scheme, no protocol-relative "//", no
 *   backslash, no whitespace/control characters. A non-conforming href is NOT
 *   rewritten — the copy still renders, the evidence link does not, and the
 *   navigation callback is never called with it. No href at all behaves the
 *   same way;
 * - the mark never changes entry qualification, lane placement, counts or any
 *   may_* flag — it is additive context on a row that is already placed;
 * - copy is number-free in both locales: the boolean carries no percentage,
 *   so none may be displayed (the bound board's example numbers are
 *   illustrative mockup data, not carried values).
 *
 * `variant="block"` is the R6-09 card anatomy at row scale (kicker → headline
 * → body → evidence link); `variant="chip"` is the compact marker for dense
 * member lines — the chip itself becomes the evidence link when the owner
 * carries a conforming destination, with the headline as its tooltip.
 */
export function EmergenceMark({
  emerging,
  href,
  onNavigate,
  variant = "block",
}: {
  emerging?: boolean | null;
  href?: string | null;
  onNavigate?: (href: string) => void;
  variant?: "block" | "chip";
}) {
  const t = useSectorDepthT();
  if (emerging !== true) return null;
  const evidence = sameSiteHref(href);

  if (variant === "chip") {
    const text = t("siEmergKicker");
    const title = t("siEmergHeadline");
    if (!evidence) {
      return (
        <span className={styles.chip} data-emergence="chip" title={title}>
          {text}
        </span>
      );
    }
    return onNavigate ? (
      <button
        type="button"
        className={styles.chip}
        data-emergence="chip"
        data-emergence-link={evidence}
        title={title}
        onClick={() => onNavigate(evidence)}
      >
        {text}
      </button>
    ) : (
      <a
        className={styles.chip}
        data-emergence="chip"
        data-emergence-link={evidence}
        title={title}
        href={evidence}
      >
        {text}
      </a>
    );
  }

  return (
    <div className={styles.block} data-emergence="block">
      <p className={styles.kicker}>{t("siEmergKicker")}</p>
      <p className={styles.headline}>{t("siEmergHeadline")}</p>
      <p className={styles.body}>{t("siEmergBody")}</p>
      {evidence &&
        (onNavigate ? (
          <button
            type="button"
            className={styles.link}
            data-emergence-link={evidence}
            onClick={() => onNavigate(evidence)}
          >
            {t("siEmergEvidence")}
          </button>
        ) : (
          <a className={styles.link} data-emergence-link={evidence} href={evidence}>
            {t("siEmergEvidence")}
          </a>
        ))}
    </div>
  );
}
