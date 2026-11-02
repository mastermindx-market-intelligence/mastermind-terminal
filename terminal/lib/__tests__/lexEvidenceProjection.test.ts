import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCapturedLexProjection, fingerprintCapturedLex, projectCapturedLex } from "./helpers/lexEvidenceProjection";

const hash = (source: string) => createHash("sha256").update(source).digest("hex");
const captured = `// obDonePrefsSyncing: ["a comment", "注释"]
export const LEX: Record<string, [string, string]> = {
  searchTitle: ["Symbol search", "代码搜索"],
  obDonePrefsSyncing: ["Old pending copy", "原提示"],
  literalExample: ["obDonePrefsSyncing", "名称"],
};
const other = { obDonePrefsSyncing: ["outside", "外部"] };
`;
const current = captured.replace('["Old pending copy", "原提示"]', '["Unsynced; retry in Settings", "尚未同步；在设置中重试"]');
const rawHash = hash(captured);
function manifest(projectedSha256 = fingerprintCapturedLex(captured, rawHash)): string {
  return "lexProjection: " + JSON.stringify({ schema: "terminal.lex_capture_projection.v1", omittedProperty: "obDonePrefsSyncing",
    capturedRawSha256: rawHash, projectedSha256, sourceGitBlob: "a".repeat(40), sourceRecoveryCommit: "b".repeat(40), captureCommitLocallyAvailable: true });
}

describe("recorded LEX capture dependency projection", () => {
  it("accepts only the excluded tuple delta while preserving the original raw source hash", () => {
    expect(hash(current)).not.toBe(rawHash);
    expect(projectCapturedLex(current)).toBe(projectCapturedLex(captured));
    expect(() => assertCapturedLexProjection(current, rawHash, manifest())).not.toThrow();
    expect(() => fingerprintCapturedLex(current, rawHash)).toThrow(/raw source hash/);
  });

  it("rejects another consumed key, comments, whitespace, and code outside that direct property", () => {
    for (const changed of [current.replace("Symbol search", "Different search"), current.replace("// obDone", "// changed obDone"),
      current.replace("  searchTitle", " searchTitle"), current.replace('["outside", "外部"]', '["changed", "改动"]')]) {
      expect(() => assertCapturedLexProjection(changed, rawHash, manifest())).toThrow(/changed outside/);
    }
  });

  it("ignores no target-looking comment, string, or nested/non-exported object", () => {
    const projected = projectCapturedLex(captured);
    expect(projected).toContain('// obDonePrefsSyncing: ["a comment", "注释"]');
    expect(projected).toContain('literalExample: ["obDonePrefsSyncing", "名称"]');
    expect(projected).toContain('const other = { obDonePrefsSyncing: ["outside", "外部"] }');
  });

  it("refuses missing, duplicate, computed, shorthand, spread, malformed, or invalid syntax", () => {
    for (const source of [captured.replace("  obDonePrefsSyncing:", "  renamed:"),
      captured.replace("  searchTitle:", '  obDonePrefsSyncing: ["duplicate", "重复"], searchTitle:'),
      captured.replace("  obDonePrefsSyncing:", '  ["obDonePrefsSyncing"]:'),
      captured.replace('obDonePrefsSyncing: ["Old pending copy", "原提示"]', "obDonePrefsSyncing"),
      captured.replace("  searchTitle:", "  ...additional, searchTitle:"),
      captured.replace('["Old pending copy", "原提示"]', '["one"]'),
      captured.replace('["Old pending copy", "原提示"]', '[computed(), "原提示"]'),
      captured.replace("export const LEX", "const LEX"), captured + "export const LEX = {};", captured + "}"]) {
      expect(() => projectCapturedLex(source)).toThrow();
    }
  });

  it("refuses missing/duplicate projection metadata or provenance differing from the original raw pin", () => {
    expect(() => assertCapturedLexProjection(current, rawHash, "")).toThrow();
    expect(() => assertCapturedLexProjection(current, rawHash, manifest() + "\n" + manifest())).toThrow();
    expect(() => assertCapturedLexProjection(current, "c".repeat(64), manifest())).toThrow(/provenance/);
    expect(() => assertCapturedLexProjection(current, rawHash, manifest().replace("obDonePrefsSyncing", "searchTitle"))).toThrow(/provenance/);
  });

  it("rejects a real SearchModal-consumed key mutation in the actual shared LEX", () => {
    const source = readFileSync(join(__dirname, "../i18n.tsx"), "utf8");
    const packet = readFileSync(join(__dirname, "../../docs/pr-crops/b-pl-6-batch-1/EVIDENCE.yml"), "utf8");
    const expected = packet.match(/^  terminal\/lib\/i18n\.tsx: "([0-9a-f]{64})"$/m)![1];
    expect(readFileSync(join(__dirname, "../../components/SearchModal.tsx"), "utf8")).toContain('"searchTitle"');
    const changed = source.replace('searchTitle: ["Symbol search",', 'searchTitle: ["Mutation must fail",');
    expect(changed).not.toBe(source);
    expect(() => assertCapturedLexProjection(source, expected, packet)).not.toThrow();
    expect(() => assertCapturedLexProjection(changed, expected, packet)).toThrow(/changed outside/);
  });
});
