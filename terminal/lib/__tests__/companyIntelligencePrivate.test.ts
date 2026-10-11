import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  PRIVATE_EDITION_SCHEMA,
  PRIVATE_ERROR_SCHEMA,
  PRIVATE_FACT_SCHEMA,
  PRIVATE_ISSUER_SELECTIONS_SCHEMA,
  PRIVATE_PRODUCT_INTEGRATION_SCHEMA,
  PrivateDecodeError,
  assertPrivateContextSelection,
  assertPrivateComposition,
  decodePrivateCompanyContext,
  decodePrivateError,
  decodePrivateIssuerSelections,
  decodePrivateProductIntegration,
  isCanonicalIssuerShape,
  isFactIdShape,
  isPrivateCompanySymbol,
} from '@/lib/companyIntelligencePrivate';

// Synthetic metadata only, independently serialized with Python by the contract review.
const CONTEXT_RECEIPT_HASH = 'b94c988b5b1463c0e57f8d83b74be7f87fc4715efa418470fcf5e1f74fedce90';
function contextFixture(symbol = 'GOOG') {
  const identity_receipt = {
    schema: 'company_intelligence.current_issuer_identity/v1', identity_mode: 'current',
    issuer_id: 'ISS:US-XNAS-TEST', evidenced_cik: '0000000001', source_commit: 'b'.repeat(40),
    sources: {
      security_master: { sha256: '1'.repeat(64), byte_length: 512 },
      vendor_aliases: { sha256: '2'.repeat(64), byte_length: 512 },
      issuer_master: { sha256: '3'.repeat(64), byte_length: 512 },
    },
    evidence_source: 'sec_company_tickers', evidence_snapshot: '2026-10-10',
  };
  return {
    schema: 'company_intelligence.private_company_context/v1', identity_mode: 'current',
    query: { namespace: 'store', symbol }, security_id: 'SEC:US-XNAS-' + symbol,
    issuer_binding: {
      issuer_id: identity_receipt.issuer_id, evidenced_cik: identity_receipt.evidenced_cik,
      identity_snapshot_reference: { schema: identity_receipt.schema, sha256: CONTEXT_RECEIPT_HASH, byte_length: 629 },
    },
    identity_receipt,
  };
}

function sortedFixture(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortedFixture(v)]));
  }
  return value;
}

function rebindReceipt(value: ReturnType<typeof contextFixture>) {
  const bytes = Buffer.from(JSON.stringify(sortedFixture(value.identity_receipt)), 'utf8');
  value.issuer_binding.identity_snapshot_reference.sha256 = createHash('sha256').update(bytes).digest('hex');
  value.issuer_binding.identity_snapshot_reference.byte_length = bytes.length;
  return value;
}

