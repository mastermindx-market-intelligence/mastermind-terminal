"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SHARED_SHELL_MARKETS } from "@/lib/sharedShellNavigation";
import { isWorkspaceMarket, switchWorkspaceMarket, workspaceMarket } from "@/lib/sharedShellMarket";
import { useSharedShellT } from "@/lib/sharedShellCopy";

/** Native select keeps keyboard, touch and focus behavior without another overlay. */
export default function SharedShellMarketSelect() {
  const path = usePathname(), params = useSearchParams(), router = useRouter(), t = useSharedShellT();
  const market = workspaceMarket(path, params.toString());
  return <label className="shared-shell-market-select">
    <span className="shared-shell-page-announcement">{t("shellWorkspaceMarket")}</span>
    <select aria-label={t("shellWorkspaceMarket")} value={market ?? ""} onChange={event => {
      const next = event.target.value;
      if (isWorkspaceMarket(next)) router.push(switchWorkspaceMarket(window.location.href, next));
    }}>
      {!market && <option value="" disabled>{t("shellChooseMarket")}</option>}
      {SHARED_SHELL_MARKETS.map(item => <option key={item.id} value={item.id}>
        {item.code} · {t(item.k, item.label)}
      </option>)}
    </select>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
  </label>;
}
