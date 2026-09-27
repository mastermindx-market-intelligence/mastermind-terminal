import { beforeEach, describe, expect, it } from "vitest";
import {
  createFixtureDb,
  fixtureStore,
  fixtureUserId,
  resetFixtureStores,
  uuid5ThesisAlertId,
  FIXTURE_MONITOR_FIRED_TOKEN,
} from "@/lib/watchlistsFixtureDb";

// Heal round h3 REQUIRED 6: the upsert branch used to push the already-stored row onto `accepted`
// and then `this.rows.push(...accepted)`, so a clashing upsert left two entries for one ticker.

const KEY = "targets-upsert-clash";
const owner = fixtureUserId(KEY);
const db = () => createFixtureDb(KEY);

beforeEach(() => resetFixtureStores());

describe("fixture thesis monitor outbox", () => {
  it("seeds the producer's UUIDv5 alert id and payload contract", async () => {
    const vectorThesisId = "00000000-0000-0000-0000-000000000001";
    expect(uuid5ThesisAlertId(vectorThesisId)).toBe("cd85c933-6c7b-599a-9ce7-e681ded7afa5");

    const key = `${FIXTURE_MONITOR_FIRED_TOKEN}-vector`;
    const db = createFixtureDb(key);
    const result = await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: null,
      p_expected_version: 0,
      p_transition: "create",
      p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol", key: "NVDA", display: "NVDA" },
      p_content: { schema: "mastermind.thesis-content/v1", title: "closed window", statement: "s" },
      p_client_request_id: "req-monitor-vector",
      p_effective_at: null,
    });
    const thesisId = String(Array.isArray(result.data) ? result.data?.[0]?.thesis_id : null);
    const row = fixtureStore(key).alertOutbox[0];
    expect(row.alert_id).toBe(uuid5ThesisAlertId(thesisId));
    expect(row.payload).toMatchObject({
      thesis_id: thesisId,
      thesis_version: 1,
      category: "thesis_window",
      source: "macro.thesis_condition_monitor",
      subject: "Your NVDA thesis window has closed.",
      subject_zh: "你的英伟达论点观察窗口已结束。",
      summary_plain: "Your NVDA thesis window has closed.",
      summary_plain_zh: "你的英伟达论点观察窗口已结束。",
      coverage: "full",
    });
    expect((row.payload as { ticker?: string }).ticker).toBe("NVDA");
    expect(row.payload).not.toHaveProperty("kind");
  });
});

describe("fixture thesis monitor subject fidelity", () => {
  it("uses the created thesis subject", async () => {
    const key = `${FIXTURE_MONITOR_FIRED_TOKEN}-subject`;
    const db = createFixtureDb(key);
    await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: null,
      p_expected_version: 0,
      p_transition: "create",
      p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "ticker", owner: "terminal.analysis_symbol", key: "AAPL", display: "Apple" },
      p_content: { schema: "mastermind.thesis-content/v1", title: "closed window", statement: "s" },
      p_client_request_id: "req-monitor-subject",
      p_effective_at: null,
    });
    const row = fixtureStore(key).alertOutbox[0];
    expect(row.payload).toMatchObject({ subject: "Your Apple thesis window has closed.", subject_zh: "你的Apple论点观察窗口已结束。", ticker: "AAPL" });
  });
});

describe("fixture portfolio_targets upsert", () => {
  it("a clashing upsert stores one row, not two", async () => {
    const first = await db().from("portfolio_targets").upsert({
      user_id: owner,
      ticker: "AAA",
      target_weight_pct: 40,
      band_pct: 5,
    });
    expect(first.error).toBeNull();
    expect(fixtureStore(KEY).targets).toHaveLength(1);

    const second = await db().from("portfolio_targets").upsert({
      user_id: owner,
      ticker: "AAA",
      target_weight_pct: 55,
      band_pct: 8,
    });
    expect(second.error).toBeNull();
    const rows = fixtureStore(KEY).targets;
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe("AAA");
    expect(rows[0].target_weight_pct).toBe(55);
    expect(rows[0].band_pct).toBe(8);
  });
});
