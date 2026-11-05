import "server-only";
import { BILLING_BASE, billingAuthResult } from "@/app/api/billing/gateway";
import { rateLimit } from "@/lib/rateLimit";
import { isValidRoot } from "@/lib/flowRoot";
import { readMatrixDisplayCapture, type MatrixSnapshotReference } from "./matrixDisplayCapture";
import { readMatrixBytes, withinMatrixRead } from "./matrixReadBoundary";

export const MATRIX_DISPLAY_DEADLINE_MS = 10_000;
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", "X-Content-Type-Options": "nosniff" };
const fail = (status = 503) => Response.json({ error: "matrix_display_unavailable" }, { status, headers: HEADERS });
function authorityOrigin(): string | null {
  try {
    const url = new URL(BILLING_BASE);
    // This token is valid only for the incumbent legitimate private Macro origin.
    // FLOW_BACKEND, R2, browser origin/path and arbitrary env hosts cannot receive it.
    return url.origin === "https://www.mastermind-x.com" && url.pathname === "/" &&
      !url.username && !url.password && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}
function selector(params: URLSearchParams): MatrixSnapshotReference | null {
  const keys = ["f", "matrix_delivery", "version_ref", "fingerprint"];
  if ([...params.keys()].some(k => !keys.includes(k)) || keys.some(k => params.getAll(k).length !== 1) ||
      params.get("matrix_delivery") !== "exact-v1") return null;
  const f = params.get("f")!;
  if (!f.startsWith("matrix:") || !isValidRoot(f.slice(7))) return null;
  const version = params.get("version_ref")!;
  if (version.length > 256) return null;
  const match = /^sha256:([0-9a-f]{64}):bytes:([1-9][0-9]*):session:(unknown|[0-9]{4}-[0-9]{2}-[0-9]{2})$/.exec(version);
  if (!match || match[1] !== params.get("fingerprint")) return null;
  const length = Number(match[2]);
  if (!Number.isSafeInteger(length) || length > 16 * 1024 * 1024) return null;
  const session = match[3] === "unknown" ? null : match[3];
  if (session !== null) {
    const date = new Date(session + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== session) return null;
  }
  return { root: f.slice(7), sha256: match[1], byte_length: length, session };
}

/** Exact selection POST; Macro reads its own retained artifact and source config.
 * The R2 capture is an identity comparison, never a substitute for native rights.
 * No browser vendor/policy/identity/runtime fields or alternate authority origin.
 */
export async function handleMatrixDisplayRequest(request: Request): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(cancel, MATRIX_DISPLAY_DEADLINE_MS);
  try {
    const limited = rateLimit(request, { name: "matrix-display" });
    if (!limited.ok) return fail(429);
    const origin = authorityOrigin();
    if (!origin) return fail();
    if (request.method !== "POST") return fail(405);
    const params = new URL(request.url).searchParams;
    const ref = selector(params);
    if (!ref) return fail(400);
    if (request.headers.get("content-type") !== "application/octet-stream" || request.headers.has("content-encoding")) return fail(415);
    const declared = request.headers.get("content-length");
    if (declared !== null && (!/^[0-9]{1,10}$/.test(declared) || Number(declared) < 1 || Number(declared) > 2048)) return fail(400);
    // Authenticate the actual session before any artifact/network capture.
    const auth = await withinMatrixRead(controller.signal, billingAuthResult);
    if (auth.status === "denied") return fail(401);
    if (auth.status !== "ok" || !auth.token) return fail();
    if (!request.body) return fail(400);
    const selection = await readMatrixBytes(request.body, controller.signal, 2048);
    if (declared !== null && selection.byteLength !== Number(declared)) return fail(400);
    const capture = await withinMatrixRead(controller.signal,
      () => readMatrixDisplayCapture(ref, selection, controller.signal));
    if (capture.status !== "captured_unqualified") return fail();
    // Only ref + exact selection cross the private authority transport. The
    // native runtime independently captures the retained Matrix and identity.
    const query = new URLSearchParams({ version_ref: params.get("version_ref")!, fingerprint: ref.sha256 });
    const response = await withinMatrixRead(controller.signal, () => fetch(
      `${origin}/api/options/matrix/display/${encodeURIComponent(ref.root)}?${query}`,
      { method: "POST", cache: "no-store", redirect: "error", credentials: "omit", signal: controller.signal,
        headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json", "Accept-Encoding": "identity", "Content-Type": "application/octet-stream" },
        body: selection as BodyInit },
    ));
    if (response.status !== 200 || response.redirected || !response.body || response.headers.has("content-encoding") ||
        response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {});
      return fail();
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^[0-9]{1,10}$/.test(length) || Number(length) !== ref.byte_length)) {
      void response.body.cancel().catch(() => {}); return fail();
    }
    const body = await readMatrixBytes(response.body, controller.signal, ref.byte_length, true);
    if (body.some((byte, i) => byte !== capture.matrix.body[i])) return fail();
    return new Response(body as BodyInit, { headers: { ...HEADERS, "Content-Type": "application/json" } });
  } catch { return fail(); }
  finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel); controller.abort();
  }
}
