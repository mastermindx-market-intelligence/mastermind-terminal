"use client";

import { useLang } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";

/** An entitlement-provider outage is not a subscription downgrade. No data or
 * workspace is rendered on uncertainty; users can retry without a billing flow. */
export default function OptionsServiceUnavailable() {
  const { lang } = useLang();
  const zh = lang === "zh";
  return (
    <main className="center" role="status" data-options-access="temporarily-unavailable">
      <div className="hero">
        <div className="mk"><BrandMark size={48} /></div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>
          {zh ? "期权服务暂时不可用" : "Options is temporarily unavailable"}
        </h1>
        <p className="tag" style={{ marginBottom: 20 }}>
          {zh
            ? "暂时无法验证访问权限。您的订阅状态尚未改变，请稍后重试。"
            : "We couldn't verify Options access right now. This does not mean your subscription changed. Please retry."}
        </p>
        <div className="cta">
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            {zh ? "重试" : "Try again"}
          </button>
          <a className="btn btn-ghost" href="/terminal">{zh ? "返回图表" : "Go to chart"}</a>
        </div>
      </div>
    </main>
  );
}
