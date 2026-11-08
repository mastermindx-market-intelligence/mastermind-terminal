import { createHash } from "node:crypto";
import { canonicalJson } from "./workspaceLayout";

/** Node-only SHA-256 helper for contract parity tests and offline tooling.
 * Runtime/client callers import workspaceLayout.ts without pulling node:crypto.
 */
export function envelopeDigest(envelope: unknown): string {
  let encoded: Buffer;
  try {
    encoded = Buffer.from(canonicalJson(envelope), "utf8");
  } catch {
    encoded = Buffer.from("\x00invalid-envelope", "utf8");
  }
  return createHash("sha256").update(encoded).digest("hex");
}
