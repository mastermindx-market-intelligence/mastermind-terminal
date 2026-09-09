import { describe, expect, it } from "vitest";
import { deliverOne, type DeliveryRow, type EndpointRow } from "../../../ingest/webhook_delivery";
import {
  WEBHOOK_DELIVERY_STATUS_LABEL,
  WEBHOOK_NOT_SENT_STATUS,
  webhookCauseLabel,
  webhookDeliveryStatusLabel,
} from "@/lib/webhookLabels";

type Patch = { path: string; body: Record<string, unknown> };

function recorder(): { patches: Patch[]; patch: (p: string, b: Record<string, unknown>) => Promise<unknown[]> } {
  const patches: Patch[] = [];
  return {
    patches,
    patch: async (path, body) => {
      patches.push({ path, body });
      return [{ id: "d1" }];
    },
  };
}

const ROW: DeliveryRow = {
  id: "d1",
  endpoint_id: "ep-1",
  team_id: "team-1",
  event_id: "e1",
  event_type: "webhook.test",
  payload: { schema: "mastermind.webhook-test/v1" },
  attempt: 1,
  status: "retrying",
  claimed_at: null,
  next_retry_at: null,
};

const ENDPOINT: EndpointRow = {
  id: "ep-1",
  url: "https://hooks.example.com/mastermind",
  secret: "not-a-real-secret",
  enabled: true,
};

describe("a delivery abandoned without exhausting the retry table is never `failed`", () => {
  it("a turned-off endpoint writes not_sent_disabled, not failed", async () => {
    const supa = recorder();
    await deliverOne(supa, ROW, { ...ENDPOINT, enabled: false }, false);
    expect(supa.patches).toHaveLength(1);
    expect(supa.patches[0].body.status).toBe("not_sent_disabled");
    expect(supa.patches[0].body.last_error).toBe("endpoint_disabled");
    expect(supa.patches[0].body.next_retry_at).toBeNull();
    for (const p of supa.patches) expect(p.body.status).not.toBe("failed");
  });

  it("a saved address that no longer validates writes not_sent_invalid_url, not failed", async () => {
    const supa = recorder();
    await deliverOne(supa, ROW, { ...ENDPOINT, url: "http://hooks.example.com/mastermind" }, false);
    expect(supa.patches).toHaveLength(1);
    expect(supa.patches[0].body.status).toBe("not_sent_invalid_url");
    expect(supa.patches[0].body.last_error).toBe("not_https");
    expect(supa.patches[0].body.next_retry_at).toBeNull();
    for (const p of supa.patches) expect(p.body.status).not.toBe("failed");
  });

  it("a private address in the saved URL also writes not_sent_invalid_url", async () => {
    const supa = recorder();
    await deliverOne(supa, ROW, { ...ENDPOINT, url: "https://127.0.0.1/hook" }, false);
    expect(supa.patches[0].body.status).toBe("not_sent_invalid_url");
    expect(supa.patches[0].body.last_error).toBe("private_address");
  });

  it("neither non-exhaustion path claims the row or sends anything", async () => {
    const supa = recorder();
    await deliverOne(supa, ROW, { ...ENDPOINT, enabled: false }, false);
    expect(supa.patches.some((p) => p.path.includes("status=in."))).toBe(false);
    expect(supa.patches.some((p) => p.body.status === "delivering")).toBe(false);
  });
});

describe("every delivery status has a plain label in both languages", () => {
  const statuses = Object.keys(WEBHOOK_DELIVERY_STATUS_LABEL);

  it("covers the seven statuses the worker and the migration allow", () => {
    expect(statuses.sort()).toEqual(
      [
        "delivered",
        "delivering",
        "failed",
        "not_sent_disabled",
        "not_sent_invalid_url",
        "pending",
        "retrying",
      ].sort(),
    );
  });

  it("labels the two not-sent statuses exactly as ruled", () => {
    expect(webhookDeliveryStatusLabel("not_sent_disabled", "en")).toBe("Not sent — endpoint turned off");
    expect(webhookDeliveryStatusLabel("not_sent_disabled", "zh")).toBe("未发送：端点已关闭");
    expect(webhookDeliveryStatusLabel("not_sent_invalid_url", "en")).toBe("Not sent — address no longer valid");
    expect(webhookDeliveryStatusLabel("not_sent_invalid_url", "zh")).toBe("未发送：地址已失效");
  });

  it("keeps the attempt count on `failed` alone", () => {
    expect(webhookDeliveryStatusLabel("failed", "en")).toBe("Gave up after 5 tries");
    expect(webhookDeliveryStatusLabel("failed", "zh")).toBe("已重试 5 次后放弃");
    for (const status of WEBHOOK_NOT_SENT_STATUS) {
      expect(webhookDeliveryStatusLabel(status, "en")).not.toContain("5 tries");
      expect(webhookDeliveryStatusLabel(status, "zh")).not.toContain("5 次");
    }
  });

  it("never renders the raw status value", () => {
    for (const status of statuses) {
      expect(webhookDeliveryStatusLabel(status, "en")).not.toBe(status);
      expect(webhookDeliveryStatusLabel(status, "zh")).not.toBe(status);
      expect(webhookDeliveryStatusLabel(status, "zh")).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });
});

describe("every last_error code the worker writes has a plain sentence", () => {
  // Exactly the codes ingest/webhook_delivery.ts can put in last_error.
  const codes = [
    "endpoint_disabled",
    "not_https",
    "private_address",
    "invalid_url",
    "dns_failed",
    "timeout",
    "network",
    "bad_retry_timestamp",
  ];

  it("returns a real sentence in both languages, never the code", () => {
    for (const code of codes) {
      const en = webhookCauseLabel(code, "en");
      const zh = webhookCauseLabel(code, "zh");
      expect(en, code).not.toContain(code);
      expect(zh, code).not.toContain(code);
      expect(en, code).toMatch(/^[A-Z].*\.$/);
      expect(zh, code).toMatch(/。$/);
      expect(zh, code).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });

  it("turns an http status class into a sentence, not a bare code", () => {
    expect(webhookCauseLabel("http 500", "en")).toBe("The endpoint answered with error code 500.");
    expect(webhookCauseLabel("http 500", "zh")).toBe("端点返回了错误代码 500。");
    expect(webhookCauseLabel("http 404", "en")).toContain("404");
  });

  it("falls back to a plain sentence for an unknown code", () => {
    expect(webhookCauseLabel("something_new", "en")).toBe("We could not send this event.");
    expect(webhookCauseLabel("something_new", "zh")).toBe("我们无法发送这条事件。");
    expect(webhookCauseLabel("http 0", "en")).toBe("We could not send this event.");
  });

  it("is empty when there is no cause to show", () => {
    expect(webhookCauseLabel(null, "en")).toBe("");
    expect(webhookCauseLabel("", "zh")).toBe("");
    expect(webhookCauseLabel("   ", "en")).toBe("");
  });
});
