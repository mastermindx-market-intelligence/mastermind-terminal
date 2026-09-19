// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SectionDeveloper from "@/components/settings/SectionDeveloper";
import { LEX } from "@/lib/i18n";
import type { SectionProps } from "@/components/settings/types";
import { apiKeyCopy } from "@/lib/apiKeyLabels";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function props(lang: "en" | "zh"): SectionProps {
  return {
    t: makeT(lang),
    lang,
    identity: { kind: "account", userId: "user-1", email: "a@example.com" },
    email: "a@example.com",
    user: {
      id: "user-1",
      email: "a@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSignInAt: "2026-09-01T00:00:00.000Z",
      provider: "email",
      meta: {},
    },
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ACTIVE = {
  keyId: "k1",
  keyPrefix: "abcd1234",
  label: "Research laptop",
  scopes: ["read"],
  createdAt: "2026-09-13T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};
const REVOKED = { ...ACTIVE, keyId: "k2", revokedAt: "2026-09-13T01:00:00.000Z", label: "Old laptop" };

let listImpl: () => Promise<Response>;
let postImpl: () => Promise<Response>;
let revokeImpl: () => Promise<Response>;
let root: Root;
let host: HTMLDivElement;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SectionDeveloper", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    listImpl = async () => jsonRes(200, { keys: [] });
    postImpl = async () => jsonRes(201, { key: ACTIVE, secret: "mmx_" + "c".repeat(40) });
    revokeImpl = async () => jsonRes(200, { key: REVOKED });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      if (url.includes("/api/account/api-keys/") && method === "POST") return revokeImpl();
      if (url.endsWith("/api/account/api-keys") && method === "POST") return postImpl();
      return listImpl();
    }));
  });
  afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("empty state is a plain sentence in EN and ZH", async () => {
    await act(async () => { root.render(<SectionDeveloper {...props("en")} />); });
    await flush();
    await flush();
    expect(host.textContent).toContain(apiKeyCopy("empty", "en"));
    expect(host.textContent).toContain(apiKeyCopy("teamNull", "en"));
    expect(host.textContent).toContain(apiKeyCopy("truth", "en"));
    expect(host.textContent).not.toMatch(/api_keys|revoked_at|mm\.api/);

    await act(async () => { root.render(<SectionDeveloper {...props("zh")} />); });
    await flush();
    await flush();
    expect(host.textContent).toContain(apiKeyCopy("empty", "zh"));
    expect(host.textContent).toContain(apiKeyCopy("teamNull", "zh"));
  });

  it("shows the one-time secret after mint and a revoked key after revoke", async () => {
    await act(async () => { root.render(<SectionDeveloper {...props("en")} />); });
    await flush();
    await flush();
    const input = host.querySelector("#api-key-label") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Research laptop");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const mint = host.querySelector("[data-testid='api-key-mint']") as HTMLButtonElement;
    expect(mint.disabled).toBe(false);
    await act(async () => { mint.click(); });
    await flush();
    await flush();
    const secret = host.querySelector("[data-testid='api-key-secret']") as HTMLInputElement;
    expect(secret.value.startsWith("mmx_")).toBe(true);
    expect(host.textContent).toContain(apiKeyCopy("secretOnce", "en"));
  });

  it("revoked keys render the revoked sentence", async () => {
    listImpl = async () => jsonRes(200, { keys: [REVOKED] });
    await act(async () => { root.render(<SectionDeveloper {...props("en")} />); });
    await flush();
    await flush();
    await flush();
    expect(host.textContent).toContain(apiKeyCopy("revoked", "en"));
    expect(host.textContent).toContain("Old laptop");
  });
});
