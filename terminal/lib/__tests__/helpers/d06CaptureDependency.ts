import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertCapturedLexProjection } from "./lexEvidenceProjection";

type Delta = {
  before_sha256: string;
  after_sha256: string;
  hunks: { before_text: string; after_text: string }[];
};
type Packet = {
  schema: string;
  historical_base_commit: string;
  d06_source_commit: string;
  entries: Record<string, Delta>;
};
const packet = JSON.parse(readFileSync(join(__dirname, "../fixtures/d06CapturedDependencyDelta.json"), "utf8")) as Packet;
const LEX_PATH = "terminal/lib/i18n.tsx";
const paths = [LEX_PATH, "terminal/app/globals.css", "terminal/components/ChartPanel.tsx"];
const hash = (source: string) => createHash("sha256").update(source, "utf8").digest("hex");
if (packet.schema !== "terminal.d06_capture_dependency_delta.v1" ||
    !/^[0-9a-f]{40}$/.test(packet.historical_base_commit) ||
    !/^[0-9a-f]{40}$/.test(packet.d06_source_commit) ||
    Object.keys(packet.entries).sort().join("\n") !== [...paths].sort().join("\n")) {
  throw new Error("Invalid D06 historical dependency packet");
}

/**
 * Explicit inverse delta, not a formatting normalizer or current-hash waiver.
 * Historical crops/raw pins remain untouched. New behavior has separate D06
 * and CI-repair proof; after hashes bind the current bytes. Every context hunk
 * must match exactly once.
 */
export function restoreD06HistoricalSource(path: string, current: string): string {
  const entry = packet.entries[path];
  if (!entry || !/^[0-9a-f]{64}$/.test(entry.before_sha256) ||
      !/^[0-9a-f]{64}$/.test(entry.after_sha256) || !entry.hunks.length) {
    throw new Error("No exact D06 dependency delta for this path");
  }
  if (hash(current) === entry.before_sha256) return current;
  if (path !== LEX_PATH && hash(current) !== entry.after_sha256) {
    throw new Error("Source changed outside the exact recorded D06 dependency delta");
  }
  const matches = entry.hunks.map(h => {
    if (!h.after_text || h.after_text === h.before_text) throw new Error("Invalid D06 inverse hunk");
    return current.split(h.after_text).length - 1;
  });
  // Old LEX, including v1's permitted onboarding tuple change, still uses v1.
  if (path === LEX_PATH && matches.every(n => n === 0)) return current;
  if (matches.some(n => n !== 1)) throw new Error("Incomplete or duplicated D06 dependency delta");
  let restored = current;
  for (const hunk of [...entry.hunks].reverse()) {
    if (restored.split(hunk.after_text).length !== 2) throw new Error("D06 context hunk no longer unique");
    restored = restored.replace(hunk.after_text, hunk.before_text);
  }
  if (path !== LEX_PATH && hash(restored) !== entry.before_sha256) {
    throw new Error("D06 inverse delta did not restore the historical source bytes");
  }
  return restored;
}

/** Chain to unchanged v1 semantics; never expand its omitted-property contract. */
export function assertD06CapturedLexProjection(current: string, rawPin: string, manifest: string): void {
  assertCapturedLexProjection(restoreD06HistoricalSource(LEX_PATH, current), rawPin, manifest);
}

export function assertD06CapturedFile(path: string, current: string, rawPin: string): void {
  if (path === LEX_PATH) throw new Error("LEX requires its original v1 provenance binding");
  if (!/^[0-9a-f]{64}$/.test(rawPin) || hash(restoreD06HistoricalSource(path, current)) !== rawPin) {
    throw new Error("Recorded historical raw source hash does not match");
  }
}
