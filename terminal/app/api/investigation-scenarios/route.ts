import { handleSavedScenarioResolution } from "@/lib/investigationScenarioResolutionServer";
import { requestNativeScenario } from "@/lib/scenarioNative";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request): Promise<Response> {
  return handleSavedScenarioResolution(request, requestNativeScenario);
}
