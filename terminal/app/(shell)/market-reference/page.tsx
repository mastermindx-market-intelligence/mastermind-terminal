import { workspaceMetadata } from "@/lib/shared-shell/metadata";
import MarketReference from "./MarketReference";

export const metadata = workspaceMetadata("Market Reference");

export default function MarketReferencePage() {
  return <MarketReference />;
}
