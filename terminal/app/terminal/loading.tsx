import RouteSkeleton from "@/components/RouteSkeleton";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import styles from "@/components/RouteSkeleton.module.css";

export default function Loading() {
  if (isSharedShellEnabled(process.env.MMX_SHARED_SHELL)) {
    // The streaming fallback has no route query or account context. A neutral
    // canvas fits both Beta and installed-app entries without flashing old menus.
    return <div className={styles.chartEntry}><RouteSkeleton title="Chart" variant="chart" bare /></div>;
  }
  return <RouteSkeleton title="Chart" variant="chart" />;
}
