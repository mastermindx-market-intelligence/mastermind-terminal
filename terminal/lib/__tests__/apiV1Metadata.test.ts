import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { envelope, etagFor, newApiKeySalt } from "@/lib/apiV1";
import { handleV1Get, handleV1Index, type ApiV1Deps } from "@/lib/apiV1Server";
import { openApiDocument } from "@/lib/apiV1Openapi";

const key = `mmx_${"A".repeat(40)}`;
const salt = newApiKeySalt();
const request = (tag?: string) => new Request("https://example.test/api/v1/thesis", {
  headers: { authorization: `Bearer ${key}`, ...(tag ? { "if-none-match": tag } : {}) },
});
const page = { next_cursor: null, limit: 50 };
const coverage = { rows: 1, nulls: [] };
function project(schema: string, data: unknown) {
  return envelope(`mm.api.v1.${schema}`, data, page, coverage) as any;
}
function deps(rows: Record<string, unknown>[] = [], versions = rows): ApiV1Deps {
  return { service: { rpc: async (fn, args) => {
    if (fn === "api_key_salt_for_prefix") return { data: { key_salt: salt }, error: null };
    if (fn === "api_key_authenticate") return { data: {
      user_id: "owner-a", key_id: "key-a", scopes: ["read"], limit: 60, remaining: 59,
    }, error: null };
    expect(args.p_user_id).toBe("owner-a");
    return { data: { ok: true, rows: args.p_resource === "thesis_versions" ? versions : rows }, error: null };
  } } };
}

