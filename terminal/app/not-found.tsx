// Root not-found page retains the root layout and its existing language provider.
import { BrandMark } from "@/components/BrandMark";
import { T } from "@/components/LocalizedCopy";
import NotFoundActions from "./not-found-actions";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <main id="shared-shell-content" tabIndex={-1} className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark} aria-hidden="true"><BrandMark size={40} /></div>
        <T as="h1" k="nfTitle" className={styles.title} />
        <NotFoundActions />
      </div>
    </main>
  );
}
