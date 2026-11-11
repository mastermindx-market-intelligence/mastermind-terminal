import type { ReactNode } from "react";
import { accountIdentity, GUEST_IDENTITY } from "@/lib/accountIdentity";
import { readShellClaims } from "@/lib/shared-shell/memberIdentity";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { SharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";
import SharedShellPresentationControls from "@/components/chrome/shared-shell/SharedShellPresentationControls";
import "@/components/chrome/shared-shell/shared-shell.css";
import styles from "./snapshot.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SnapshotLayout({ children }: { children: ReactNode }) {
  // Public image access never depends on verified membership. Only the existing
  // opt-in presentation owner needs identity; unknown is never treated as guest.
  if (!isSharedShellEnabled(process.env.MMX_SHARED_SHELL)) return children;
  const member = await readShellClaims();
  if (member.state === "unavailable") return children;
  const identity = member.state === "ready" ? accountIdentity(member.subjectId, member.email) : GUEST_IDENTITY;
  return <SharedShellPresentation enabled identity={identity}>
    <div className={`shared-shell ${styles.presentation}`}>
      <div className={styles.controls}><SharedShellPresentationControls /></div>
      {children}
    </div>
  </SharedShellPresentation>;
}
