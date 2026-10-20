import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "verified-test-session" } } }),
      getUser: async () => ({ data: { user: { id: "reader" } } }),
    },
  }),
}));

import { GET as snapshotGET } from "@/app/api/news/[symbol]/route";
import { GET as storyGET } from "@/app/api/news/stories/[storyId]/route";
import {
  parseTickerNewsChange,
  parseTickerNewsSnapshot,
  parseTickerNewsStory,
} from "@/lib/newsContract";

const row = {
  sequence: 20,
  source: "massive:reuters.com",
  source_item_id: "report-1",
  story_id: "ev2_shared",
  source_count: 2,
  item_count: 2,
  title: "Company updates acquisition consideration to $9.1 billion",
  url: "https://www.reuters.com/markets/report-1",
  teaser: "The new report retains its publisher and clocks.",
  published_at: "2026-10-20T06:00:00Z",
  updated_at: null,
  received_at: "2026-10-20T06:00:01Z",
  universe_revision: "universe-1",
};

const snapshot = (fields: Record<string, unknown> = {}) => ({
  schema: "ticker_news.snapshot.v1",
  ticker: "NVDA",
  security_id: "SEC:NVDA",
  state: "live",
  rows: [{ ...row, ...fields }],
  next_cursor: 20,
  has_more: false,
  source_health: { state: "live" },
});

const story = (fields: Record<string, unknown> = {}) => ({
  schema: "ticker_news.story.v1",
  story_id: row.story_id,
  source_count: 2,
  item_count: 2,
  members: [row, { ...row, source: "benzinga", source_item_id: "report-2" }],
  ...fields,
});

const change = {
  sequence: 8,
  kind: "upsert",
  source: row.source,
  source_item_id: row.source_item_id,
  story_id: row.story_id,
  title: row.title,
  url: row.url,
  teaser: row.teaser,
  security_ids: ["SEC:NVDA"],
  universe_revision: row.universe_revision,
  observed_at: "2026-10-20T05:59:00Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("shared news additive contract", () => {
  it("keeps old payloads usable without inventing comparison or display metadata", () => {
    expect(parseTickerNewsSnapshot(snapshot()).rows[0].reporting_state).toBe("not_compared");
    expect(parseTickerNewsStory(story()).reporting_state).toBe("not_compared");
    const parsed = parseTickerNewsChange(change);
    expect(parsed.reporting_state).toBe("not_compared");
    for (const key of ["source_count", "item_count", "published_at", "updated_at", "received_at"]) {
      expect(Object.prototype.hasOwnProperty.call(parsed, key)).toBe(false);
    }
  });

  it.each(["not_compared", "no_material_difference", "reports_differ", "comparison_limited"])(
    "preserves the authorized %s state across all three payloads",
    (reporting_state) => {
      expect(parseTickerNewsSnapshot(snapshot({ reporting_state })).rows[0].reporting_state).toBe(reporting_state);
      expect(parseTickerNewsStory(story({ reporting_state })).reporting_state).toBe(reporting_state);
      expect(parseTickerNewsChange({ ...change, reporting_state }).reporting_state).toBe(reporting_state);
    },
  );

  it.each(["verified", null, 42])("rejects malformed comparison evidence %s", (reporting_state) => {
    expect(() => parseTickerNewsSnapshot(snapshot({ reporting_state }))).toThrow(/reporting_state/);
    expect(() => parseTickerNewsStory(story({ reporting_state }))).toThrow(/reporting_state/);
    expect(() => parseTickerNewsChange({ ...change, reporting_state })).toThrow(/reporting_state/);
  });

  it("keeps current projected fields separate from the consumed journal position", () => {
    const projection = {
      source_count: 2, item_count: 3, published_at: row.published_at,
      updated_at: null, received_at: row.received_at,
    };
    const parsed = parseTickerNewsChange({ ...change, ...projection, reporting_state: "reports_differ" });
    expect(parsed).toMatchObject(projection);
    expect(parsed.sequence).toBe(8);
    expect(parsed.observed_at).toBe(change.observed_at);
    expect(parsed.source).toBe("massive:reuters.com");
  });

  it("preserves a partial projection and unknown publication clock without filling the gaps", () => {
    const parsed = parseTickerNewsChange({ ...change, published_at: null });
    expect(parsed.published_at).toBeNull();
    expect(parsed).not.toHaveProperty("source_count");
    expect(parsed).not.toHaveProperty("received_at");
  });

  it("accepts a removal with null display projection without changing its deletion semantics", () => {
    const parsed = parseTickerNewsChange({
      ...change, kind: "remove", title: "", url: "", teaser: "",
      source_count: null, item_count: null, published_at: null, updated_at: null, received_at: null,
    });
    expect(parsed.kind).toBe("remove");
    expect(parsed.item_count).toBeNull();
    expect(parsed.title).toBe("");
  });

  it.each([
    { source_count: "2" }, { item_count: 0 }, { source_count: -1 },
    { item_count: Number.MAX_SAFE_INTEGER + 1 }, { source_count: Infinity },
    { source_count: 3, item_count: 2 }, { received_at: null }, { published_at: "yesterday" },
  ])("rejects invalid active projection %j", (fields) => {
    expect(() => parseTickerNewsChange({ ...change, ...fields })).toThrow(/change_/);
  });

  it("rejects an unsafe journal cursor instead of rounding delivery progress", () => {
    expect(() => parseTickerNewsChange({ ...change, sequence: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow(/change_sequence/);
  });
});

describe("shared news through the authenticated Terminal proxy", () => {
  it("retains comparison evidence through JSON proxy and browser reparse while stripping internal scope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(snapshot({
      reporting_state: "reports_differ", reporting_sources: ["internal-only"],
    }))));
    const response = await snapshotGET(new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    const parsed = parseTickerNewsSnapshot(body);
    expect(parsed.rows[0].reporting_state).toBe("reports_differ");
    expect(parsed.rows[0].source).toBe(row.source);
    expect(body.rows[0]).not.toHaveProperty("reporting_sources");
  });

  it("retains top-level and member comparison state through the story proxy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(story({
      reporting_state: "reports_differ",
      members: story().members.map((member) => ({ ...member, reporting_state: "reports_differ" })),
    }))));
    const response = await storyGET(new Request("https://app.test/api/news/stories/ev2_shared"),
      { params: Promise.resolve({ storyId: "ev2_shared" }) });
    expect(response.status).toBe(200);
    const parsed = parseTickerNewsStory(await response.json());
    expect(parsed.reporting_state).toBe("reports_differ");
    expect(parsed.members.map((member) => member.reporting_state)).toEqual(["reports_differ", "reports_differ"]);
  });

  it("rejects invalid successful upstream comparison evidence at the proxy boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(snapshot({ reporting_state: "verified" }))));
    const response = await snapshotGET(new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "invalid_upstream_payload" });
  });
});
