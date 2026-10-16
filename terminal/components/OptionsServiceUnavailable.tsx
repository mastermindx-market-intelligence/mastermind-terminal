"use client";

import { useT } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";

/** An entitlement-provider outage is not a subscription downgrade. No data or
 * workspace is rendered on uncertainty; users can retry without a billing flow. */
export default function OptionsServiceUnavailable() {
  const t = useT();
  return (
    <main className="center" role="status" data-options-access="temporarily-unavailable">
      <div className="hero">
        <div className="mk"><BrandMark size={48} /></div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>
          {t("optionsAccessUnavailableTitle")}
        </h1>
        <p className="tag" style={{ marginBottom: 20 }}>
          {t("optionsAccessUnavailableBody")}
        </p>
        <div className="cta">
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            {t("optionsAccessUnavailableRetry")}
          </button>
          <a className="btn btn-ghost" href="/terminal">{t("optionsAccessUnavailableBack")}</a>
        </div>
      </div>
    </main>
  );
}
