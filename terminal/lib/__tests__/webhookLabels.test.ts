import { describe, expect, it } from "vitest";
import { WEBHOOK_COPY, webhookCopy, webhookRelativeTime } from "@/lib/webhookLabels";

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
      expect(webhookCopy(key, "en")).not.toBe(webhookCopy("testDisabled", "en"));
      expect(webhookCopy(key, "zh")).not.toBe(webhookCopy("ssrf", "zh"));
      expect(webhookCopy(key, "zh")).not.toBe(webhookCopy("testDisabled", "zh"));
    }
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