describe('current private company context', () => {
  it('matches independent Python receipt bytes and preserves one receipt across share classes', async () => {
    const original = contextFixture();
    expect(rebindReceipt(contextFixture()).issuer_binding.identity_snapshot_reference).toEqual(original.issuer_binding.identity_snapshot_reference);
    const a = await decodePrivateCompanyContext(original, 'GOOG');
    const b = await decodePrivateCompanyContext(contextFixture('GOOGL'), 'GOOGL');
    expect(a.issuer_binding).toEqual(b.issuer_binding);
    expect(a.security_id).not.toBe(b.security_id);
    expect(a.query.symbol).not.toBe(b.query.symbol);
    expect(Object.isFrozen(a.identity_receipt.sources.security_master)).toBe(true);
    const reversed = Object.fromEntries(Object.entries(original).reverse());
    expect(await decodePrivateCompanyContext(reversed, 'GOOG')).toEqual(a);
  });

  it.each(['', 'mu', 'MU\n', '^NDX', 'A B', 'A/B', 'A'.repeat(25), 'MÜ'])('rejects malformed symbol %j without normalization', symbol => {
    expect(isPrivateCompanySymbol(symbol)).toBe(false);
  });

  it('keeps syntactically valid dot/hyphen aliases distinct for the owner', () => {
    expect(isPrivateCompanySymbol('BRK.B')).toBe(true);
    expect(isPrivateCompanySymbol('BRK-B')).toBe(true);
  });

  it.each(['9007199254740993', '1000000000000000000000'])('preserves a native arbitrary-size decimal disambiguator %s', async suffix => {
    const value = contextFixture();
    value.identity_receipt.issuer_id = value.issuer_binding.issuer_id = 'ISS:US-XNAS-TEST.' + suffix;
    value.security_id = 'SEC:US-XNAS-GOOG.' + suffix;
    await expect(decodePrivateCompanyContext(rebindReceipt(value), 'GOOG')).resolves.toHaveProperty('security_id', value.security_id);
  });

  it('rejects forged receipt hash or byte length and an incorrect echoed query', async () => {
    const hash = contextFixture(); hash.issuer_binding.identity_snapshot_reference.sha256 = '0'.repeat(64);
    const length = contextFixture(); length.issuer_binding.identity_snapshot_reference.byte_length += 1;
    for (const value of [hash, length]) await expect(decodePrivateCompanyContext(value, 'GOOG')).rejects.toBeInstanceOf(PrivateDecodeError);
    await expect(decodePrivateCompanyContext(contextFixture(), 'GOOGL')).rejects.toBeInstanceOf(PrivateDecodeError);
  });

  it('rejects closed-key and scalar violations even with a matching recomputed digest', async () => {
    const mutations: Array<(v: ReturnType<typeof contextFixture>) => void> = [
      v => { Object.assign(v, { generation: 'invented' }); },
      v => { Object.assign(v.query, { vendor: 'yahoo' }); },
      v => { Object.assign(v.identity_receipt, { query: 'GOOG' }); },
      v => { Object.assign(v.identity_receipt.sources, { other: {} }); },
      v => { Object.assign(v.identity_receipt.sources.issuer_master, { schema: 'extra' }); },
      v => { v.identity_receipt.evidenced_cik = '0000000002'; },
      v => { v.identity_receipt.evidenced_cik = v.issuer_binding.evidenced_cik = '0000000000'; },
      v => { v.identity_receipt.evidenced_cik = v.issuer_binding.evidenced_cik = '0000000001\n'; },
      v => { v.identity_receipt.issuer_id = v.issuer_binding.issuer_id = 'ISS:US-XNAS-TÉST'; },
      v => { v.identity_receipt.issuer_id = v.issuer_binding.issuer_id = 'ISS:us-xnas-test'; },
      v => { v.identity_receipt.issuer_id = v.issuer_binding.issuer_id = 'ISS:US-XNAS-TEST.02'; },
      v => { v.identity_receipt.source_commit += '\n'; },
      v => { v.identity_receipt.evidence_source = 'inferred'; },
      v => { v.identity_receipt.evidence_snapshot = '2026-02-30'; },
      v => { v.identity_receipt.evidence_snapshot = '2099-01-01'; },
      v => { v.identity_receipt.evidence_snapshot = '0000-01-01'; },
      v => { v.identity_receipt.evidence_snapshot += 'T00:00:00Z'; },
      v => { v.identity_receipt.sources.security_master.byte_length = 2097153; },
      v => { v.identity_receipt.sources.security_master.byte_length = 0; },
      v => { v.identity_receipt.sources.security_master.sha256 += '\n'; },
      v => { v.security_id = 'ISS:US-XNAS-GOOG'; },
      v => { v.security_id = 'SEC:CA-XTSE-GOOG'; },
      v => { v.security_id = 'SEC:US-BATS-GOOG'; },
    ];
    for (const mutate of mutations) {
      const value = contextFixture(); mutate(value); rebindReceipt(value);
      await expect(decodePrivateCompanyContext(value, 'GOOG')).rejects.toBeInstanceOf(PrivateDecodeError);
    }
    const largeSource = contextFixture(); largeSource.identity_receipt.sources.security_master.byte_length = 2097152;
    await expect(decodePrivateCompanyContext(rebindReceipt(largeSource), 'GOOG')).resolves.toHaveProperty('query.symbol', 'GOOG');
  });

  it('freezes validated values before an asynchronous digest can settle', async () => {
    let resolveHash!: (v: ArrayBuffer) => void;
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(resolve => { resolveHash = resolve; }));
    try {
      const value = contextFixture();
      const pending = decodePrivateCompanyContext(value, 'GOOG');
      value.query.symbol = 'NVDA'; value.identity_receipt.sources.security_master.sha256 = 'f'.repeat(64);
      value.issuer_binding.evidenced_cik = '0000000002';
      resolveHash(Uint8Array.from(Buffer.from(CONTEXT_RECEIPT_HASH, 'hex')).buffer);
      const decoded = await pending;
      expect(decoded.query.symbol).toBe('GOOG');
      expect(decoded.issuer_binding.evidenced_cik).toBe('0000000001');
      expect(decoded.identity_receipt.sources.security_master.sha256).toBe('1'.repeat(64));
    } finally { spy.mockRestore(); }
  });

  it('compares every context/selection binding member without inventing a generation', async () => {
    const context = await decodePrivateCompanyContext(contextFixture(), 'GOOG');
    const raw = selectionProjection([], { issuer_binding: context.issuer_binding });
    const selection = decodePrivateIssuerSelections(raw, context.issuer_binding.issuer_id);
    expect(() => assertPrivateContextSelection(context, selection)).not.toThrow();
    for (const binding of [
      { ...selection.issuer_binding, issuer_id: OTHER_ISSUER },
      { ...selection.issuer_binding, evidenced_cik: '0000000002' },
      ...['schema', 'sha256', 'byte_length'].map(key => ({
        ...selection.issuer_binding,
        identity_snapshot_reference: { ...selection.issuer_binding.identity_snapshot_reference, [key]: key === 'byte_length' ? 1 : 'different' },
      })),
    ]) expect(() => assertPrivateContextSelection(context, { ...selection, issuer_binding: binding })).toThrow(PrivateDecodeError);
  });
});

const SECRET = 'LEAKED_SOURCE_TEXT';
const ISSUER = 'ISS:US-XNYS-MMC';
const OTHER_ISSUER = 'ISS:US-XNAS-AAPL';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const FACT_ID = 'integration:' + HASH_A;
const OTHER_FACT_ID = 'integration:' + 'd'.repeat(64);
const SNAPSHOT_SCHEMA = 'dataos.issuer_identity_receipt/v2';
const GENERATION = 'gen-2026-10-11';

describe('exact native scalar and array boundaries', () => {
  it('refuses a final newline in a SHA256 or CIK', () => {
    expect(() => decodePrivateProductIntegration(factProjection({}, {
      reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A + '\n', 512),
    }), FACT_ID)).toThrow(PrivateDecodeError);
    const value = selectionProjection();
    value.issuer_binding.evidenced_cik += '\n';
    expect(() => decodePrivateIssuerSelections(value, ISSUER)).toThrow(PrivateDecodeError);
  });

  it('refuses sparse selections rather than treating holes as a qualified empty generation', () => {
    expect(() => decodePrivateIssuerSelections(selectionProjection(new Array(1)), ISSUER)).toThrow(PrivateDecodeError);
  });

  it('refuses JSON-escaped unpaired surrogates that native UTF-8 scope encoding cannot represent', () => {
    expect(decodePrivateProductIntegration(factProjection({ product: '🚀'.repeat(64) }), FACT_ID).fact.product).toBe('🚀'.repeat(64));
    for (const product of ['x\ud800', 'x\udfff']) {
      expect(() => decodePrivateProductIntegration(factProjection({ product }), FACT_ID)).toThrow(PrivateDecodeError);
    }
  });
});

