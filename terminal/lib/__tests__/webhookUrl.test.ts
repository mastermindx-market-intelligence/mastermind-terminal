import { describe, expect, it } from "vitest";
import { isPrivateIp, validateWebhookUrl } from "@/lib/webhookUrl";

describe("validateWebhookUrl", () => {
  it("accepts a public https URL", () => {
    expect(validateWebhookUrl("https://hooks.example.com/mm")).toEqual({ ok: true });
  });

  it("rejects non-https schemes", () => {
    expect(validateWebhookUrl("http://example.com/hook").ok).toBe(false);
    expect(validateWebhookUrl("ftp://example.com/hook").ok).toBe(false);
  });

  it("rejects loopback, RFC1918, link-local, ULA, and cloud-metadata literals", () => {
    const bad = [
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://172.16.1.1/hook",
      "https://192.168.1.1/hook",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/hook",
      "https://[fc00::1]/hook",
      "https://[fe80::1]/hook",
    ];
    for (const url of bad) {
      expect(validateWebhookUrl(url).ok, url).toBe(false);
    }
  });

  it("rejects decimal/octal/hex IP-literal obfuscation", () => {
    expect(validateWebhookUrl("https://2130706433/hook").ok).toBe(false); // 127.0.0.1
    expect(validateWebhookUrl("https://0x7f000001/hook").ok).toBe(false);
    expect(validateWebhookUrl("https://0177.0.0.1/hook").ok).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("flags the named ranges including IPv6 loopback and ULA", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });
});
