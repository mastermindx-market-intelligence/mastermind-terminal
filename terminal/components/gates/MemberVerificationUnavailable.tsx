"use client";
import { pick } from "@/lib/finFormat";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import styles from "./MemberGate.module.css";

/** Account outage is separate from a guest gate and never loads a private workspace. */
export default function MemberVerificationUnavailable() {
  const { lang } = useLang();
  const router = useRouter();
  const zh = lang === "zh";
  return <main id="shared-shell-content" tabIndex={-1} className={styles.viewport}>
    <div className={`${styles.card} ${styles.stateCard}`}>
      <h1 className={styles.title}>{pick(zh, "Account service unavailable", "账户服务暂不可用")}</h1>
      <p className={styles.body} role="status">{pick(zh, "Your private workspace has not been loaded. Try verifying your account again.", "尚未加载私人工作区。请重试账户验证。")}</p>
      <button type="button" className={`btn btn-primary ${styles.action}`} onClick={() => router.refresh()}>{pick(zh, "Retry account verification", "重试账户验证")}</button>
    </div>
  </main>;
}
