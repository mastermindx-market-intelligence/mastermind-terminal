"use client";

import dynamic from "next/dynamic";
import SharedShellMarketBoundary from "@/components/chrome/shared-shell/SharedShellMarketBoundary";
import WorkspaceLoading from "@/components/WorkspaceLoading";
import type { EconomicWorkspaceId } from "@/lib/shared-shell/macroEconomyPayload";

const MacroEconomyRoute = dynamic(() => import("@/components/macro-economy/MacroEconomyRoute"), { loading: () => <WorkspaceLoading/> });

export default function MacroEconomyMount({ ownerKey, workspaceId }: { ownerKey: string; workspaceId: EconomicWorkspaceId | null }) {
  return <SharedShellMarketBoundary><MacroEconomyRoute key={ownerKey} ownerKey={ownerKey} workspaceId={workspaceId}/></SharedShellMarketBoundary>;
}
