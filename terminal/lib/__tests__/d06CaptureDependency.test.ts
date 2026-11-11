import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assertCapturedLexProjection } from "./helpers/lexEvidenceProjection";
import { assertD06CapturedFile, assertD06CapturedLexProjection, restoreD06HistoricalSource } from "./helpers/d06CaptureDependency";

const repo = join(__dirname, "../../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const hash = (source: string) => createHash("sha256").update(source, "utf8").digest("hex");
const packet = JSON.parse(read("terminal/lib/__tests__/fixtures/d06CapturedDependencyDelta.json"));
const fixtureDir = join(__dirname, "fixtures/d06CaptureDependency");
const lexPath = "terminal/lib/i18n.tsx";
const chartPath = "terminal/components/ChartPanel.tsx";
const evidence = read("terminal/docs/pr-crops/b-pl-6-batch-1/EVIDENCE.yml");
const lexRaw = evidence.match(/^  terminal\/lib\/i18n\.tsx: "([0-9a-f]{64})"$/m)![1];
// Original published D06 blob 6d540e007f488f8c753ebead9b7dc0c0fbf107f1.
// Protected ChartPanel composition now has a separate, fresh axis capture.
const historicalChart = gunzipSync(readFileSync(join(fixtureDir, "ChartPanel-efafc117.tsx.gz"))).toString("utf8");

describe("exact D06 inverse deltas preserve historical evidence identity", () => {
  it("chains new LEX properties before unchanged strict v1 verification", () => {
    const source = read(lexPath);
    expect(() => assertCapturedLexProjection(source, lexRaw, evidence)).toThrow(/changed outside/);
    expect(() => assertD06CapturedLexProjection(source, lexRaw, evidence)).not.toThrow();
    const restored = restoreD06HistoricalSource(lexPath, source);
    expect(hash(restored)).toBe(packet.entries[lexPath].before_sha256);
    expect(packet.lex_added_properties).toHaveLength(13);
  });

  it.each(["terminal/app/globals.css", chartPath])(
    "restores the exact original raw pin for %s and refuses every extra byte", path => {
      const source = path === chartPath ? historicalChart : read(path);
      const pin = packet.entries[path].before_sha256;
      expect(hash(source)).toBe(packet.entries[path].after_sha256);
      expect(() => assertD06CapturedFile(path, source, pin)).not.toThrow();
      expect(hash(restoreD06HistoricalSource(path, source))).toBe(pin);
      expect(() => assertD06CapturedFile(path, source + "\n", pin)).toThrow(/outside/);
      expect(() => assertD06CapturedFile(path, source, "a".repeat(64))).toThrow(/raw source hash/);
    },
  );

  it("accepts the actual current axis pin without extending the historical ChartPanel inverse", () => {
    const source = read(chartPath);
    const manifest = JSON.parse(read("terminal/docs/pr-crops/options-level-axis-labels/manifest.json"));
    const currentPin = manifest.sourceFiles["components/ChartPanel.tsx"];
    expect(currentPin).toMatch(/^[0-9a-f]{64}$/);
    expect(hash(source)).toBe(currentPin);
    expect(currentPin).not.toBe(packet.entries[chartPath].after_sha256);
    expect(() => restoreD06HistoricalSource(chartPath, source)).toThrow(/outside/);
    expect(() => assertD06CapturedFile(chartPath, source, packet.entries[chartPath].before_sha256)).toThrow(/outside/);
    expect(() => assertD06CapturedFile(chartPath, source, currentPin)).not.toThrow();
    expect(() => assertD06CapturedFile(chartPath, source + "\n", currentPin)).toThrow(/outside/);
    expect(() => assertD06CapturedFile(chartPath, source, "a".repeat(64))).toThrow();
  });

  it.each([
    ["runtime-f11-EVIDENCE.yml", "f1d6d561d5ad594cb31ec3c674a3cf282ace818e8d08c815719c5ae55d468a34"],
    ["runtime-batch2-EVIDENCE.yml", "2184299734cfa1b699780ca5465073d662936a1014c30075d332aebea03c575a"],
  ])("accepts exact fresh source bytes before historical projection for %s", (file, digest) => {
    // Actual failed-run manifests are retained byte-for-byte, including the
    // older F11 projection and Batch 2's absence of a projection.
    const manifest = readFileSync(join(fixtureDir, file), "utf8");
    expect(hash(manifest)).toBe(digest);
    const rawPin = manifest.match(/^  terminal\/lib\/i18n\.tsx: "([0-9a-f]{64})"$/m)![1];
    const source = read(lexPath);
    expect(hash(source)).toBe(rawPin);
    expect(() => assertCapturedLexProjection(restoreD06HistoricalSource(lexPath, source), rawPin, manifest)).toThrow();
    expect(() => assertD06CapturedLexProjection(source, rawPin, manifest)).not.toThrow();
    expect(() => assertD06CapturedLexProjection(source + "\n", rawPin, manifest)).toThrow();
    expect(() => assertD06CapturedLexProjection(source, "a".repeat(64), manifest)).toThrow();
  });

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

  it("validates the path and pin before direct equality and retains LEX provenance", () => {
    const other = "anything";
    expect(() => restoreD06HistoricalSource("terminal/components/Other.tsx", other)).toThrow();
    expect(() => assertD06CapturedFile("terminal/components/Other.tsx", other, hash(other))).toThrow(/No exact/);
    expect(() => assertD06CapturedFile(chartPath, read(chartPath), "invalid")).toThrow(/raw source hash/);
    expect(() => assertD06CapturedFile(lexPath, read(lexPath), hash(read(lexPath)))).toThrow(/provenance/);
    expect(() => assertD06CapturedLexProjection(read(lexPath), "invalid", evidence)).toThrow();
    expect(() => assertD06CapturedLexProjection(read(lexPath), lexRaw, "")).toThrow();
  });
});