function nativeReference(schema: string, sha256: string, byteLength: unknown) {
  return { schema, sha256, byte_length: byteLength };
}

function factProjection(factFields: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return Object.assign({
    schema: PRIVATE_PRODUCT_INTEGRATION_SCHEMA,
    fact: Object.assign({ fact_id: FACT_ID, kind: 'product_integration', lifecycle: 'planned' }, factFields),
    reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 512),
    edition: nativeReference(PRIVATE_EDITION_SCHEMA, HASH_B, 480),
    source_timing: { published_date: '2024-02-26', published_at: null, publication_precision: 'date', known_at: '2024-02-26T09:05:30.123456+08:00' },
    generation: GENERATION,
    authority: 'context_only',
  }, overrides);
}

function selectionProjection(entries: unknown = [], overrides: Record<string, unknown> = {}) {
  return Object.assign({
    schema: PRIVATE_ISSUER_SELECTIONS_SCHEMA,
    generation: GENERATION,
    identity_mode: 'current',
    issuer_role: 'subject_disclosing_company',
    issuer_binding: {
      issuer_id: ISSUER,
      evidenced_cik: '0000000001',
      identity_snapshot_reference: nativeReference(SNAPSHOT_SCHEMA, HASH_C, 256),
    },
    selections: entries,
  }, overrides);
}

function selectionEntry(factId: string, overrides: Record<string, unknown> = {}) {
  return Object.assign({
    fact_id: factId,
    fact_reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 512),
    edition_reference: nativeReference(PRIVATE_EDITION_SCHEMA, HASH_B, 480),
    kind: 'product_integration',
    lifecycle: 'planned',
  }, overrides);
}

function orderedEntries(count: number): unknown[] {
  const entries: unknown[] = [];
  for (let index = 1; index <= count; index += 1) {
    entries.push(selectionEntry('integration:' + index.toString(16).padStart(64, '0')));
  }
  return entries;
}

function refuse(build: () => unknown): PrivateDecodeError {
  try {
    build();
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateDecodeError);
    return error as PrivateDecodeError;
  }
  throw new Error('expected a bounded refusal, got a value');
}

describe('private product-integration projection', () => {
  it('accepts the mandatory granted subset on its own', () => {
    const decoded = decodePrivateProductIntegration(factProjection(), FACT_ID);
    expect(decoded.schema).toBe(PRIVATE_PRODUCT_INTEGRATION_SCHEMA);
    expect(decoded.authority).toBe('context_only');
    expect(decoded.fact).toEqual({ fact_id: FACT_ID, kind: 'product_integration', lifecycle: 'planned' });
    expect(Object.keys(decoded).sort()).toEqual(['authority', 'edition', 'fact', 'generation', 'reference', 'schema', 'source_timing']);
  });

  it('accepts every optional field and an explicitly null magnitude', () => {
    const payload = factProjection({
      revision: 64,
      subject_id: ISSUER,
      object_id: OTHER_ISSUER,
      product: 'HBM3e memory module',
      platform: 'Vera Rubin NVL144',
      amount: null,
      economic_share: null,
    });
    const decoded = decodePrivateProductIntegration(payload, FACT_ID);
    expect(decoded.fact.amount).toBeNull();
    expect(decoded.fact.economic_share).toBeNull();
    expect(decoded.fact.product).toBe('HBM3e memory module');
    expect(decoded.generation).toBe(GENERATION);
  });

  it('does not require the optional magnitude fields to be present or absent', () => {
    const absent = decodePrivateProductIntegration(factProjection({ revision: 1 }), FACT_ID);
    expect('amount' in absent.fact).toBe(false);
    expect('economic_share' in absent.fact).toBe(false);
  });

  it('refuses any commercial magnitude', () => {
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ amount: 12 }), FACT_ID)).reason).toBe('MAGNITUDE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ economic_share: '0.25' }), FACT_ID)).reason).toBe('MAGNITUDE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ amount: 0 }), FACT_ID)).reason).toBe('MAGNITUDE');
  });

  it('refuses unknown top-level keys and leaked payload text', () => {
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { evidence: SECRET }), FACT_ID)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { admissions: [] }), FACT_ID)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { mode: 'current' }), FACT_ID)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ excerpt: SECRET }), FACT_ID)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ known_at: '2026-10-11T00:00:00Z' }), FACT_ID)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ span: { start_byte: 0, end_byte: 1, text_sha256: HASH_C } }), FACT_ID)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ claim_key: 'claim-1' }), FACT_ID)).reason).toBe('KEYSET');
  });

  it('refuses extra keys inside a content reference', () => {
    const leaked = Object.assign(nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 512), { source_text: SECRET });
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: leaked }), FACT_ID)).reason).toBe('KEYSET');
  });

  it('refuses a wrong top-level or reference schema', () => {
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { schema: 'company_intelligence.product_integration/v2' }), FACT_ID)).reason).toBe('SCHEMA');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_EDITION_SCHEMA, HASH_A, 512) }), FACT_ID)).reason).toBe('REFERENCE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { edition: nativeReference(PRIVATE_FACT_SCHEMA, HASH_B, 480) }), FACT_ID)).reason).toBe('REFERENCE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference('mastermind.anything/v1', HASH_A, 512) }), FACT_ID)).reason).toBe('REFERENCE');
  });

  it('refuses malformed digests and byte lengths', () => {
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A.toUpperCase(), 512) }), FACT_ID)).reason).toBe('DIGEST');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_FACT_SCHEMA, 'a'.repeat(63), 512) }), FACT_ID)).reason).toBe('DIGEST');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_FACT_SCHEMA, 'g'.repeat(64), 512) }), FACT_ID)).reason).toBe('DIGEST');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 0) }), FACT_ID)).reason).toBe('INTEGER');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 16385) }), FACT_ID)).reason).toBe('INTEGER');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 512.5) }), FACT_ID)).reason).toBe('INTEGER');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, '512') }), FACT_ID)).reason).toBe('INTEGER');
    expect(decodePrivateProductIntegration(factProjection({}, { reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 16384) }), FACT_ID).reference.byte_length).toBe(16384);
  });

  it('bounds revision to the native 1..64 chain limit', () => {
    expect(decodePrivateProductIntegration(factProjection({ revision: 1 }), FACT_ID).fact.revision).toBe(1);
    expect(decodePrivateProductIntegration(factProjection({ revision: 64 }), FACT_ID).fact.revision).toBe(64);
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ revision: 65 }), FACT_ID)).reason).toBe('INTEGER');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ revision: 0 }), FACT_ID)).reason).toBe('INTEGER');
  });

  it('enforces the native scope constraints on product and platform', () => {
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ product: '' }), FACT_ID)).reason).toBe('TEXT');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ product: ' Widget' }), FACT_ID)).reason).toBe('TEXT');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ product: 'x'.repeat(257) }), FACT_ID)).reason).toBe('TEXT');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ platform: 'y'.repeat(257) }), FACT_ID)).reason).toBe('TEXT');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ product: null }), FACT_ID)).reason).toBe('TEXT');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ product: String.fromCodePoint(0x1f600).repeat(200) }), FACT_ID)).reason).toBe('TEXT');
    expect(decodePrivateProductIntegration(factProjection({ product: 'x'.repeat(256) }), FACT_ID).fact.product).toHaveLength(256);
  });

  it('refuses an ambiguous party pair and an invalid identifier', () => {
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ subject_id: ISSUER, object_id: ISSUER }), FACT_ID)).reason).toBe('IDENTITY');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ subject_id: 'has space' }), FACT_ID)).reason).toBe('IDENTIFIER');
    expect(decodePrivateProductIntegration(factProjection({ subject_id: ISSUER }), FACT_ID).fact.subject_id).toBe(ISSUER);
  });

  it('refuses a fact id that is not integration plus 64 lowercase hex', () => {
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ fact_id: 'disclosure:' + HASH_A }), FACT_ID)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ fact_id: 'integration:' + 'a'.repeat(63) }), FACT_ID)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({ fact_id: 'integration:' + HASH_A.toUpperCase() }), FACT_ID)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection(), OTHER_FACT_ID)).reason).toBe('BINDING');
  });

  it('refuses a wrong authority, generation and non-object payload', () => {
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { authority: 'trade' }), FACT_ID)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { authority: 'full_text' }), FACT_ID)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { generation: 'has space' }), FACT_ID)).reason).toBe('IDENTIFIER');
    expect(refuse(() => decodePrivateProductIntegration(factProjection({}, { generation: '-lead' }), FACT_ID)).reason).toBe('IDENTIFIER');
    expect(refuse(() => decodePrivateProductIntegration([], FACT_ID)).reason).toBe('OBJECT');
    expect(refuse(() => decodePrivateProductIntegration(null, FACT_ID)).reason).toBe('OBJECT');
    expect(refuse(() => decodePrivateProductIntegration(SECRET, FACT_ID)).reason).toBe('OBJECT');
  });
});

