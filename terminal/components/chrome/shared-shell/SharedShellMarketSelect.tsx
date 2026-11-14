"use client";
import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SHARED_SHELL_MARKETS } from "@/lib/sharedShellNavigation";
import { isWorkspaceMarket, switchWorkspaceMarket, workspaceMarket } from "@/lib/sharedShellMarket";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { useLang } from "@/lib/i18n";

/** Native select keeps keyboard, touch and focus behavior without another overlay. */
export default function SharedShellMarketSelect() {
  const path = usePathname(), params = useSearchParams(), router = useRouter(), t = useSharedShellT();
  const { lang } = useLang(), descriptionId = useId();
  const market = workspaceMarket(path, params.toString());
  const description = path === "/portfolio" ? (lang === "zh"
    ? "研究市场。投资组合保留全部持仓及其已记录币种。"
    : "Research market. Your portfolio keeps all holdings and their recorded currencies.") : undefined;
  return <label className="shared-shell-market-select">
    <span className="shared-shell-page-announcement">{t("shellWorkspaceMarket")}</span>
    {description && <span id={descriptionId} className="shared-shell-page-announcement">{description}</span>}
    <select aria-label={t("shellWorkspaceMarket")} aria-describedby={description ? descriptionId : undefined} title={description} value={market ?? ""} onChange={event => {
      const next = event.target.value;
      if (!isWorkspaceMarket(next)) return;
      const current = new URL(window.location.href);
      if (current.pathname === "/portfolio" && workspaceMarket(current.pathname, current.search) === next) return;
      const href = switchWorkspaceMarket(current.href, next), destination = new URL(href, current);
      if (current.href === destination.href) return;
      if (current.pathname === "/portfolio" && destination.pathname === "/portfolio") {
        // Context is URL-owned; it must not reseed the account-owned book.
        // Next copies its internal tree for this external History API call.
        window.history.pushState({}, "", href);
        window.dispatchEvent(new Event("mmx:shell-location"));
      } else router.push(href);
    }}>
      {!market && <option value="" disabled>{t("shellChooseMarket")}</option>}
      {SHARED_SHELL_MARKETS.map(item => <option key={item.id} value={item.id}>
        {item.code} · {t(item.k, item.label)}
      </option>)}
    </select>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
  </label>;
}
