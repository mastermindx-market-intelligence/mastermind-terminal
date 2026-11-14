import { workspaceMetadata } from "@/lib/shared-shell/metadata";
import { readEditorialReports } from "@/lib/shared-shell/editorialReportsServer";
import EditorialArchive from "./EditorialArchive";

export const dynamic = "force-dynamic";
export const metadata = workspaceMetadata("Research Reports");

export default async function EditorialReportsPage() {
  return <EditorialArchive reports={await readEditorialReports()} />;
}
