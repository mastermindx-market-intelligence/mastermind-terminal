import SnapshotFrame from "../SnapshotFrame";
import { T } from "@/components/LocalizedCopy";
import styles from "../snapshot.module.css";

export default function SnapshotNotFound() {
  return <SnapshotFrame><section className={styles.state} data-snapshot-state="missing">
    <T k="xMissingTitle" as="h2" />
    <T k="xMissing" as="p" />
  </section></SnapshotFrame>;
}
