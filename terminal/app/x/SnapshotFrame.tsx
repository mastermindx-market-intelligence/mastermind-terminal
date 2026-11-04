import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "@/components/BrandMark";
import { T } from "@/components/LocalizedCopy";
import styles from "./snapshot.module.css";

export default function SnapshotFrame({ children }: { children: ReactNode }) {
  return <main className={styles.frame} data-snapshot-frame>
    <header className={styles.heading}>
      <BrandLockup />
      <T k="xChartSnapshot" as="h1" />
      <T k="xStaticImage" as="p" />
    </header>
    <div className={styles.content}>{children}</div>
    <footer className={styles.footer}><T k="xCreatedWith" />{" "}
      <Link href="/">Mastermind Terminal</Link>
    </footer>
  </main>;
}
