"use client";

import { useLang, type Lang } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";

/** Local bilingual copy avoids changing the globally evidence-locked shell LEX. */
function pick(lang: Lang, en: string, zh: string): string {
  return lang === "zh" ? zh : en;
}

/** An entitlement-provider outage is not a subscription downgrade. No data or
 * workspace is rendered on uncertainty; users can retry without a billing flow. */
export default function OptionsServiceUnavailable() {
  const { lang } = useLang();
  return (
    <main className="center" role="status" data-options-access="temporarily-unavailable">
      <div className="hero">
        <div className="mk"><BrandMark size={48} /></div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>
          {pick(lang, "Options is temporarily unavailable", "期权服务暂时不可用")}
        </h1>
        <p className="tag" style={{ marginBottom: 20 }}>
          {pick(lang, "We couldn't verify Options access right now. This does not mean your subscription changed. Please retry.", "暂时无法验证访问权限。您的订阅状态尚未改变，请稍后重试。")}
        </p>
        <div className="cta">
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            {pick(lang, "Try again", "重试")}
          </button>
          <a className="btn btn-ghost" href="/terminal">{pick(lang, "Go to chart", "返回图表")}</a>
        </div>
      </div>
    </main>
  );
}