describe('private issuer selection projection', () => {
  it('accepts a qualified empty generation', () => {
    const decoded = decodePrivateIssuerSelections(selectionProjection([]), ISSUER);
    expect(decoded.selections).toEqual([]);
    expect(decoded.issuer_role).toBe('subject_disclosing_company');
    expect(decoded.identity_mode).toBe('current');
    expect(Object.keys(decoded).sort()).toEqual(['generation', 'identity_mode', 'issuer_binding', 'issuer_role', 'schema', 'selections']);
  });

  it('distinguishes an empty list from a malformed one', () => {
    expect(refuse(() => decodePrivateIssuerSelections({ schema: PRIVATE_ISSUER_SELECTIONS_SCHEMA, generation: GENERATION, identity_mode: 'current', issuer_role: 'subject_disclosing_company', issuer_binding: selectionProjection().issuer_binding }, ISSUER)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection({}, { selections: null }), ISSUER)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection({}, { selections: {} }), ISSUER)).reason).toBe('VALUE');
  });

  it('accepts sixteen sorted unique entries and refuses seventeen', () => {
    expect(decodePrivateIssuerSelections(selectionProjection(orderedEntries(16)), ISSUER).selections).toHaveLength(16);
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection(orderedEntries(17)), ISSUER)).reason).toBe('LIMIT');
  });

  it('refuses duplicates and an unsorted list', () => {
    const duplicated = [selectionEntry(FACT_ID), selectionEntry(FACT_ID)];
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection(duplicated), ISSUER)).reason).toBe('ORDER');
    const reversed = orderedEntries(3).reverse();
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection(reversed), ISSUER)).reason).toBe('ORDER');
  });

  it('refuses an entry with a leaked or extra key and a wrong species', () => {
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([selectionEntry(FACT_ID, { subject_id: ISSUER })]), ISSUER)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([selectionEntry(FACT_ID, { lifecycle: 'active' })]), ISSUER)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([selectionEntry(FACT_ID, { kind: 'earnings_period' })]), ISSUER)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([selectionEntry(FACT_ID, { fact_reference: nativeReference(PRIVATE_EDITION_SCHEMA, HASH_A, 512) })]), ISSUER)).reason).toBe('REFERENCE');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([selectionEntry('integration:' + 'z'.repeat(64))]), ISSUER)).reason).toBe('VALUE');
  });

  it('refuses a counterparty role, a historical identity mode and a wrong authority word', () => {
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([], { issuer_role: 'counterparty' }), ISSUER)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([], { identity_mode: 'historical' }), ISSUER)).reason).toBe('VALUE');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([], { schema: PRIVATE_PRODUCT_INTEGRATION_SCHEMA }), ISSUER)).reason).toBe('SCHEMA');
  });

  it('refuses a projection naming another issuer', () => {
    const foreign = selectionProjection([], { issuer_binding: Object.assign({}, selectionProjection().issuer_binding, { issuer_id: OTHER_ISSUER }) });
    expect(refuse(() => decodePrivateIssuerSelections(foreign, ISSUER)).reason).toBe('BINDING');
  });

  it('bounds the evidenced CIK to ten digits that are not all zero', () => {
    function withCik(cik: unknown) {
      return selectionProjection([], { issuer_binding: Object.assign({}, selectionProjection().issuer_binding, { evidenced_cik: cik }) });
    }
    expect(decodePrivateIssuerSelections(withCik('0000000001'), ISSUER).issuer_binding.evidenced_cik).toBe('0000000001');
    expect(refuse(() => decodePrivateIssuerSelections(withCik('0000000000'), ISSUER)).reason).toBe('CIK');
    expect(refuse(() => decodePrivateIssuerSelections(withCik('1'), ISSUER)).reason).toBe('CIK');
    expect(refuse(() => decodePrivateIssuerSelections(withCik('00000000001'), ISSUER)).reason).toBe('CIK');
    expect(refuse(() => decodePrivateIssuerSelections(withCik('0000000 01'), ISSUER)).reason).toBe('CIK');
    expect(refuse(() => decodePrivateIssuerSelections(withCik('000000000a'), ISSUER)).reason).toBe('CIK');
  });

  it('names the actual supplied snapshot schema instead of inventing one', () => {
    function withSnapshotSchema(schema: string) {
      return selectionProjection([], { issuer_binding: Object.assign({}, selectionProjection().issuer_binding, { identity_snapshot_reference: nativeReference(schema, HASH_C, 256) }) });
    }
    expect(decodePrivateIssuerSelections(withSnapshotSchema(SNAPSHOT_SCHEMA), ISSUER).issuer_binding.identity_snapshot_reference.schema).toBe(SNAPSHOT_SCHEMA);
    expect(decodePrivateIssuerSelections(withSnapshotSchema('mastermind.issuer_identity_snapshot/v9'), ISSUER).issuer_binding.identity_snapshot_reference.schema).toBe('mastermind.issuer_identity_snapshot/v9');
    expect(refuse(() => decodePrivateIssuerSelections(withSnapshotSchema(''), ISSUER)).reason).toBe('IDENTIFIER');
    expect(refuse(() => decodePrivateIssuerSelections(withSnapshotSchema('snapshot receipt'), ISSUER)).reason).toBe('IDENTIFIER');
    expect(refuse(() => decodePrivateIssuerSelections(withSnapshotSchema('x'.repeat(257)), ISSUER)).reason).toBe('IDENTIFIER');
  });

  it('bounds the snapshot reference and rejects an invented extra binding key', () => {
    const broken = selectionProjection([], { issuer_binding: Object.assign({}, selectionProjection().issuer_binding, { identity_snapshot_reference: nativeReference(SNAPSHOT_SCHEMA, HASH_C, 0) }) });
    expect(refuse(() => decodePrivateIssuerSelections(broken, ISSUER)).reason).toBe('INTEGER');
    const extra = selectionProjection([], { issuer_binding: Object.assign({}, selectionProjection().issuer_binding, { ticker: 'MMC' }) });
    expect(refuse(() => decodePrivateIssuerSelections(extra, ISSUER)).reason).toBe('KEYSET');
    const minted = selectionProjection([], { issuer_binding: Object.assign({}, selectionProjection().issuer_binding, { identity_snapshot_reference: nativeReference(SNAPSHOT_SCHEMA, HASH_C, 16385) }) });
    expect(refuse(() => decodePrivateIssuerSelections(minted, ISSUER)).reason).toBe('INTEGER');
  });

  it('bounds the issuer id as the supplied source establishes, and grants nothing', () => {
    expect(isCanonicalIssuerShape(ISSUER)).toBe(true);
    expect(isCanonicalIssuerShape('ISS:CN-XSHG-600519')).toBe(true);
    expect(isCanonicalIssuerShape('ISS:US-XNYS-BRK-B')).toBe(true);
    expect(isCanonicalIssuerShape('ISS:US-XNYS-MMC.2')).toBe(true);
    expect(isCanonicalIssuerShape('ISS:US-XNYS-MMC.1')).toBe(false);
    expect(isCanonicalIssuerShape('ISS:US-XNYS-MMC.0')).toBe(false);
    expect(isCanonicalIssuerShape('ISS:US-XXXX-MMC')).toBe(false);
    expect(isCanonicalIssuerShape('iss:US-XNYS-MMC')).toBe(false);
    expect(isCanonicalIssuerShape('ISS:US-XNYS-MMC/../x')).toBe(false);
    expect(isCanonicalIssuerShape('ISS:US-XNYS-MMC%20')).toBe(false);
    expect(isCanonicalIssuerShape('ISS:US-XNYS-MMC\\ops')).toBe(false);
    expect(isCanonicalIssuerShape('ISS:US-XNYS-')).toBe(false);
    expect(isCanonicalIssuerShape('ISS:' + 'US-XNYS-' + 'M'.repeat(130))).toBe(false);
    expect(isCanonicalIssuerShape(undefined)).toBe(false);
    expect(isFactIdShape(FACT_ID)).toBe(true);
    expect(isFactIdShape('integration:' + 'A'.repeat(64))).toBe(false);
    expect(isFactIdShape(ISSUER)).toBe(false);
  });

  it('refuses a leaked selection field and an invalid generation', () => {
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([], { decision_basis: SECRET }), ISSUER)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([], { generation: 'gen 1' }), ISSUER)).reason).toBe('IDENTIFIER');
    expect(refuse(() => decodePrivateIssuerSelections(selectionProjection([], { generation: 'x'.repeat(257) }), ISSUER)).reason).toBe('IDENTIFIER');
  });
});

