import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WEBHOOK_COPY, webhookCopy, webhookRelativeTime } from "@/lib/webhookLabels";
import { WEBHOOK_ROUTE_MESSAGES } from "@/lib/webhooks";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("webhookRelativeTime English grammar", () => {
  it("uses singular minute / hour for the count 1", () => {
    expect(webhookRelativeTime(isoAgo(60_000), "en", NOW)).toBe("1 minute ago");
    expect(webhookRelativeTime(isoAgo(60 * 60_000), "en", NOW)).toBe("1 hour ago");
  });

  it("keeps the plural for counts other than 1", () => {
    expect(webhookRelativeTime(isoAgo(2 * 60_000), "en", NOW)).toBe("2 minutes ago");
    expect(webhookRelativeTime(isoAgo(2 * 60 * 60_000), "en", NOW)).toBe("2 hours ago");
  });

  it("does not emit 1 minutes ago or 1 hours ago", () => {
    expect(webhookRelativeTime(isoAgo(60_000), "en", NOW)).not.toBe("1 minutes ago");
    expect(webhookRelativeTime(isoAgo(60 * 60_000), "en", NOW)).not.toBe("1 hours ago");
  });
});

describe("webhookRelativeTime Chinese", () => {
  it("keeps 1 分钟前 / 1 小时前 without English plural", () => {
    expect(webhookRelativeTime(isoAgo(60_000), "zh", NOW)).toBe("1 分钟前");
    expect(webhookRelativeTime(isoAgo(60 * 60_000), "zh", NOW)).toBe("1 小时前");
  });
});

describe("one noun per object, and one Chinese word per object", () => {
  it("names the URL field 'Endpoint URL' / 端点地址", () => {
    expect(webhookCopy("urlLabel", "en")).toBe("Endpoint URL");
    expect(webhookCopy("urlLabel", "zh")).toBe("端点地址");
  });

  it("names the list 'Endpoints' / 端点", () => {
    expect(webhookCopy("endpoints", "en")).toBe("Endpoints");
    expect(webhookCopy("endpoints", "zh")).toBe("端点");
  });

  it("does not label two different things with the same Chinese string", () => {
    expect(webhookCopy("urlLabel", "zh")).not.toBe(webhookCopy("endpoints", "zh"));
  });
});

describe("a failure with no stated cause says only that it failed", () => {
  it("carries the save fallback in both languages", () => {
    expect(webhookCopy("saveFailed", "en")).toBe("We could not save this endpoint. Try again.");
    expect(webhookCopy("saveFailed", "zh")).toBe("无法保存该端点，请重试。");
  });

  it("carries the test-event fallback in both languages", () => {
    expect(webhookCopy("testFailed", "en")).toBe("We could not send the test event. Try again.");
    expect(webhookCopy("testFailed", "zh")).toBe("无法发送测试事件，请重试。");
  });

  it("neither fallback repeats the ssrf or turned-off sentence", () => {
    for (const key of ["saveFailed", "testFailed"] as const) {
      expect(webhookCopy(key, "en")).not.toBe(webhookCopy("ssrf", "en"));
      expect(webhookCopy(key, "en")).not.toBe(WEBHOOK_ROUTE_MESSAGES.endpoint_disabled[0]);
      expect(webhookCopy(key, "zh")).not.toBe(webhookCopy("ssrf", "zh"));
      expect(webhookCopy(key, "zh")).not.toBe(WEBHOOK_ROUTE_MESSAGES.endpoint_disabled[1]);
    }
  });
});

describe("a team-load failure is its own sentence, never the empty-team help", () => {
  it("carries the load-failed pair in both languages", () => {
    expect("teamLoadFailed" in WEBHOOK_COPY).toBe(true);
    const pair = (WEBHOOK_COPY as Record<string, readonly [string, string]>).teamLoadFailed;
    expect(pair[0]).toBe("We could not load your team right now. Try again.");
    expect(pair[1]).toBe("暂时无法读取你的团队信息，请重试。");
  });

  it("is not the empty-team help sentence", () => {
    const pair = (WEBHOOK_COPY as Record<string, readonly [string, string]>).teamLoadFailed;
    expect(pair[0]).not.toBe(webhookCopy("emptyTeamHelp", "en"));
    expect(pair[1]).not.toBe(webhookCopy("emptyTeamHelp", "zh"));
  });
});

