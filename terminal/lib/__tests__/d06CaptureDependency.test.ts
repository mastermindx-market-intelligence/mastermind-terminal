import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCapturedLexProjection } from "./helpers/lexEvidenceProjection";
import { assertD06CapturedFile, assertD06CapturedLexProjection, restoreD06HistoricalSource } from "./helpers/d06CaptureDependency";

const repo = join(__dirname, "../../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const hash = (source: string) => createHash("sha256").update(source, "utf8").digest("hex");
const packet = JSON.parse(read("terminal/lib/__tests__/fixtures/d06CapturedDependencyDelta.json"));
const lexPath = "terminal/lib/i18n.tsx";
const evidence = read("terminal/docs/pr-crops/b-pl-6-batch-1/EVIDENCE.yml");
const lexRaw = evidence.match(/^  terminal\/lib\/i18n\.tsx: "([0-9a-f]{64})"$/m)![1];

describe("exact D06 inverse deltas preserve historical evidence identity", () => {
  it("chains new LEX properties before unchanged strict v1 verification", () => {
    const source = read(lexPath);
    expect(() => assertCapturedLexProjection(source, lexRaw, evidence)).toThrow(/changed outside/);
    expect(() => assertD06CapturedLexProjection(source, lexRaw, evidence)).not.toThrow();
    const restored = restoreD06HistoricalSource(lexPath, source);
    expect(hash(restored)).toBe(packet.entries[lexPath].before_sha256);
    expect(packet.lex_added_properties).toHaveLength(13);
  });

  it.each(["terminal/app/globals.css", "terminal/components/ChartPanel.tsx"])(
    "restores the exact original raw pin for %s and refuses every extra byte", path => {
      const source = read(path), pin = packet.entries[path].before_sha256;
      expect(() => assertD06CapturedFile(path, source, pin)).not.toThrow();
      expect(hash(restoreD06HistoricalSource(path, source))).toBe(pin);
      expect(() => assertD06CapturedFile(path, source + "\n", pin)).toThrow(/outside/);
      expect(() => assertD06CapturedFile(path, source, "a".repeat(64))).toThrow(/raw source hash/);
    },
  );

  it("rejects a changed new translation, partial delta, duplicate context and unrelated LEX change", () => {
    const source = read(lexPath);
    const hunks = packet.entries[lexPath].hunks as { before_text: string; after_text: string }[];
    const changedNew = source.replace("xStaticImage:", "xStaticImageMutated:");
    const partial = source.replace(hunks[0].after_text, hunks[0].before_text);
    const duplicate = source + hunks[0].after_text;
    const changedCore = source.replace('searchTitle: ["Symbol search",', 'searchTitle: ["Wrong search",');
    for (const changed of [changedNew, partial, duplicate, changedCore, source + "\n"]) {
      expect(changed).not.toBe(source);
      expect(() => assertD06CapturedLexProjection(changed, lexRaw, evidence)).toThrow();
    }
  });

  it("retains the prior v1-only onboarding tuple exception after reversing D06", () => {
    const source = read(lexPath);
    const changed = source.replace(/(obDonePrefsSyncing:\s*\[\s*)"[^"]*"/, '$1"Changed pending preferences only"');
    expect(changed).not.toBe(source);
    expect(() => assertD06CapturedLexProjection(changed, lexRaw, evidence)).not.toThrow();
  });

  it("does not grant a generic source-file exemption or replace LEX provenance", () => {
    expect(() => restoreD06HistoricalSource("terminal/components/Other.tsx", "anything")).toThrow();
    expect(() => assertD06CapturedFile(lexPath, read(lexPath), lexRaw)).toThrow(/provenance/);
    expect(() => assertD06CapturedLexProjection(read(lexPath), lexRaw, "")).toThrow();
  });
});