describe('closed private error payload', () => {
  it('accepts each coarse code at its own status', () => {
    const cases: Array<[number, string]> = [
      [400, 'REQUEST_INVALID'],
      [401, 'AUTHENTICATION_REQUIRED'],
      [403, 'ENTITLEMENT_REQUIRED'],
      [502, 'AUTHENTICATION_UNAVAILABLE'],
      [503, 'PRIVATE_SERVICE_UNAVAILABLE'],
      [503, 'SOURCE_RUNTIME_UNAVAILABLE'],
      [503, 'PRIVATE_SOURCE_UNAVAILABLE'],
      [503, 'SOURCE_NOT_ADMITTED'],
    ];
    for (const [status, code] of cases) {
      const decoded = decodePrivateError({ schema: PRIVATE_ERROR_SCHEMA, code, automatic_retry_permitted: false }, status);
      expect(decoded.code).toBe(code);
      expect(decoded.schema).toBe(PRIVATE_ERROR_SCHEMA);
      expect(decoded.automatic_retry_permitted).toBe(false);
    }
  });

  it('refuses an unknown code, a status mismatch and any retry permission', () => {
    expect(refuse(() => decodePrivateError({ schema: PRIVATE_ERROR_SCHEMA, code: 'GRANT_RETRACTED', automatic_retry_permitted: false }, 403)).reason).toBe('STATUS');
    expect(refuse(() => decodePrivateError({ schema: PRIVATE_ERROR_SCHEMA, code: 'SOURCE_NOT_ADMITTED', automatic_retry_permitted: false }, 401)).reason).toBe('STATUS');
    expect(refuse(() => decodePrivateError({ schema: PRIVATE_ERROR_SCHEMA, code: 'PRIVATE_SERVICE_UNAVAILABLE', automatic_retry_permitted: false }, 500)).reason).toBe('STATUS');
    expect(refuse(() => decodePrivateError({ schema: PRIVATE_ERROR_SCHEMA, code: 'ENTITLEMENT_REQUIRED', automatic_retry_permitted: true }, 403)).reason).toBe('RETRY');
    expect(refuse(() => decodePrivateError({ schema: PRIVATE_ERROR_SCHEMA, code: 'ENTITLEMENT_REQUIRED', automatic_retry_permitted: 0 }, 403)).reason).toBe('RETRY');
    expect(refuse(() => decodePrivateError({ schema: PRIVATE_ERROR_SCHEMA, code: 'ENTITLEMENT_REQUIRED' }, 403)).reason).toBe('KEYSET');
    expect(refuse(() => decodePrivateError({ schema: 'billing.error/v1', code: 'ENTITLEMENT_REQUIRED', automatic_retry_permitted: false }, 403)).reason).toBe('SCHEMA');
    expect(refuse(() => decodePrivateError({ detail: SECRET, schema: PRIVATE_ERROR_SCHEMA, code: 'ENTITLEMENT_REQUIRED', automatic_retry_permitted: false }, 403)).reason).toBe('KEYSET');
  });

  it('never copies the rejected object into the refusal', () => {
    const leakedFact = factProjection({ reviewer_narrative: SECRET }, { evidence: SECRET });
    const error = refuse(() => decodePrivateProductIntegration(leakedFact, FACT_ID));
    expect(error.message).not.toContain(SECRET);
    expect(error.name).not.toContain(SECRET);
    expect(JSON.stringify({ name: error.name, message: error.message, reason: error.reason })).not.toContain(SECRET);
    const selectionError = refuse(() => decodePrivateIssuerSelections(selectionProjection([], { reviewer_narrative: SECRET }), ISSUER));
    expect(selectionError.message).not.toContain(SECRET);
  });

  it('is a bounded custom error type', () => {
    const error = refuse(() => decodePrivateProductIntegration({ not: SECRET }, FACT_ID));
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PrivateDecodeError);
    expect(['OBJECT', 'KEYSET']).toContain(error.reason);
  });
});

