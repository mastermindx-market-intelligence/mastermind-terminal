import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAdminRequest } from "@/lib/adminGate";
import FactorHistoryShellPreview, { FactorAtlasGateUnavailable } from "@/components/factor-atlas/FactorHistoryShellPreview";
import nativeFixture from "@/lib/__tests__/fixtures/factorAtlasNativeSynthetic.json";

/** Local, development-only shell integration test surface.
 * No published customer route, admitted feed, source rights, or investor-facing data.
 * The build always returns 404 for this route in production, even for an admin.
 * Dev-only positive authorization uses the incumbent admin gate, not caller flags.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Factor Atlas synthetic preview · Mastermind Terminal" };

export default async function FactorAtlasSyntheticPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const verdict = await isAdminRequest();
  if (verdict.status === "anonymous") redirect("/login");
  if (verdict.status === "denied") notFound();
  if (verdict.status === "unavailable") {
    return <FactorAtlasGateUnavailable />;
  }
  return <FactorHistoryShellPreview items={[
    { basketId: "mag7", label: ["Synthetic round trip", "合成往返示例"], payload: nativeFixture },
  ]} />;
}
