import { describe, expect, it } from "vitest";
import {
  buildCompanyIntelligenceReceipt,
  COMPANY_INTELLIGENCE_LENSES,
  exitCodeFor,
  normalizeLensLabel,
  validateAnonymousProof,
  validateSignedInProof,
} from "../../e2e/tools/companyIntelligenceLiveProofLib.mjs";

const RELEASE = "a".repeat(40);

function viewport(viewport: "desktop" | "mobile") {
  return {
    viewport,
    servedRelease: RELEASE,
    symbolMatched: true,
    intelligenceFamilySelected: true,
    lenses: COMPANY_INTELLIGENCE_LENSES,
    plane: "event_workspace.v1",
    briefVisible: true,
    resultsVisible: true,
    callVisible: true,
    sourcesVisible: true,
    evidenceOverlay: true,
    companyVisual: true,
    noOverflow: true,
    screenshot: `/tmp/${viewport}.png`,
  };
}

function anonymous() {
  return {
    ran: true,
    status: 200,
    route: "/analysis?symbol=NVDA&page=intelligence",
    servedRelease: RELEASE,
    authGateVisible: true,
    workspaceAbsent: true,
    browserErrorCount: 0,
    screenshot: "/tmp/anonymous.png",
  };
}

function signedIn() {
  return {
    ran: true,
    viewports: [viewport("desktop"), viewport("mobile")],
    ownershipJourney: true,
    chartJourney: true,
    browserErrorCount: 0,
  };
}

describe("Company Intelligence live-proof contract", () => {
  it("normalizes source-count badges without weakening the lens names", () => {
    expect(normalizeLensLabel(" Sources   3 ")).toBe("Sources");
    expect(normalizeLensLabel("Call + Q&A")).toBe("Call + Q&A");
  });

  it("accepts the anonymous auth boundary only at the requested release", () => {
    expect(validateAnonymousProof(anonymous(), RELEASE)).toBe(true);
    expect(validateAnonymousProof({ ...anonymous(), servedRelease: "b".repeat(40) }, RELEASE)).toBe(false);
  });

  it("requires both responsive views, ownership, chart entry and zero browser errors", () => {
    expect(validateSignedInProof(signedIn(), RELEASE)).toBe(true);
    expect(validateSignedInProof({ ...signedIn(), ownershipJourney: false }, RELEASE)).toBe(false);
    expect(validateSignedInProof({ ...signedIn(), viewports: [viewport("desktop")] }, RELEASE)).toBe(false);
  });

  it("builds a release-bound receipt and makes the auth gate explicit", () => {
    const receipt = buildCompanyIntelligenceReceipt({
      capturedAt: "2026-09-25T00:00:00Z",
      base: "https://app.mastermind-x.com/",
      expectedRelease: RELEASE.toUpperCase(),
      symbol: "NVDA",
      anonymous: anonymous(),
      signedIn: { ran: false, blockedReason: "The operator storage state was not supplied." },
    });
    expect(receipt.base).toBe("https://app.mastermind-x.com");
    expect(receipt.expectedRelease).toBe(RELEASE);
    expect(receipt.signedIn.ran).toBe(false);
  });

  it("uses distinct exit codes for release, auth and assertion gates", () => {
    expect(exitCodeFor(null)).toBe(0);
    expect(exitCodeFor("release")).toBe(64);
    expect(exitCodeFor("auth")).toBe(78);
    expect(exitCodeFor("assertion")).toBe(70);
  });
});
