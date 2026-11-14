// Synthetic browser specimen; no production route, identity, or admission bypass.
import React from "react";
import { createRoot } from "react-dom/client";
import SharedShellMarketBoundary from "../../components/chrome/shared-shell/SharedShellMarketBoundary";
import MacroEconomyRoute from "../../components/macro-economy/MacroEconomyRoute";
import { ECONOMIC_WORKSPACES, type EconomicWorkspaceId } from "../../lib/shared-shell/macroEconomyPayload";
import { usePathname } from "next/navigation";

function Specimen() {
  const path = usePathname();
  const workspaceId = (Object.keys(ECONOMIC_WORKSPACES) as EconomicWorkspaceId[]).find(id => ECONOMIC_WORKSPACES[id].path === path) ?? null;
  return <div className="app2 shared-shell"><SharedShellMarketBoundary><MacroEconomyRoute ownerKey="11111111-1111-4111-8111-111111111111" workspaceId={workspaceId}/></SharedShellMarketBoundary></div>;
}
document.documentElement.dataset.mmxSharedShell = "1";
document.documentElement.dataset.updown = document.documentElement.lang === "zh" ? "east" : "west";
document.documentElement.style.setProperty("--font-inter", "Arial");
createRoot(document.getElementById("root")!).render(<Specimen/>);

