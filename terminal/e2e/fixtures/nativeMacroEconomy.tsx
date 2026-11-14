// Synthetic component specimen under the existing repository browser-test seam.
// It runs the actual Route, Reader, decoder, charts and evidence components.
// Next navigation and verified identity are test boundaries, never release proof.
import React from "react";
import { createRoot } from "react-dom/client";
import MacroEconomyRoute from "../../components/macro-economy/MacroEconomyRoute";
import SharedShellMarketBoundary from "../../components/chrome/shared-shell/SharedShellMarketBoundary";
import { ECONOMIC_WORKSPACES, type EconomicWorkspaceId } from "../../lib/shared-shell/macroEconomyPayload";
import { SUBJECT, usePathname } from "./nativeMacroEconomyMocks";

const options = new URLSearchParams(location.search);
document.documentElement.dataset.mmxSharedShell = "1";
document.documentElement.dataset.lang = options.get("lang") === "zh" ? "zh" : "en";
document.documentElement.dataset.theme = options.get("theme") === "light" ? "light" : "dark";
document.documentElement.dataset.updown = options.get("lang") === "zh" ? "east" : "west";
document.documentElement.style.setProperty("--font-inter", "Arial");
window.history.replaceState({}, "", "/macro_monetary.html?workspaceMarket=us");

function Specimen() {
  const path = usePathname();
  const workspaceId = (Object.keys(ECONOMIC_WORKSPACES) as EconomicWorkspaceId[]).find(id => ECONOMIC_WORKSPACES[id].path === path) ?? null;
  return <SharedShellMarketBoundary><MacroEconomyRoute ownerKey={SUBJECT} workspaceId={workspaceId}/></SharedShellMarketBoundary>;
}
createRoot(document.getElementById("root")!).render(<Specimen/>);
