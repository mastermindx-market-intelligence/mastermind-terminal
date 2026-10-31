import { useId } from "react";
import styles from "./InvestigationWorkspace.module.css";

const LEX = { nextObservation: ["Next observation", "下一项观察"] } as const;

/** Read only the observation from the already-admitted saved revision. */
export default function InvestigationNextObservation({ value, lang }: { value?: string; lang: "en" | "zh" }) {
  const headingId = useId();
  if (!value) return null;
  return <section className={styles.card} aria-labelledby={headingId}>
    <h3 id={headingId}>{LEX["nextObservation"][lang === "zh" ? 1 : 0]}</h3>
    <p className={styles.question}>{value}</p>
  </section>;
}