describe('selection-to-fact composition', () => {
  function composed() {
    const selection = decodePrivateIssuerSelections(selectionProjection([selectionEntry(FACT_ID), selectionEntry(OTHER_FACT_ID)]), ISSUER);
    const entry = selection.selections[0];
    const fact = decodePrivateProductIntegration(factProjection({ subject_id: ISSUER }), FACT_ID);
    return { selection, entry, fact };
  }

  it('accepts the exact matching triple', () => {
    const { selection, entry, fact } = composed();
    expect(() => assertPrivateComposition(selection, entry, fact)).not.toThrow();
  });

  it('requires subject_id even though the generic decoder permits it absent', () => {
    const { selection, entry } = composed();
    const withoutSubject = decodePrivateProductIntegration(factProjection(), FACT_ID);
    expect(refuse(() => assertPrivateComposition(selection, entry, withoutSubject)).reason).toBe('COMPOSITION');
  });

  it('refuses a subject naming another issuer', () => {
    const { selection, entry } = composed();
    const otherSubject = decodePrivateProductIntegration(factProjection({ subject_id: OTHER_ISSUER }), FACT_ID);
    expect(refuse(() => assertPrivateComposition(selection, entry, otherSubject)).reason).toBe('COMPOSITION');
  });

  it('refuses a fact id mismatch', () => {
    const { selection, fact } = composed();
    const otherEntry = selection.selections[1];
    expect(refuse(() => assertPrivateComposition(selection, otherEntry, fact)).reason).toBe('COMPOSITION');
  });

  it('refuses a fact reference mismatch in any component', () => {
    const { selection, entry } = composed();
    const wrongSha = decodePrivateProductIntegration(factProjection({ subject_id: ISSUER }, { reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_C, 512) }), FACT_ID);
    const wrongLength = decodePrivateProductIntegration(factProjection({ subject_id: ISSUER }, { reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 513) }), FACT_ID);
    expect(refuse(() => assertPrivateComposition(selection, entry, wrongSha)).reason).toBe('COMPOSITION');
    expect(refuse(() => assertPrivateComposition(selection, entry, wrongLength)).reason).toBe('COMPOSITION');
  });

  it('refuses an edition reference mismatch', () => {
    const { selection, entry } = composed();
    const wrongEdition = decodePrivateProductIntegration(factProjection({ subject_id: ISSUER }, { edition: nativeReference(PRIVATE_EDITION_SCHEMA, 'e'.repeat(64), 480) }), FACT_ID);
    expect(refuse(() => assertPrivateComposition(selection, entry, wrongEdition)).reason).toBe('COMPOSITION');
  });

  it('refuses an old generation held up by the caller', () => {
    const { selection, entry } = composed();
    const stale = decodePrivateProductIntegration(factProjection({ subject_id: ISSUER }, { generation: 'gen-2026-10-10' }), FACT_ID);
    expect(refuse(() => assertPrivateComposition(selection, entry, stale)).reason).toBe('COMPOSITION');
  });

  it('refuses an unlisted entry even when its fact references and generation match', () => {
    const { entry, fact } = composed();
    const empty = decodePrivateIssuerSelections(selectionProjection([]), ISSUER);
    expect(refuse(() => assertPrivateComposition(empty, entry, fact)).reason).toBe('COMPOSITION');
  });

  it('refuses a changed generation or fact ID in otherwise valid typed inputs', () => {
    const { selection, entry, fact } = composed();
    const tampered = Object.assign({}, fact, { generation: 'gen-2026-10-10' });
    expect(refuse(() => assertPrivateComposition(selection, entry, tampered)).reason).toBe('COMPOSITION');
    expect(refuse(() => assertPrivateComposition(selection, Object.assign({}, entry, { fact_id: OTHER_FACT_ID }), fact)).reason).toBe('COMPOSITION');
  });
});

