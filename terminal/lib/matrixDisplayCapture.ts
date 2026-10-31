import "server-only";
import { createHash } from "node:crypto";
import { R2_BASE } from "@/lib/upstreams";
import { isValidRoot } from "@/lib/flowRoot";
import { readMatrixBytes, withinMatrixRead } from "./matrixReadBoundary";

/** Mirrors native SnapshotReference data; identity alone grants no rights. */
export type MatrixSnapshotReference = Readonly<{
  root: string; sha256: string; byte_length: number; session: string | null;
}>;
export type MatrixDisplayCapture = {
  status: "captured_unqualified";
  snapshot: MatrixSnapshotReference;
  matrix: { body: Uint8Array; sha256: string; read_at: string };
  selection: { body: Uint8Array; sha256: string };
};
export type MatrixCaptureOutcome = MatrixDisplayCapture | { status: "unavailable" };
const MAX_BYTES = 16 * 1024 * 1024; // native retention bound
const MAX_SELECTION_BYTES = 2048; // native selection parser bound
const digest = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");

/** Capture the exact retained publisher object on the existing R2 interface.
 * Server supplies the expected reference and exact selection bytes. No head,
 * backend, fixture, cache or stale fallback; no user token is sent to R2.
 * This does not parse selection semantics or grant display: the native helper
 * must reverify all bytes, identity, authentication and source policy.
 * No route or native transport is installed by this source seam.
 */
export async function readMatrixDisplayCapture(
  reference: MatrixSnapshotReference, selection: Uint8Array, signal?: AbortSignal,
): Promise<MatrixCaptureOutcome> {
  try {
    if (!reference || typeof reference.root !== "string" || !isValidRoot(reference.root) ||
        typeof reference.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(reference.sha256) ||
        !Number.isInteger(reference.byte_length) || reference.byte_length < 1 || reference.byte_length > MAX_BYTES ||
        !(selection instanceof Uint8Array) || selection.byteLength < 1 || selection.byteLength > MAX_SELECTION_BYTES ||
        !(reference.session === null || (typeof reference.session === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(reference.session) &&
          new Date(reference.session + "T00:00:00Z").toISOString().slice(0, 10) === reference.session))) {
      return { status: "unavailable" };
    }
    // Capture mutable request inputs before the first await.
    const snapshot = Object.freeze({ ...reference });
    const selected = Uint8Array.from(selection);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancel, 3000);
    try {
      const response = await withinMatrixRead(controller.signal, () => fetch(
        `${R2_BASE}/options_structure/matrix/history/${encodeURIComponent(snapshot.root)}/${snapshot.sha256}.json`,
        { cache: "no-store", redirect: "error", credentials: "omit", signal: controller.signal,
          headers: { "User-Agent": "mastermind-feed/1.0" } },
      ));
      if (response.status !== 200 || response.redirected || response.headers.has("content-encoding") || !response.body) {
        void response.body?.cancel().catch(() => {});
        return { status: "unavailable" };
      }
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) !== snapshot.byte_length)) {
        void response.body.cancel().catch(() => {});
        return { status: "unavailable" };
      }
      const body = await readMatrixBytes(response.body, controller.signal, snapshot.byte_length, true);
      if (digest(body) !== snapshot.sha256) return { status: "unavailable" };
      return { status: "captured_unqualified", snapshot,
        matrix: { body, sha256: snapshot.sha256, read_at: new Date().toISOString() },
        selection: { body: selected, sha256: digest(selected) } };
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); controller.abort(); }
  } catch { return { status: "unavailable" }; }
}
