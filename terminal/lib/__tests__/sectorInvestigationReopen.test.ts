/**
 * SP14 — saved-investigation reopen against the transport seam. FIXTURE results: the transport is a
 * stand-in classified from lane 1's wire table. The committed current lane-1 sample is SHA-256
 * dbb09959b4feaaf849ea369f667c34b2e390f3b12e5c509b1e86daedf8a49d80, produced by Macro
 * badb9ae1cfe458f98cef41fe8b988b627db36a07 with injected identity/clock and a throwaway signing key.
 * No served-route, entitlement or deployment proof.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  captureIdentityOf, contextRefIsDurable, reopenCurrent, reopenOriginal, sameCaptureIdentity, savedSectorCaptures,
  sectorEvidenceFromRead, type SectorPopulationRead, type SectorReopenTransport, type TransportAnswer,
} from "../sectorInvestigationReopen";
import { validateInvestigationManifest } from "../investigationContracts";
import { INVESTIGATION_ADMISSION } from "../investigations";

const sample = JSON.parse(readFileSync(new URL("./fixtures/sector_generation_v11_page1.json", import.meta.url), "utf8")) as SectorPopulationRead;
const latestOther: SectorPopulationRead = JSON.parse(JSON.stringify(sample));
(latestOther.page!.capture!.owner_ref as Record<string, unknown>).generation_id = "real-g2";
(latestOther.page!.capture!.owner_ref as Record<string, unknown>).content_id = "c".repeat(64);

function transport(answers: { ctx?: TransportAnswer; ident?: TransportAnswer | null; current?: TransportAnswer }) {
  const calls: string[] = [];
  const t: SectorReopenTransport = {
    openByContextRef: async (ref) => { calls.push("ctx:" + ref.slice(0, 6)); return answers.ctx ?? { kind: "original_unavailable" }; },
    openCurrent: async () => { calls.push("current"); return answers.current ?? { kind: "ok", body: latestOther }; },
  };
  if (answers.ident !== null && answers.ident !== undefined) t.openByIdentity = async () => { calls.push("identity"); return answers.ident!; };
  return { t, calls };
}
const saved = captureIdentityOf(sample)!;
const hint = sample.page!.context_ref as string;

describe("capture identity and the saved reference", () => {
  it("lane-1 sample yields the durable identity and the saved evidence ref validates as v3", () => {
    expect(saved.generation_id).toBe("real-g1");
    expect(saved.content_id).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(saved.member_sha256!).length).toBeGreaterThan(0);
    const ref = sectorEvidenceFromRead(sample, { type: "basket_observation", id: "b-us_defensives" })!;
    expect(ref).toMatchObject({ version_ref: "real-g1", fingerprint: saved.content_id, member_sha256: saved.member_sha256, context_ref: hint });
    const manifest = { schema: "investigation_manifest.v3", intent: { title: "Defensives", question: "Still leading?", subjects: [] }, layout_refs: [], thesis_refs: [], evidence_refs: [ref], continuation: {} };
    expect(validateInvestigationManifest(manifest, INVESTIGATION_ADMISSION).ok).toBe(true);
    expect(savedSectorCaptures(manifest as never)[0].identity).toEqual(saved);
  });
  it("a read without a capture identity yields no reference (nothing invented)", () => {
    expect(sectorEvidenceFromRead({ page: {} }, { type: "sector_observation", id: "xlf" })).toBeNull();
  });
  it("context_ref is durable only on the owner's explicit statement", () => {
    expect(contextRefIsDurable({ retained_resolver_ref_durability: "durable" })).toBe(true);
    expect(contextRefIsDurable({ retained_resolver_ref_durability: "process_lifetime_only" })).toBe(false);
    expect(contextRefIsDurable({})).toBe(false);
    expect(contextRefIsDurable(undefined)).toBe(false);
  });
});

describe("reopenOriginal never substitutes the latest", () => {
  it("opens the retained capture by the stored hint when the answer matches the saved identity", async () => {
    const { t, calls } = transport({ ctx: { kind: "ok", body: sample } });
    const result = await reopenOriginal(saved, hint, t);
    expect(result).toMatchObject({ state: "original", via: "context_ref", identity: saved });
    expect(calls).toEqual(["ctx:" + hint.slice(0, 6)]);
  });
  it("reports whether the hint is durable only from the capture's own statement", async () => {
    const durable: SectorPopulationRead = JSON.parse(JSON.stringify(sample));
    (durable.page!.capture!.owner_ref as Record<string, unknown>).retained_resolver_ref_durability = "durable";
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: durable } }).t)).toMatchObject({ contextRefDurable: true });
    const process = JSON.parse(JSON.stringify(sample)) as SectorPopulationRead;
    (process.page!.capture!.owner_ref as Record<string, unknown>).retained_resolver_ref_durability = "process_lifetime_only";
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: process } }).t)).toMatchObject({ contextRefDurable: false });
  });
  it("404 ORIGINAL_UNAVAILABLE with no identity path is original_unavailable and never calls the current path", async () => {
    const { t, calls } = transport({ ctx: { kind: "original_unavailable" } });
    expect(await reopenOriginal(saved, hint, t)).toEqual({ state: "original_unavailable", reason: "reference_not_recognised" });
    expect(calls).not.toContain("current");
  });
  it("a stale or restarted-process token (404 or 409) falls through to the durable identity path, if the owner offers one", async () => {
    for (const ctx of [{ kind: "original_unavailable" }, { kind: "cursor_reset", reason: "signature_unrecognised" }] as TransportAnswer[]) {
      const { t, calls } = transport({ ctx, ident: { kind: "ok", body: sample } });
      expect(await reopenOriginal(saved, hint, t)).toMatchObject({ state: "original", via: "identity" });
      expect(calls).toEqual(["ctx:" + hint.slice(0, 6), "identity"]);
    }
  });
  it("bytes gone on both paths is bytes_not_retained, never the latest", async () => {
    const { t, calls } = transport({ ctx: { kind: "original_unavailable" }, ident: { kind: "original_unavailable" } });
    expect(await reopenOriginal(saved, hint, t)).toEqual({ state: "original_unavailable", reason: "bytes_not_retained" });
    expect(calls).not.toContain("current");
  });
  it("HTTP 200 for a DIFFERENT capture (the latest) is refused as identity_mismatch", async () => {
    const { t, calls } = transport({ ctx: { kind: "ok", body: latestOther } });
    expect(await reopenOriginal(saved, hint, t)).toEqual({ state: "original_unavailable", reason: "identity_mismatch" });
    expect(calls).not.toContain("current");
  });
  it("same generation and content id but a different member sha256 set is refused", async () => {
    const tampered = JSON.parse(JSON.stringify(sample)) as SectorPopulationRead;
    const members = (tampered.page!.capture!.owner_ref as Record<string, Record<string, string>>).member_sha256;
    members[Object.keys(members)[0]] = "d".repeat(64);
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: tampered } }).t)).toEqual({ state: "original_unavailable", reason: "identity_mismatch" });
    expect(sameCaptureIdentity(saved, captureIdentityOf(tampered))).toBe(false);
  });
  it("without a stored hint it uses the identity path or reports no_resolver_path", async () => {
    expect(await reopenOriginal(saved, null, transport({}).t)).toEqual({ state: "original_unavailable", reason: "no_resolver_path" });
    expect(await reopenOriginal(saved, null, transport({ ident: { kind: "ok", body: sample } }).t)).toMatchObject({ state: "original", via: "identity" });
  });
  it("no saved reference, signed-out, denied and transport errors keep distinct states", async () => {
    expect(await reopenOriginal(null, hint, transport({}).t)).toEqual({ state: "original_unavailable", reason: "no_saved_reference" });
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "signed_out" } }).t)).toEqual({ state: "signed_out" });
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "denied" } }).t)).toEqual({ state: "original_unavailable", reason: "denied" });
    // A network/5xx answer is inconclusive and retryable: it is NOT proof the original is gone.
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "error" } }).t)).toEqual({ state: "retry", reason: "transport_error" });
  });
});

describe("current opens separately", () => {
  it("is labelled current and carries the latest identity, which differs from the saved original", async () => {
    const result = await reopenCurrent(transport({}).t);
    expect(result).toMatchObject({ state: "current", identity: { generation_id: "real-g2" } });
    if (result.state !== "current") throw new Error("expected current");
    expect(sameCaptureIdentity(saved, result.identity)).toBe(false);
  });
  it("a current-read failure is retryable and never presented as an original", async () => {
    expect(await reopenCurrent(transport({ current: { kind: "error" } }).t)).toEqual({ state: "retry", reason: "transport_error" });
  });
});

describe("identity is strict (reviewer S2/S3: each mutant of the identity check must fail a test)", () => {
  const clone = () => JSON.parse(JSON.stringify(sample)) as SectorPopulationRead;
  const owner = (body: SectorPopulationRead) => body.page!.capture!.owner_ref as Record<string, unknown>;

  it("same generation with a DIFFERENT content_id is identity_mismatch", async () => {
    const sameGenerationOtherContent = clone();
    owner(sameGenerationOtherContent).content_id = "e".repeat(64);
    expect(captureIdentityOf(sameGenerationOtherContent)!.generation_id).toBe(saved.generation_id);
    expect(sameCaptureIdentity(saved, captureIdentityOf(sameGenerationOtherContent))).toBe(false);
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: sameGenerationOtherContent } }).t)).toEqual({ state: "original_unavailable", reason: "identity_mismatch" });
  });
  it("the saved member set plus ONE extra member is identity_mismatch", async () => {
    const superset = clone();
    // "zz/…" sorts AFTER every saved key, so the saved keys are a strict prefix of the answered keys:
    // only the member-count comparison can tell the sets apart (a key-by-key walk of the saved keys cannot).
    (owner(superset).member_sha256 as Record<string, string>)["zz/extra-member.json"] = "f".repeat(64);
    expect([...Object.keys(saved.member_sha256!)].every(key => key < "zz/extra-member.json")).toBe(true);
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: superset } }).t)).toEqual({ state: "original_unavailable", reason: "identity_mismatch" });
    const middle = clone();
    (owner(middle).member_sha256 as Record<string, string>)["extra/member.json"] = "f".repeat(64);
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: middle } }).t)).toEqual({ state: "original_unavailable", reason: "identity_mismatch" });
    // and a saved set that is a superset of the answer is refused too
    const subset = clone();
    delete (owner(subset).member_sha256 as Record<string, string>)[Object.keys(saved.member_sha256!)[0]];
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: subset } }).t)).toEqual({ state: "original_unavailable", reason: "identity_mismatch" });
  });
  it("durability process_lifetime_only is NOT durable, whatever else the owner_ref says", async () => {
    for (const value of ["process_lifetime_only", "", undefined, null, "Durable", true]) {
      expect(contextRefIsDurable({ retained_resolver_ref_durability: value as never })).toBe(false);
    }
    const processOnly = clone();
    owner(processOnly).retained_resolver_ref_durability = "process_lifetime_only";
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: processOnly } }).t)).toMatchObject({ state: "original", contextRefDurable: false });
  });
  it("S2: a member entry that is not a sha256 string, or whose key fails the grammar, makes the answer carry NO identity", async () => {
    const malformed: Array<[string, unknown]> = [
      ["non-string value", 5], ["null value", null], ["short digest", "abc"], ["uppercase digest", "A".repeat(64)], ["object value", { a: 1 }],
    ];
    for (const [label, value] of malformed) {
      const extra = clone();
      (owner(extra).member_sha256 as Record<string, unknown>)["m2.json"] = value;
      expect(captureIdentityOf(extra), label).toBeNull();
      expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: extra } }).t), label).toEqual({ state: "original_unavailable", reason: "identity_mismatch" });
    }
    // a "__proto__" own key (JSON.parse creates it as an own property) fails the grammar, never silently dropped
    const proto = clone();
    owner(proto).member_sha256 = JSON.parse(`{${Object.entries(saved.member_sha256!).map(([k, v]) => JSON.stringify(k) + ":" + JSON.stringify(v)).join(",")},"__proto__":"${"e".repeat(64)}"}`);
    expect(captureIdentityOf(proto)).toBeNull();
    expect(await reopenOriginal(saved, hint, transport({ ctx: { kind: "ok", body: proto } }).t)).toEqual({ state: "original_unavailable", reason: "identity_mismatch" });
    // a key outside the MEMBER_PATH grammar
    const badKey = clone();
    (owner(badKey).member_sha256 as Record<string, string>)["../escape"] = "f".repeat(64);
    expect(captureIdentityOf(badKey)).toBeNull();
    // a non-object member set
    const notObject = clone();
    owner(notObject).member_sha256 = ["f".repeat(64)];
    expect(captureIdentityOf(notObject)).toBeNull();
  });
});

describe("N4: a rejected transport promise is inconclusive, never a fallback", () => {
  it("a thrown/rejected openByContextRef (network, or a 2xx whose body does not parse) becomes retry", async () => {
    for (const failure of [new Error("net"), new SyntaxError("Unexpected end of JSON input")]) {
      const calls: string[] = [];
      const t: SectorReopenTransport = {
        openByContextRef: async () => { throw failure; },
        openCurrent: async () => { calls.push("current"); return { kind: "ok", body: latestOther }; },
      };
      expect(await reopenOriginal(saved, hint, t)).toEqual({ state: "retry", reason: "transport_error" });
      expect(calls).toEqual([]); // the current path is never consulted
    }
  });
  it("a rejected openByIdentity becomes retry too, and a rejected openCurrent is retry (never an original)", async () => {
    const t: SectorReopenTransport = {
      openByContextRef: async () => ({ kind: "original_unavailable" }),
      openByIdentity: async () => { throw new Error("net"); },
      openCurrent: async () => { throw new Error("net"); },
    };
    expect(await reopenOriginal(saved, hint, t)).toEqual({ state: "retry", reason: "transport_error" });
    expect(await reopenCurrent(t)).toEqual({ state: "retry", reason: "transport_error" });
  });
  it("a 200 with an empty body, classified by lane 3's hunk WITH the catch, is retry end to end", async () => {
    const classify = async (res: Response): Promise<TransportAnswer> => {
      if (res.ok) { const body = await res.json().catch(() => null); return body ? { kind: "ok", body } : { kind: "error" }; }
      return { kind: "error" };
    };
    const t: SectorReopenTransport = {
      openByContextRef: async () => classify(new Response("", { status: 200 })),
      openCurrent: async () => classify(new Response("{}", { status: 200 })),
    };
    expect(await reopenOriginal(saved, hint, t)).toEqual({ state: "retry", reason: "transport_error" });
  });
});

