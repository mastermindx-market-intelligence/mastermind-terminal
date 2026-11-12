import { BrandLockup } from "@/components/BrandMark";
import { AppNav } from "@/components/AppNav";
import MobileNav from "@/components/MobileNav";
import RouteLoadingStatus from "@/components/RouteLoadingStatus";
import styles from "./RouteSkeleton.module.css";

// Instant placeholder shown the moment a tab is clicked (via each route's loading.tsx),
// while the server streams the real page. Reproduces the persistent chrome — topbar +
// left nav rail (which highlights the destination tab via usePathname) + the mobile bar —
// so switching feels immediate instead of freezing on the previous tab or blanking the
// top bar on mobile. Decorative placeholders pulse together per variant.
//
// `bare` mode renders ONLY the .main2 body (no .app2 grid / topbar / AppNav / MobileNav):
// used by routes whose chrome is already owned by a layout (e.g. /flow), where re-emitting
// the full shell would double-render the grid inside the layout's grid cell.
export default function RouteSkeleton({
  title,
  variant,
  bare = false,
}: {
  title: string;
  variant: "chart" | "table" | "editor";
  bare?: boolean;
}) {
  const railRows = Array.from({ length: 9 });
  const tableRows = Array.from({ length: 11 });
  const body = (
    <main className={`main2 ${styles.workspace}`} data-route-loading={variant}>
      <div className={styles.heading}>
        <div className={`${styles.block} ${styles.title}`} aria-hidden="true" />
        <RouteLoadingStatus />
      </div>
      <div className={styles.body} aria-hidden="true">
        {variant !== "table" && (
          <div className={styles.rail}>
            {railRows.map((_, i) => (
              <div key={i} className={`${styles.block} ${styles.railRow}`} />
            ))}
          </div>
        )}
        <div className={styles.content}>
          {variant === "table" ? (
            <>
              <div className={styles.toolbar}>
                <div className={styles.block} />
                <div className={styles.block} />
              </div>
              {tableRows.map((_, i) => (
                <div key={i} className={styles.row}>
                  <div className={styles.block} />
                  <div className={styles.block} />
                  <div className={styles.block} />
                  <div className={styles.block} />
                </div>
              ))}
            </>
          ) : (
            <div className={`${styles.block} ${styles.canvas}`} />
          )}
        </div>
      </div>
    </main>
  );

  if (bare) return body;

  return (
    <div className="app2">
      <MobileNav email="" />
      <header className="topbar">
        <BrandLockup />
        <div className="tdiv" />
        <span className="page-title">{title}</span>
        <div className="spacer" />
        <div className="avatar" aria-hidden />
      </header>
      <AppNav />
      {body}
      <div className="ticker">
        <span className="lbl" style={{ opacity: 0.6 }}>{title}</span>
        <span style={{ color: "var(--text-dim)" }}>loading…</span>
      </div>
    </div>
  );
}
