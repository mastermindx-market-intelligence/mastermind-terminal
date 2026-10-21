"use client";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";

/** Account outage is separate from a guest gate and never loads a private workspace. */
export default function MemberVerificationUnavailable() {
  const { lang } = useLang();
  const router = useRouter();
  const zh = lang === "zh";
  return <section className="hero" role="status" style={{ margin: "48px auto", padding: 24 }}>
    <h1 style={{ fontSize: 22 }}>{zh ? "账户服务暂不可用" : "Account service unavailable"}</h1>
    <p className="tag">{zh ? "尚未加载私人工作区。请重试账户验证。" : "Your private workspace has not been loaded. Try verifying your account again."}</p>
    <button type="button" className="btn btn-primary" onClick={() => router.refresh()}>{zh ? "重试账户验证" : "Retry account verification"}</button>
  </section>;
}