describe("both catalogues name the object 端点, never 回调", () => {
  it("fails on any 回调 hit in WEBHOOK_COPY or WEBHOOK_ROUTE_MESSAGES", () => {
    const hits: string[] = [];
    for (const [key, pair] of Object.entries(WEBHOOK_COPY)) {
      if (pair[0].includes("回调") || pair[1].includes("回调")) hits.push(`WEBHOOK_COPY.${key}`);
    }
    for (const [key, pair] of Object.entries(WEBHOOK_ROUTE_MESSAGES)) {
      if (pair[0].includes("回调") || pair[1].includes("回调")) hits.push(`WEBHOOK_ROUTE_MESSAGES.${key}`);
    }
    expect(hits, `回调 remains in: ${hits.join(", ")}`).toEqual([]);
  });
});

describe("the zero-team empty state asks for a name instead of choosing one", () => {
  it("ships a team-name label and placeholder in both languages", () => {
    expect(webhookCopy("teamNameLabel", "en")).toBe("Team name");
    expect(webhookCopy("teamNameLabel", "zh")).toBe("团队名称");
    expect(webhookCopy("teamNamePlaceholder", "en")).toBeTruthy();
    expect(webhookCopy("teamNamePlaceholder", "zh")).toBeTruthy();
  });

  it("no copy string is a pre-chosen team name", () => {
    for (const [en, zh] of Object.values(WEBHOOK_COPY)) {
      expect(en).not.toBe("My team");
      expect(zh).not.toBe("我的团队");
    }
  });
});

describe("every copy pair is real text in both languages", () => {
  it("has a non-empty EN and ZH side, and the ZH side is not the EN side", () => {
    for (const [key, pair] of Object.entries(WEBHOOK_COPY)) {
      expect(pair[0], key).toBeTruthy();
      expect(pair[1], key).toBeTruthy();
      // urlPlaceholder is a literal example URL and is identical by design.
      if (key !== "urlPlaceholder") expect(pair[1], key).not.toBe(pair[0]);
    }
  });
});

describe("an endpoints-load failure is its own sentence, never the no-endpoints sentence", () => {
  it("carries the endpointsLoadFailed pair in both languages", () => {
    expect("endpointsLoadFailed" in WEBHOOK_COPY).toBe(true);
    const pair = (WEBHOOK_COPY as Record<string, readonly [string, string]>).endpointsLoadFailed;
    expect(pair[0]).toBe("We could not read this team's webhook endpoints just now. Please try again.");
    expect(pair[1]).toBe("暂时无法读取这个团队的 Webhook 端点，请重试。");
    expect(pair[0]).not.toBe(webhookCopy("noEndpoints", "en"));
    expect(pair[1]).not.toBe(webhookCopy("noEndpoints", "zh"));
  });
});

describe("a deliveries-load failure is its own sentence, never No deliveries yet", () => {
  it("carries the deliveriesLoadFailed pair in both languages", () => {
    expect("deliveriesLoadFailed" in WEBHOOK_COPY).toBe(true);
    const pair = (WEBHOOK_COPY as Record<string, readonly [string, string]>).deliveriesLoadFailed;
    expect(pair[0]).toBe("We could not read the delivery log for this endpoint just now.");
    expect(pair[1]).toBe("暂时无法读取这个端点的送达记录。");
    expect(pair[0]).not.toBe(webhookCopy("noDeliveries", "en"));
    expect(pair[1]).not.toBe(webhookCopy("noDeliveries", "zh"));
  });
});

describe("the mutation fallback is the route write_failed pair", () => {
  it("pins write_failed byte-for-byte so the client fallback cannot drift", () => {
    expect(WEBHOOK_ROUTE_MESSAGES.write_failed[0]).toBe("We could not save that webhook endpoint.");
    expect(WEBHOOK_ROUTE_MESSAGES.write_failed[1]).toBe("我们无法保存该 Webhook 端点。");
  });
});

describe("newly authored ZH copy addresses the user as 你, never 您", () => {
  it("forbids 您 in webhooks.ts and webhookLabels.ts", () => {
    const files = ["lib/webhooks.ts", "lib/webhookLabels.ts"];
    for (const rel of files) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src.includes("您"), `${rel} still addresses the user as 您`).toBe(false);
    }
  });

  it("pins the four seat-ordered 你 sentences", () => {
    expect(WEBHOOK_ROUTE_MESSAGES.not_signed_in[1]).toBe("你尚未登录。");
    expect(WEBHOOK_ROUTE_MESSAGES.closed_patch[1]).toBe("不允许该更改。你只能更新地址、是否启用或事件类型。");
    expect(webhookCopy("emptyTeam", "zh")).toBe("你还没有团队");
    expect(webhookCopy("memberReadOnly", "zh")).toBe(
      "你可以查看此团队的 Webhook 送达记录。只有所有者或管理员才能添加或开关端点。",
    );
  });
});
