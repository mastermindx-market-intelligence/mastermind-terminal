export const COMPANY_INTELLIGENCE_LENSES = [
  "Brief",
  "Results",
  "Call + Q&A",
  "History",
  "Topics",
  "Sources",
];

export const COMPANY_INTELLIGENCE_PROOF_SCHEMA =
  "mastermind.terminal.company_intelligence_live_proof.v1";

const RELEASE_RE = /^[0-9a-f]{40}$/i;
const VIEWPORTS = ["desktop", "mobile"];

export function normalizeLensLabel(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+\d+$/, "");
}

export function validateProofMeta({ base, expectedRelease, symbol }) {
  if (typeof base !== "string" || !/^https?:\/\//.test(base)) {
    throw new Error("The proof base URL is invalid.");
  }
  if (!RELEASE_RE.test(expectedRelease || "")) {
    throw new Error("The expected release id is malformed.");
  }
  if (typeof symbol !== "string" || !/^[A-Z0-9.:-]{1,24}$/.test(symbol)) {
    throw new Error("The proof symbol is malformed.");
  }
  return {
    base: base.replace(/\/$/, ""),
    expectedRelease: expectedRelease.toLowerCase(),
    symbol,
  };
}

function releaseMatches(value, expectedRelease) {
  return RELEASE_RE.test(value || "") && value.toLowerCase() === expectedRelease.toLowerCase();
}

export function validateAnonymousProof(proof, expectedRelease) {
  return !!proof
    && proof.ran === true
    && proof.status === 200
    && releaseMatches(proof.servedRelease, expectedRelease)
    && proof.authGateVisible === true
    && proof.workspaceAbsent === true
    && proof.browserErrorCount === 0;
}

function validateViewport(proof, expectedRelease, viewport) {
  return !!proof
    && proof.viewport === viewport
    && releaseMatches(proof.servedRelease, expectedRelease)
    && proof.symbolMatched === true
    && proof.intelligenceFamilySelected === true
    && proof.briefVisible === true
    && proof.resultsVisible === true
    && proof.callVisible === true
    && proof.sourcesVisible === true
    && proof.evidenceOverlay === true
    && proof.companyVisual === true
    && proof.noOverflow === true
    && proof.lenses?.length === COMPANY_INTELLIGENCE_LENSES.length
    && COMPANY_INTELLIGENCE_LENSES.every((lens) => proof.lenses.includes(lens));
}

export function validateSignedInProof(proof, expectedRelease) {
  if (!proof || proof.ran !== true || proof.browserErrorCount !== 0) return false;
  if (!proof.chartJourney || !proof.ownershipJourney) return false;
  if (!Array.isArray(proof.viewports) || proof.viewports.length !== VIEWPORTS.length) return false;
  return VIEWPORTS.every((viewport) => {
    const row = proof.viewports.find((candidate) => candidate.viewport === viewport);
    return validateViewport(row, expectedRelease, viewport);
  });
}

export function buildCompanyIntelligenceReceipt({
  capturedAt,
  base,
  expectedRelease,
  symbol,
  anonymous,
  signedIn,
}) {
  const meta = validateProofMeta({ base, expectedRelease, symbol });
  const receipt = {
    schema: COMPANY_INTELLIGENCE_PROOF_SCHEMA,
    capturedAt: new Date(capturedAt).toISOString(),
    ...meta,
    anonymous,
    signedIn,
  };
  if (!validateAnonymousProof(receipt.anonymous, receipt.expectedRelease)) {
    throw new Error("The anonymous Company Intelligence proof is incomplete.");
  }
  if (receipt.signedIn?.ran === true && !validateSignedInProof(receipt.signedIn, receipt.expectedRelease)) {
    throw new Error("The signed-in Company Intelligence proof is incomplete.");
  }
  if (receipt.signedIn?.ran !== true && !receipt.signedIn?.blockedReason) {
    throw new Error("A skipped signed-in proof must carry its exact gate.");
  }
  return receipt;
}

export function exitCodeFor(kind) {
  if (!kind) return 0;
  if (kind === "release" || kind === "input") return 64;
  if (kind === "auth") return 78;
  return 70;
}
