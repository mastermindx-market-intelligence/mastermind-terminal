import { notFound } from "next/navigation";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { isLegacyShellPath, shellPageLabel } from "@/lib/sharedShellRoutes";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type Props = { params: Promise<{ legacyPath: string[] }> };

async function admittedPath(params: Props["params"]): Promise<string> {
  const { legacyPath } = await params;
  const path = "/" + legacyPath.join("/");
  if (!isSharedShellEnabled(process.env.MMX_SHARED_SHELL) || !isLegacyShellPath(path)) notFound();
  return path;
}
export async function generateMetadata({ params }: Props) {
  const path = await admittedPath(params);
  return { title: shellPageLabel(path, "en") + " · Mastermind", robots: { index: false, follow: false } };
}
export default async function LegacyShellPage({ params }: Props) {
  await admittedPath(params);
  // The persistent route-group AppShell owns the one legacy browsing context.
  return null;
}
