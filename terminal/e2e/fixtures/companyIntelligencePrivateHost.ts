import { createHash } from "node:crypto";

// Synthetic integration fixtures only; these are not issuer disclosures.
// Pure wire builders copied from the existing private-hook contract tests.
const RECEIPT_SCHEMA = "company_intelligence.current_issuer_identity/v1";
const FACT_SCHEMA = "company_intelligence.product_integration_fact/v1";
const EDITION_SCHEMA = "company_intelligence.issuer_disclosure_edition/v1";
export const ISSUER = "ISS:US-XNAS-TEST";
export const GENERATION = "gen-2026-10-11";
export const FACT_HASH = "a".repeat(64);
export const EDITION_HASH = "e".repeat(64);
export const OBSERVED_AT = "2024-02-26T09:05:30.123456+08:00";

function encode(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    return "{" + Object.keys(object).sort()
      .map(key => JSON.stringify(key) + ":" + encode(object[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function privateHostFixtures(count = 2) {
  const receipt = {
    schema: RECEIPT_SCHEMA, identity_mode: "current", issuer_id: ISSUER,
    evidenced_cik: "0000000001", source_commit: "b".repeat(40),
    sources: {
      security_master: { sha256: "1".repeat(64), byte_length: 512 },
      vendor_aliases: { sha256: "2".repeat(64), byte_length: 512 },
      issuer_master: { sha256: "3".repeat(64), byte_length: 512 },
    },
    evidence_source: "sec_company_tickers", evidence_snapshot: "2026-10-10",
  };
  const bytes = Buffer.from(encode(receipt), "utf8");
  const identityReference = {
    schema: RECEIPT_SCHEMA,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byte_length: bytes.length,
  };
  const issuerBinding = {
    issuer_id: ISSUER, evidenced_cik: "0000000001",
    identity_snapshot_reference: identityReference,
  };
  const context = {
    schema: "company_intelligence.private_company_context/v1",
    identity_mode: "current", query: { namespace: "store", symbol: "NVDA" },
    security_id: "SEC:US-XNAS-NVDA", issuer_binding: issuerBinding,
    identity_receipt: receipt,
  };
  const ids = Array.from({ length: count }, (_, i) =>
    "integration:" + (i + 1).toString(16).padStart(64, "0"));
  const reference = { schema: FACT_SCHEMA, sha256: FACT_HASH, byte_length: 512 };
  const edition = { schema: EDITION_SCHEMA, sha256: EDITION_HASH, byte_length: 480 };
  const selections = {
    schema: "company_intelligence.private_issuer_selections/v1",
    generation: GENERATION, identity_mode: "current",
    issuer_role: "subject_disclosing_company", issuer_binding: issuerBinding,
    selections: ids.map(fact_id => ({
      fact_id, fact_reference: reference, edition_reference: edition,
      kind: "product_integration", lifecycle: "planned",
    })),
  };
  const facts = new Map(ids.map((id, i) => [id, {
    schema: "company_intelligence.private_product_integration/v2",
    fact: {
      fact_id: id, kind: "product_integration", lifecycle: "planned",
      subject_id: ISSUER, revision: 3,
      product: "Host verification product " + (i + 1),
      platform: "Example compute platform",
    },
    reference, edition,
    source_timing: {
      published_date: "2024-02-26", published_at: null,
      publication_precision: "date", known_at: OBSERVED_AT,
    },
    generation: GENERATION, authority: "context_only",
  }]));
  return { context, selections, facts, ids, identityReference };
}

export const privateContextPath = "/api/company-intelligence/private/company-context?symbol=NVDA";
export const privateSelectionsPath = "/api/company-intelligence/private/issuers/" +
  encodeURIComponent(ISSUER) + "/product-integrations";
export const privateFactPath = (id: string) =>
  "/api/company-intelligence/private/product-integrations/" + encodeURIComponent(id);
export const privateError = (code: string) => ({
  schema: "company_intelligence.private_error/v1", code, automatic_retry_permitted: false,
});
