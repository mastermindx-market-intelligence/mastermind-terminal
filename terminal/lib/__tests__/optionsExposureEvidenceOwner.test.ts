import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, lstatSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { qualifiedOptionsExposurePacket } from "./helpers/optionsExposureEvidence";

const REPO = join(__dirname, "../../..");
const owner = createRequire(import.meta.url)("../../e2e/tools/capture_ci_evidence.cjs") as {
  EOD_CROPS: string[];
  eodPacket(repo: string): {
    selection?: string; path: string; sha256: string; descriptorSha256?: string;
    captureRevision?: string; capturedAtHead: string | null;
    layoutFiles: Record<string, string>; sourceFiles?: Record<string, string>;
    plan: { required: boolean; changed: string[] };
  };
};
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function shadowRepo(overrides: Record<string, Buffer | string>, sourceRoot = REPO): string {
  const root = mkdtempSync(join(tmpdir(), "eod-qualified-consumer-"));
  roots.push(root);
  const keys = Object.keys(overrides);
  function mirror(folder: string): void {
    mkdirSync(join(root, folder), { recursive: true });
    for (const name of readdirSync(join(sourceRoot, folder))) {
      const file = folder ? folder + "/" + name : name;
      const source = join(sourceRoot, file), target = join(root, file);
      if (Object.hasOwn(overrides, file)) writeFileSync(target, overrides[file]);
      else if (keys.some(key => key.startsWith(file + "/"))) mirror(file);
      else symlinkSync(source, target);
    }
  }
  mirror("");
  return root;
}


describe("shadow evidence repositories", () => {
  it("mirrors dangling entries while preserving source alias semantics", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "eod-shadow-source-"));
    roots.push(sourceRoot);
    mkdirSync(join(sourceRoot, "data"));
    writeFileSync(join(sourceRoot, "data/value.txt"), "original");
    symlinkSync("missing-target", join(sourceRoot, "macro-site-link"), "file");
    symlinkSync("data", join(sourceRoot, "directory-alias"), "dir");
    symlinkSync(join("data", "value.txt"), join(sourceRoot, "file-alias"), "file");

    const shadow = shadowRepo({ "data/value.txt": "isolated" }, sourceRoot);
    const dangling = join(shadow, "macro-site-link");
    expect(lstatSync(dangling).isSymbolicLink()).toBe(true);
    expect(() => readFileSync(dangling)).toThrow(/ENOENT/);
    expect(readFileSync(join(shadow, "directory-alias/value.txt"), "utf8")).toBe("original");
    expect(readFileSync(join(shadow, "file-alias"), "utf8")).toBe("original");
    expect(readFileSync(join(shadow, "data/value.txt"), "utf8")).toBe("isolated");
    expect(readFileSync(join(sourceRoot, "data/value.txt"), "utf8")).toBe("original");
  });
});


describe("current EOD owner and native reader", () => {
  it("selects the same qualified manifest and preserves its actual capture identity", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const packet = owner.eodPacket(REPO);
    expect(packet.selection).toBe("qualified");
    expect(packet.path).toBe(relative(REPO, selected.evidence));
    expect(packet.sha256).toBe(selected.native.native_manifest_sha256);
    expect(packet.layoutFiles).toEqual(Object.fromEntries(selected.layout.map(file => [file, selected.sources[file]])));
    expect(packet.sourceFiles).toEqual(selected.sources);
    expect(packet.plan).toEqual({ required: false, changed: [] });
    expect(packet.capturedAtHead).toBe("282ea2c40d839fecbe5ae5dc53de9c29a02850f6");
  });

  for (const file of ["terminal/components/flowdesk/FlowFreshnessReceipt.tsx", "terminal/components/flowdesk/InspectorPane.tsx"]) {
    it("refuses reuse after mounted desk source drift: " + file, () => {
      const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8") + "\n// isolated source drift\n" });
      expect(() => owner.eodPacket(root)).toThrow(/NO_QUALIFIED_CAPTURE/);
    });
  }

  it("refuses a corrupted selected image through the actual owner", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const file = relative(REPO, join(selected.cropDir, "chainheat-retried-390.png"));
    const bytes = Buffer.from(readFileSync(join(REPO, file)));
    bytes[bytes.length - 1] ^= 1;
    const root = shadowRepo({ [file]: bytes });
    expect(() => owner.eodPacket(root)).toThrow(/INTEGRATION_NATIVE_IMAGE/);
  });

  it("refuses a changed descriptor rather than recapturing over history", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const file = relative(REPO, join(dirname(dirname(selected.evidence)), "native-packet.json"));
    const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8") + "\n" });
    expect(() => owner.eodPacket(root)).toThrow(/INTEGRATION_PACKET_DIGEST/);
  });

  it("refuses a removed declaration even when the historical root remains a valid raw manifest", () => {
    const file = "terminal/docs/pr-crops/eod-heatmap-flowdesk-load-failure/EVIDENCE.yml";
    const text = readFileSync(join(REPO, file), "utf8");
    const root = shadowRepo({ [file]: text.slice(text.indexOf("\n\n") + 2) });
    expect(() => owner.eodPacket(root)).toThrow(/MISSING_PACKET_DECLARATION/);
  });
});