const TIMING = { published_date: '2024-02-26', published_at: null, publication_precision: 'date', known_at: '2024-02-26T09:05:30.123456+08:00' };
function timedFact(timing: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return factProjection({ subject_id: ISSUER }, { source_timing: timing, ...overrides });
}

describe('private source timing', () => {
  it('refuses the v1 projection and a projection without timing', () => {
    const v1WithTiming = factProjection({ subject_id: ISSUER }, { schema: 'company_intelligence.private_product_integration/v1' });
    expect(refuse(() => decodePrivateProductIntegration(v1WithTiming, FACT_ID)).reason).toBe('SCHEMA');
    const v1Shape = factProjection({ subject_id: ISSUER });
    delete (v1Shape as { source_timing?: unknown }).source_timing;
    expect(refuse(() => decodePrivateProductIntegration(v1Shape, FACT_ID)).reason).toBe('KEYSET');
  });
  it('refuses a timing object with an unknown key or a missing field', () => {
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...TIMING, note: 'x' }), FACT_ID)).reason).toBe('TIMING');
    for (const key of ['published_date', 'published_at', 'publication_precision', 'known_at']) {
      const missing: Record<string, unknown> = { ...TIMING };
      delete missing[key];
      expect(refuse(() => decodePrivateProductIntegration(timedFact(missing), FACT_ID)).reason).toBe('TIMING');
    }
  });
  it('refuses wrong precision and wrong null pairing', () => {
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...TIMING, publication_precision: 'second' }), FACT_ID)).reason).toBe('TIMING');
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...TIMING, published_at: '2024-02-26T00:00:00Z' }), FACT_ID)).reason).toBe('TIMING');
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ published_date: '2024-02-26', published_at: null, publication_precision: 'instant', known_at: '2024-02-27T00:00:00Z' }), FACT_ID)).reason).toBe('TIMING');
  });
  it('refuses impossible dates and instant precision defects', () => {
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...TIMING, published_date: '2023-02-29' }), FACT_ID)).reason).toBe('TIMING');
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...TIMING, published_date: '0000-01-01' }), FACT_ID)).reason).toBe('TIMING');
    const instant = { ...TIMING, published_at: '2024-02-26T09:05:30Z', publication_precision: 'instant' };
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...instant, published_at: '2024-02-26T09:05:30' }), FACT_ID)).reason).toBe('TIMING');
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...instant, published_at: '2024-02-26T09:05:30.1234567Z' }), FACT_ID)).reason).toBe('TIMING');
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...instant, published_at: '2024-02-26T09:59:60Z' }), FACT_ID)).reason).toBe('TIMING');
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...instant, published_at: '2024-02-26T09:05:30+24:00' }), FACT_ID)).reason).toBe('TIMING');
  });
  it('refuses a local date that is not the instant day and a one-microsecond-late publication', () => {
    const mismatch = { published_date: '2024-02-25', published_at: '2024-02-26T09:05:30Z', publication_precision: 'instant', known_at: '2024-02-28T00:00:00Z' };
    expect(refuse(() => decodePrivateProductIntegration(timedFact(mismatch), FACT_ID)).reason).toBe('TIMING');
    const late = { published_date: '2024-02-26', published_at: '2024-02-26T20:05:30.000001+08:00', publication_precision: 'instant', known_at: '2024-02-26T12:05:30Z' };
    expect(refuse(() => decodePrivateProductIntegration(timedFact(late), FACT_ID)).reason).toBe('TIMING');
  });
  it('refuses a date-only announcement after the observed knowledge day', () => {
    expect(refuse(() => decodePrivateProductIntegration(timedFact({ ...TIMING, published_date: '2024-02-27', known_at: '2024-02-26T23:59:59.999999Z' }), FACT_ID)).reason).toBe('TIMING');
  });
  it('accepts leap dates, later observations, and offset-crossing days, preserving exact strings', () => {
    const leap = decodePrivateProductIntegration(timedFact({ published_date: '2024-02-29', published_at: null, publication_precision: 'date', known_at: '2024-03-01T00:00:00Z' }), FACT_ID);
    expect(leap.source_timing.published_date).toBe('2024-02-29');
    const crossed = decodePrivateProductIntegration(timedFact({ published_date: '2024-02-26', published_at: '2024-02-26T23:30:00.123456-05:00', publication_precision: 'instant', known_at: '2024-02-27T12:30:00.123456+08:00' }), FACT_ID);
    expect(crossed.source_timing.published_at).toBe('2024-02-26T23:30:00.123456-05:00');
    expect(crossed.source_timing.known_at).toBe('2024-02-27T12:30:00.123456+08:00');
    expect(Object.isFrozen(crossed.source_timing)).toBe(true);
  });
  it('exercises the full source correction with the corrected edition timing', () => {
    const original = decodePrivateIssuerSelections(selectionProjection([selectionEntry(FACT_ID)]), ISSUER);
    const entry = original.selections[0];
    const correctedEdition = nativeReference(PRIVATE_EDITION_SCHEMA, 'd'.repeat(64), 1024);
    const correctedSelection = decodePrivateIssuerSelections(
      selectionProjection([Object.assign({}, {
        fact_id: FACT_ID,
        fact_reference: nativeReference(PRIVATE_FACT_SCHEMA, HASH_A, 512),
        edition_reference: correctedEdition,
        kind: 'product_integration', lifecycle: 'planned',
      })]),
      ISSUER,
    );
    const correctedEntry = correctedSelection.selections[0];
    const corrected = decodePrivateProductIntegration(timedFact({
      published_date: '2024-02-27', published_at: '2024-02-27T08:00:00.000001+08:00',
      publication_precision: 'instant', known_at: '2024-02-27T00:00:00.000002Z',
    }, { edition: correctedEdition }), FACT_ID);
    assertPrivateComposition(correctedSelection, correctedEntry, corrected);
    expect(corrected.source_timing.published_date).toBe('2024-02-27');
    expect(refuse(() => assertPrivateComposition(correctedSelection, correctedEntry,
      decodePrivateProductIntegration(timedFact(TIMING, { edition: entry.edition_reference }), FACT_ID))).reason).toBe('COMPOSITION');
  });
});

