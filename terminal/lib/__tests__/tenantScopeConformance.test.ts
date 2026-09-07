import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decideTenantScope,
  renderConformanceMarkdown,
  TENANT_SCOPE_CONFORMANCE,
  TENANT_SCOPE_REASONS,
} from "@/lib/tenantScope";

describe("tenant scope conformance table", () => {
  it("decides every case as the table says", () => {
    for (const c of TENANT_SCOPE_CONFORMANCE) {
      const decision = decideTenantScope(c.identity, c.memberships, c.resource, c.grants);
      expect(decision.allow, `case ${c.id}: allow`).toBe(c.expect.allow);
      expect(decision.reason, `case ${c.id}: reason`).toBe(c.expect.reason);
    }
  });

  it("covers every reason at least once", () => {
    const covered = new Set(TENANT_SCOPE_CONFORMANCE.map((c) => c.expect.reason));
    for (const reason of TENANT_SCOPE_REASONS) {
      expect(covered.has(reason), `reason ${reason} is untested`).toBe(true);
    }
  });

  it("has unique, kebab-case case ids", () => {
    const ids = TENANT_SCOPE_CONFORMANCE.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("includes the six required enumerations", () => {
    const ids = new Set(TENANT_SCOPE_CONFORMANCE.map((c) => c.id));
    for (const required of [
      "owner-reads-own-row",
      "member-reads-team-row",
      "non-member-denied",
      "different-team-denied",
      "explicit-grant-single-row",
      "revoked-membership-denied",
    ]) {
      expect(ids.has(required), `missing required case ${required}`).toBe(true);
    }
  });

  it("is byte-identical to the doc's conformance table", () => {
    const doc = readFileSync(
      new URL("../../../docs/F12_TENANT_SCOPE_CONTRACT_2026-09-06.md", import.meta.url),
      "utf8",
    );
    const beginMarker = "<!-- BEGIN:tenant-scope-conformance";
    const endMarker = "<!-- END:tenant-scope-conformance -->";
    const beginIdx = doc.indexOf(beginMarker);
    const endIdx = doc.indexOf(endMarker);
    expect(beginIdx, "BEGIN sentinel not found in doc").toBeGreaterThan(-1);
    expect(endIdx, "END sentinel not found in doc").toBeGreaterThan(-1);
    const beginLineEnd = doc.indexOf("\n", beginIdx);
    const docBlock = doc.slice(beginLineEnd + 1, endIdx);
    expect(
      docBlock.trim(),
      "docs/F12_TENANT_SCOPE_CONTRACT_2026-09-06.md's conformance table drifted from " +
        "TENANT_SCOPE_CONFORMANCE — regenerate the doc block with renderConformanceMarkdown()",
    ).toBe(renderConformanceMarkdown().trim());
  });

  it("carries all 13 reasons in the doc text", () => {
    const doc = readFileSync(
      new URL("../../../docs/F12_TENANT_SCOPE_CONTRACT_2026-09-06.md", import.meta.url),
      "utf8",
    );
    for (const reason of TENANT_SCOPE_REASONS) {
      expect(doc, `doc is missing reason ${reason}`).toContain(reason);
    }
  });

  it("never lets a reason string reach user-facing i18n text", () => {
    const i18nSrc = readFileSync(new URL("../i18n.tsx", import.meta.url), "utf8");
    for (const reason of TENANT_SCOPE_REASONS) {
      expect(i18nSrc, `reason "${reason}" leaked into i18n.tsx`).not.toContain(reason);
    }
  });
});
