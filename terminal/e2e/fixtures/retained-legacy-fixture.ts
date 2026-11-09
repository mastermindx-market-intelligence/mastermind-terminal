import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// The incumbent fixtures namespace retains historical source inputs, not a
// renderer or product authority. Decode only an exact caller-pinned artifact;
// nothing fetches, regenerates HTML, issues readiness or falls back to current.
export function readRetainedLegacyFixture(file: string, expectedBundleSha256: string) {
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const compressed = readFileSync(file);
  if (!/^[0-9a-f]{64}$/.test(expectedBundleSha256) || hash(compressed) !== expectedBundleSha256) throw Error("Retained fixture digest mismatch");
  const value = JSON.parse(gunzipSync(compressed).toString("utf8"));
  if (value?.schema !== "shared-shell.retained-legacy-fixture.v1" || !value.raw_jinja || !value.html || !value.assets || typeof value.assets !== "object" || Array.isArray(value.assets)) throw Error("Retained fixture shape invalid");
  const text = (entry: { utf8: string; sha256: string; bytes: number }) => {
    if (typeof entry.utf8 !== "string") throw Error("Retained text missing");
    const body = Buffer.from(entry.utf8, "utf8");
    if (body.length !== entry.bytes || hash(body) !== entry.sha256) throw Error("Retained text binding mismatch");
    return body;
  };
  const rawJinja = text(value.raw_jinja), html = text(value.html);
  const assets = new Map<string, Buffer>();
  for (const [name, raw] of Object.entries(value.assets)) {
    const entry = raw as { base64: string; sha256: string; bytes: number };
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(name) || name.includes("..") || typeof entry?.base64 !== "string") throw Error("Retained asset path invalid");
    const body = Buffer.from(entry.base64, "base64");
    if (body.toString("base64") !== entry.base64 || body.length !== entry.bytes || hash(body) !== entry.sha256) throw Error("Retained asset binding mismatch");
    assets.set(name, body);
  }
  if (assets.size === 0 || value.provenance?.raw_jinja_sha256 !== hash(rawJinja)) throw Error("Retained source provenance missing");
  return { rawJinja, html, assets: assets as ReadonlyMap<string, Buffer>, provenance: value.provenance as Record<string, unknown> };
}