describe('native timing offset parity', () => {
  it.each([
    { published_date: '2024-02-26', published_at: '2024-02-26T13:15:00.123456+05:75', publication_precision: 'instant', known_at: '2024-02-26T07:00:00.123456Z' },
    { published_date: '2024-02-27', published_at: null, publication_precision: 'date', known_at: '2024-02-26T23:30:00-00:99' },
  ])('accepts native-valid noncanonical offset minutes without rewriting $known_at', timing => {
    expect(decodePrivateProductIntegration(timedFact(timing), FACT_ID).source_timing).toEqual(timing);
  });
});


describe('timing temporal boundaries', () => {
  it.each([
    { ...TIMING, published_date: '1900-02-29' },
    { ...TIMING, published_date: '2024-04-31' },
    { ...TIMING, published_date: '2024-02-26\n' },
    { ...TIMING, known_at: '2024-02-26T09:05:30Z\n' },
    { ...TIMING, known_at: '2024-02-26T24:00:00Z' },
    { ...TIMING, known_at: '2024-02-26T12:60:00Z' },
    { ...TIMING, known_at: '2024-02-26T23:30:00+23:60' },
    { published_date: '0001-01-01', published_at: null, publication_precision: 'date', known_at: '0001-01-01T00:00:00+00:01' },
    { published_date: '9999-12-31', published_at: null, publication_precision: 'date', known_at: '9999-12-31T23:59:59-00:01' },
    { published_date: '9999-12-31', published_at: '9999-12-31T23:59:59.999999Z', publication_precision: 'instant', known_at: '9999-12-31T23:59:59.999998Z' },
  ])('refuses an impossible or out-of-order timing %#', timing => {
    expect(refuse(() => decodePrivateProductIntegration(timedFact(timing), FACT_ID)).reason).toBe('TIMING');
  });
  it.each([
    { published_date: '0001-01-01', published_at: null, publication_precision: 'date', known_at: '0001-01-01T00:00:00Z' },
    { published_date: '2000-02-29', published_at: null, publication_precision: 'date', known_at: '2000-02-29T00:00:00Z' },
    { published_date: '2024-02-27', published_at: null, publication_precision: 'date', known_at: '2024-02-26T23:30:00-02:00' },
    { published_date: '9999-12-31', published_at: '9999-12-31T23:59:59.999999Z', publication_precision: 'instant', known_at: '9999-12-31T23:59:59.999999Z' },
  ])('preserves native-valid temporal boundary %#', timing => {
    expect(decodePrivateProductIntegration(timedFact(timing), FACT_ID).source_timing).toEqual(timing);
  });
  it('keeps rejected source values out of timing errors', () => {
    const error = refuse(() => decodePrivateProductIntegration(timedFact({ ...TIMING, known_at: SECRET }), FACT_ID));
    expect(error.message).toBe('company_intelligence_private_TIMING');
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });
});
