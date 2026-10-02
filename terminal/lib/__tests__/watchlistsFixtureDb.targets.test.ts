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
const producerPayload = (thesisId: string, subject: string, subjectZh: string, condition: string) => ({
  thesis_id: thesisId,
  thesis_version: 1,
  category: "thesis_window",
  source: "macro.thesis_condition_monitor",
  subject,
  subject_zh: subjectZh,
  summary_plain: condition
    ? subject === "A window we watch for NVDA has closed"
      ? 'A window we watch for NVDA has closed. Your thesis "Closed window" lists: Gross margin falls below 65%.'
      : 'A market condition we watch for your thesis has changed. Your thesis "Macro shift" lists: GDP growth turns negative.'
    : "A market condition we watch for your thesis has changed. Your thesis lists no conditions yet.",
  summary_plain_zh: condition
    ? subject === "A window we watch for NVDA has closed"
      ? '你关注的“NVDA”窗口已关闭。你的论点《Closed window》列出的条件：Gross margin falls below 65%（翻译待补）'
      : "你关注的一项市场条件已发生变化。你的论点《Macro shift》列出的条件：GDP growth turns negative（翻译待补）"
    : "你关注的一项市场条件已发生变化。你的论点尚未列出任何条件。",
  condition_plain: condition,
  condition_plain_zh: condition ? `${condition}（翻译待补）` : "",
  engine_window_plain: "",
  engine_window_plain_zh: "",
  evidence_url: "https://www.mastermind-x.com/cycle.html",
  requires_tier: null,
  fired_at: "2026-09-25",
  tripwire_id: "11111111-1111-4111-8111-111111111111",
  tripwire_version: 1,
  coverage: "full",
  ticker: subject === "A window we watch for NVDA has closed" ? "NVDA" : null,
});

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
    expect(row.payload).toEqual(producerPayload(
      thesisId,
      "A window we watch for NVDA has closed",
      '你关注的“NVDA”窗口已关闭',
      "Gross margin falls below 65%",
    ));
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

  it("emits the producer's generic theme subject even when a display name exists", async () => {
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
    expect(row.payload).toEqual(producerPayload(
      String(row.payload.thesis_id),
      "A market condition we watch for your thesis has changed",
      "你关注的一项市场条件已发生变化",
      "GDP growth turns negative",
    ));
  });

  it("writes a generic producer row for a registry theme without a display name", async () => {
    const key = `${FIXTURE_MONITOR_FIRED_TOKEN}-theme-no-display`;
    const db = createFixtureDb(key);
    await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: null,
      p_expected_version: 0,
      p_transition: "create",
      p_subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "theme", owner: "macro.theme_registry", key: "macro-env" },
      p_content: { schema: "mastermind.thesis-content/v1", title: "Macro shift", statement: "s", falsifiers: [] },
      p_client_request_id: "req-monitor-theme-no-display",
      p_effective_at: null,
    });
    const row = fixtureStore(key).alertOutbox[0];
    expect(row.payload).toEqual(producerPayload(
      String(row.payload.thesis_id),
      "A market condition we watch for your thesis has changed",
      "你关注的一项市场条件已发生变化",
      "",
    ));
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
