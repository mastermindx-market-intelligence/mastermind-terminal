import { beforeEach, describe, expect, it } from "vitest";
import {
  createFixtureDb,
  fixtureStore,
  fixtureUserId,
  producerThesisFireEventId,
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
    expect(producerThesisFireEventId(
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111",
      1,
      "2026-09-25",
    )).toBe("thesis:18604d1b8f57758f6d192a2259fd97af");

    const key = `${FIXTURE_MONITOR_FIRED_TOKEN}-vector`;
    const db = createFixtureDb(key);
    const result = await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: null,
      p_expected_version: 0,
      p_transition: "create",
      p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol", key: "NVDA", display: "NVDA" },
      p_content: { schema: "mastermind.thesis-content/v1", title: "Closed window", statement: "s", falsifiers: ["Gross margin falls below 65%"] },
      p_client_request_id: "req-monitor-vector",
      p_effective_at: null,
    });
    const thesisId = String(Array.isArray(result.data) ? result.data?.[0]?.thesis_id : null);
    const row = fixtureStore(key).alertOutbox[0];
    expect(row.alert_id).toBe(uuid5ThesisAlertId(thesisId));
    expect(row.fire_event_id).toBe(producerThesisFireEventId(thesisId, "11111111-1111-4111-8111-111111111111", 1, "2026-09-25"));
    expect(row.fire_event_id).toMatch(/^thesis:[0-9a-f]{32}$/);
    expect(row.payload).toMatchObject({
      thesis_id: thesisId,
      thesis_version: 1,
      category: "thesis_window",
      source: "macro.thesis_condition_monitor",
      subject: "A window we watch for NVDA has closed",
      subject_zh: '你关注的“NVDA”窗口已关闭',
      summary_plain: 'A window we watch for NVDA has closed. Your thesis "Closed window" lists: Gross margin falls below 65%.',
      summary_plain_zh: '你关注的“NVDA”窗口已关闭。你的论点《Closed window》列出的条件：Gross margin falls below 65%（翻译待补）',
      condition_plain: 'Gross margin falls below 65%',
      condition_plain_zh: 'Gross margin falls below 65%（翻译待补）',
      evidence_url: 'https://www.mastermind-x.com/cycle.html',
      coverage: "full",
      ticker: "NVDA",
    });
    expect(row.channel).toBe("email");
    expect(row.payload).not.toHaveProperty("kind");
  });
});

describe("fixture thesis monitor subject fidelity", () => {
  it("writes no producer row for an unowned theme without a label", async () => {
    const key = `${FIXTURE_MONITOR_FIRED_TOKEN}-subject-key`;
    const db = createFixtureDb(key);
    await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: null,
      p_expected_version: 0,
      p_transition: "create",
      p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "theme", owner: "macro.user_topic", key: "macro-env" },
      p_content: { schema: "mastermind.thesis-content/v1", title: "Macro shift", statement: "s", falsifiers: ["GDP growth turns negative"] },
      p_client_request_id: "req-monitor-subject-key",
      p_effective_at: null,
    });
    expect(fixtureStore(key).alertOutbox).toHaveLength(0);
  });

  it("emits ticker: null for a theme subject (no issuer mapping)", async () => {
    const key = `${FIXTURE_MONITOR_FIRED_TOKEN}-theme`;
    const db = createFixtureDb(key);
    await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: null,
      p_expected_version: 0,
      p_transition: "create",
      p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "theme", owner: "macro.theme_registry", key: "macro-env", display: "Macro environment" },
      p_content: { schema: "mastermind.thesis-content/v1", title: "Macro shift", statement: "s", falsifiers: ["GDP growth turns negative"] },
      p_client_request_id: "req-monitor-theme",
      p_effective_at: null,
    });
    const row = fixtureStore(key).alertOutbox[0];
    expect(row.payload).toMatchObject({
      subject: "A window we watch for Macro environment has closed",
      subject_zh: '你关注的“Macro environment”窗口已关闭',
      ticker: null,
    });
  });

  it("uses the uppercase ticker and emits it for issuer subjects", async () => {
    const key = `${FIXTURE_MONITOR_FIRED_TOKEN}-subject`;
    const db = createFixtureDb(key);
    await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: null,
      p_expected_version: 0,
      p_transition: "create",
      p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol", key: "AAPL", display: "Apple" },
      p_content: { schema: "mastermind.thesis-content/v1", title: "Closed window", statement: "s", falsifiers: ["Revenue growth stops"] },
      p_client_request_id: "req-monitor-subject",
      p_effective_at: null,
    });
    const row = fixtureStore(key).alertOutbox[0];
    expect(row.payload).toMatchObject({
      subject: "A window we watch for AAPL has closed",
      subject_zh: '你关注的“AAPL”窗口已关闭',
      ticker: "AAPL",
    });
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
