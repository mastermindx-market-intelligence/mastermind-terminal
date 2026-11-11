"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import styles from "../snapshot.module.css";

export default function SnapshotImage({ src, available }: { src: string; available: boolean }) {
  const t = useT();
  const imgRef = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unavailable">(available ? "loading" : "unavailable");
  const [retrying, setRetrying] = useState(false);
  const retryRef = useRef(false);
  function settle(image: HTMLImageElement) {
    setState(image.naturalWidth > 0 && image.naturalHeight > 0 ? "ready" : "error");
  }
  useEffect(() => {
    // A cached load/error may happen before hydration attaches the event handlers.
    const image = imgRef.current;
    if (image?.complete) settle(image);
  }, []);
  function retry() {
    if (retryRef.current) return;
    retryRef.current = true; setRetrying(true);
    window.location.reload();
  }
  return <section className={styles.imagePanel} data-snapshot-state={state} aria-label={t("xChartSnapshot")}>
    {available && (
      // The CDN is admitted under img-src, not connect-src. Keep native browser
      // image decoding and natural proportions; do not fetch/recolor/crop it.
      // eslint-disable-next-line @next/next/no-img-element
      <img ref={imgRef} className={styles.image} src={src} alt={t("xChartSnapshot")}
        hidden={state !== "ready"} onLoad={event => settle(event.currentTarget)} onError={() => setState("error")} />
    )}
    {state !== "ready" && <div className={styles.state}>
      <h2>{t(state === "loading" ? "xLoadingTitle" : "xUnavailableTitle")}</h2>
      <p role="status">{t(state === "loading" ? "xLoading" : state === "unavailable" ? "xReadUnavailable" : "xImageUnavailable")}</p>
      {state !== "loading" && <button onClick={retry} disabled={retrying}>{t(retrying ? "xRetrying" : "errRetry")}</button>}
    </div>}
  </section>;
}
