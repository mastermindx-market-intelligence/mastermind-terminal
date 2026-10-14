import { useId } from "react";
import styles from "./InvestigationWorkspace.module.css";

/** Read only the observation from the already-admitted saved revision. */
export default function InvestigationNextObservation({ value, lang }: { value?: string; lang: "en" | "zh" }) {
  const headingId = useId();
  if (!value) return null;
  return <section className={styles.card} aria-labelledby={headingId}>
    <h3 id={headingId}>{lang === "zh" ? "下一项观察" : "Next observation"}</h3>
    <p className={styles.question}>{value}</p>
  </section>;
}