describe("F12 read projection semantics", () => {
  it("separates actual record state from thesis assertions and opaque content", () => {
    const body = project("thesis", {
      id: "thesis-a", title: "Margin expansion", subject: { key: "AAPL", display: "Apple" },
      current: { id: "v1", content: { schema: "mm.thesis.content.v1", statement: "Margins will rise",
        catalysts: ["Launch"], risks: ["Demand"], extension: { narrative: "unknown origin" } } },
      history: [],
    });
    expect(body.schema_version).toBe("1.1");
    expect(body.inference_metadata).toMatchObject({ mode: "projection_only", generated_by_api: false,
      source_schema: body.schema, evidence_scope: "application_record_state", model_provenance: "unavailable" });
    expect(body.inference_metadata.evidence_fields).toContain("/data/id");
    expect(body.inference_metadata.assertion_fields).toEqual(expect.arrayContaining([
      "/data/title", "/data/current/content/statement", "/data/current/content/catalysts/0",
    ]));
    expect(body.inference_metadata.unclassified_fields).toContain("/data/current/content/extension");
    expect(body.inference_metadata.evidence_fields).not.toContain("/data/current/content");
  });

  it("treats a person's claim probability as an assertion, not model provenance", () => {
    const body = project("claims", [{ claim_id: "c1", claim_text: "Above 100", stated_probability: 0.7,
      evidence: [{ note: "A model may have written this" }], resolution: null }]);
    expect(body.inference_metadata.assertion_fields).toContain("/data/0/stated_probability");
    expect(body.inference_metadata.unclassified_fields).toEqual(expect.arrayContaining([
      "/data/0/evidence", "/data/0/resolution",
    ]));
    expect(JSON.stringify(body.inference_metadata)).not.toContain("A model may have written");
  });

  it("classifies watchlist membership without declaring its label a financial fact", () => {
    const body = project("watchlists", [{ id: "w1", name: "Best buys", position: 0,
      symbols: [{ symbol: "AAPL", section: "Strong conviction", position: 0 }] }]);
    expect(body.inference_metadata.evidence_fields).toContain("/data/0/symbols/0/symbol");
    expect(body.inference_metadata.unclassified_fields).toContain("/data/0/name");
    expect(body.inference_metadata.unclassified_fields).toContain("/data/0/symbols/0/section");
  });

  it.each([[], null, {}, "opaque"])("keeps empty/null/opaque data honest: %j", (data) => {
    const body = project("theses", data);
    expect(body.data).toEqual(data);
    const meta = body.inference_metadata;
    expect(meta.evidence_fields).toEqual([]);
    expect(meta.assertion_fields).toEqual([]);
    expect(meta.unclassified_fields).toEqual(["/data"]);
  });

  it("does not classify arbitrary nested values under a familiar scalar name", () => {
    const body = project("thesis", { id: { statement: "not an ID" }, title: { invented: "text" } });
    expect(body.inference_metadata.evidence_fields).toEqual([]);
    expect(body.inference_metadata.assertion_fields).toEqual([]);
    expect(body.inference_metadata.unclassified_fields).toEqual(["/data/id", "/data/title"]);
  });

  it("defaults unknown schemas to opaque and escapes unknown JSON Pointer keys", () => {
    expect(project("future", { id: "x", statement: "x" }).inference_metadata.unclassified_fields).toEqual(["/data"]);
    const body = project("thesis", { "a/b~c": { opaque: true } });
    expect(body.inference_metadata.unclassified_fields).toEqual(["/data/a~1b~0c"]);
    expect(body.data["a/b~c"]).toEqual({ opaque: true });
  });

  it("annotates the real thesis handler and only addresses existing response values", async () => {
    const rows = [{ id: "t1", current_version: 1, content: { title: "Title" }, subject_ref: { key: "AAPL" } }];
    const versions = [{ id: "v1", thesis_id: "t1", version: 1, content: { statement: "Demand rises", risks: ["Cycle"] } }];
    const response = await handleV1Get(request(), "thesis", { id: "t1" }, deps(rows, versions));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.inference_metadata.assertion_fields).toContain("/data/current/content/statement");
    expect(body.inference_metadata.assertion_fields).toContain("/data/history/0/content/statement");
    for (const pointer of [
      ...body.inference_metadata.evidence_fields, ...body.inference_metadata.assertion_fields,
      ...body.inference_metadata.unclassified_fields,
    ]) {
      let value = body;
      for (const key of pointer.slice(1).split("/").map((s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~"))) {
        expect(Object.hasOwn(value, key), pointer).toBe(true);
        value = value[key];
      }
    }
  });

  it("invalidates legacy caches, includes metadata, and ignores response-time churn", async () => {
    const response = await handleV1Get(request(), "me", {}, deps());
    const body = await response.json();
    const oldTag = etagFor({ schema: body.schema, version: body.version, data: body.data, page: body.page, coverage: body.coverage });
    const { asof: _asof, ...stable } = body;
    expect(response.headers.get("etag")).toBe(etagFor(stable));
    expect(response.headers.get("etag")).not.toBe(oldTag);
    expect((await handleV1Get(request(oldTag), "me", {}, deps())).status).toBe(200);
    expect((await handleV1Get(request(response.headers.get("etag")!), "me", {}, deps())).status).toBe(304);
  });

  it("uses the same read envelope and cache contract for the index", async () => {
    const response = await handleV1Index(request(), deps());
    const body = await response.json();
    const { asof: _asof, ...stable } = body;
    expect(body.schema_version).toBe("1.1");
    expect(body.inference_metadata.source_schema).toBe("mm.api.v1.index");
    expect(response.headers.get("etag")).toBe(etagFor(stable));
    expect((await handleV1Index(request(response.headers.get("etag")!), deps())).status).toBe(304);
  });

  it("leaves error bodies and the stored write response contract outside read metadata", async () => {
    const response = await handleV1Get(new Request("https://example.test"), "me", {}, deps());
    expect(response.status).toBe(401);
    expect(Object.keys(await response.json())).toEqual(["error"]);
    const openapi = openApiDocument();
    const getSchema = openapi.paths["/api/v1/me"].get.responses[200].content["application/json"].schema;
    expect(getSchema.required).toEqual(expect.arrayContaining(["schema_version", "inference_metadata"]));
    const postSchema = (openapi.paths["/api/v1/watchlists/{id}/symbols"].post.responses as any)[201].content["application/json"].schema;
    expect(postSchema.required).not.toContain("schema_version");
    expect(postSchema.properties.version.const).toBe("2026-10-15");
    const doc = readFileSync(join(__dirname, "../../docs/api/API_V1_CONTRACT.md"), "utf8");
    expect(doc).toContain("inference_metadata");
    expect(doc).toContain("application_record_state");
  });
});
