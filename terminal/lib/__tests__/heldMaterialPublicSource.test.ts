import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadHeldPublicEvents } from "../../../ingest/heldMaterialEvents";
import { __resetEventWorkspaceCacheForTests } from "../eventWorkspace";
const event = JSON.parse(readFileSync(new URL("./fixtures/aapl-event-workspace.json", import.meta.url), "utf8"));
function setup(tamper = false, mixed = false) {
  const bytes = JSON.stringify(event) + "\n";
  const manifest = { schema: "event_workspace_manifest.v1", generation_id: event.generation_id, generated_at: event.generated_at, status: "ready", event_count: 1, files: { [`workspaces/${event.event_id}.json`]: { bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") } }, aliases: { [event.event_id]: event.event_id, "AAPL/2026Q3": event.event_id }, authority: "context_only", warnings: [] };
  if (mixed) {
    const otherId = "evt_cik0000794170_2026q3_results";
    manifest.files[`workspaces/${otherId}.json`] = { bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") };
    (manifest.aliases as Record<string, string>)[otherId] = otherId;
    manifest.event_count = 2;
  }
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init: RequestInit) => {
    calls.push(String(input));
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).has("apikey")).toBe(false); // no private credentials cross to R2
    return new Response(String(input).endsWith("manifest.json") ? JSON.stringify(manifest) : (tamper ? bytes.replace("Apple", "Altered") : bytes));
  }));
  return calls;
}
beforeEach(() => __resetEventWorkspaceCacheForTests());
afterEach(() => vi.unstubAllGlobals());
describe("held event public source uses the real verified reader", () => {
  it("reads a closed immutable event with no private membership input", async () => {
    const calls = setup(); const rows = await loadHeldPublicEvents();
    expect(rows).toHaveLength(1); expect(rows[0].event_id).toBe(event.event_id);
    expect(calls.every(url => url.startsWith("https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev/company_intelligence/event_workspaces/"))).toBe(true);
    expect(calls.some(url => url.includes(`/generations/${event.generation_id}/workspaces/`))).toBe(true);
  });
  it("rejects tampered immutable bytes before they reach the private join", async () => {
    setup(true); await expect(loadHeldPublicEvents()).rejects.toThrow("held_source_unverified");
  });
  it("an invalid issuer never enters the join while independently verified issuer coverage remains usable", async () => {
    setup(false, true); const rows = await loadHeldPublicEvents();
    expect(rows.map(row => row.event_id)).toEqual([event.event_id]);
  });
  it("fails closed on unavailable discovery", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(loadHeldPublicEvents()).rejects.toThrow("held_source_unavailable");
  });
});
