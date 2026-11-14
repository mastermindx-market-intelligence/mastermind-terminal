import type { Metadata } from "next";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { SHARED_SHELL_LEGACY_ORIGIN } from "@/lib/sharedShellRoutes";
import WtiLivePath from "@/components/workspaces/WtiLivePath";
import { readWtiPath } from "@/lib/wtiPath.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "WTI Live Path · Mastermind", robots: { index: false, follow: false } };

export default async function WtiPage({ searchParams }: { searchParams: Promise<{ rev?: string | string[] }> }) {
  const [read, params] = await Promise.all([readWtiPath(), searchParams]);
  const requested = params.rev === undefined ? null : String(params.rev);
  const explorer = (isSharedShellEnabled(process.env.MMX_SHARED_SHELL) ? "" : SHARED_SHELL_LEGACY_ORIGIN) + "/ontology.html";
  return <WtiLivePath explorer={explorer} key={read.status === "ready" ? read.data.manifest : read.status} read={read} requestedRevision={requested} />;
}
