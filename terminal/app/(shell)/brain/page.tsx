import BrainWorkspace from "@/components/BrainWorkspace";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { workspaceMetadata } from "@/lib/shared-shell/metadata";

export const metadata = workspaceMetadata("Mastermind AI", "Mastermind AI · Terminal");

export default async function BrainPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { symbol } = await searchParams;
  // Only an explicit, unambiguous subject belongs to this conversation.
  return <BrainWorkspace symbol={typeof symbol === "string" ? normalizeAnalysisSymbol(symbol) : null} />;
}
