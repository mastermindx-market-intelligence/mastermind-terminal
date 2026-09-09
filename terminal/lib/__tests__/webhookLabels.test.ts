import { describe, expect, it } from "vitest";
import { webhookRelativeTime } from "@/lib/webhookLabels";

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
