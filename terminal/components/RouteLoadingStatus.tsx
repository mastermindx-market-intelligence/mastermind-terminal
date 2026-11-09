"use client";

import { useT } from "@/lib/i18n";
import styles from "./RouteSkeleton.module.css";

export default function RouteLoadingStatus() {
  const t = useT();
  return <span className={styles.status} role="status">{t("loading", "Loading…")}</span>;
}
