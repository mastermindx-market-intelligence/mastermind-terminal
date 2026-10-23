"use client";

import { BrandMark } from "@/components/BrandMark";
import { macroReturnWorkspace } from "@/lib/originNav";
import { useT, useLang } from "@/lib/i18n";

export default function DashboardBackButton({
  onClick,
  variant = "desktop",
  returnHref,
}: {
  onClick?: () => void;
  variant?: "desktop" | "mobile";
  returnHref?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const workspace = macroReturnWorkspace(returnHref);
  const names = { analysis: ["Analysis", "分析"], discover: ["Discover", "发现"], portfolio: ["Portfolio", "投资组合"], monitor: ["Monitor", "监控"], research: ["Research", "研究"], today: ["Today", "今日"] };
  const destination = workspace ? names[workspace][lang === "zh" ? 1 : 0] : t("dashboard");
  const label = workspace ? (lang === "zh" ? `返回${destination}` : `Back to ${destination}`) : t("backToDashboard");

  if (variant === "mobile") {
    return (
      <button className="m-back-prom breathe" onClick={onClick} title={label} aria-label={label}>
        <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>
        <span>{destination}</span>
      </button>
    );
  }

  return (
    <button className="brand-back" onClick={onClick} title={label} aria-label={label}>
      <span className="bb-chev"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></span>
      <BrandMark />
      <span className="wm"><b>MASTERMIND</b><small>&larr; {destination}</small></span>
    </button>
  );
}
