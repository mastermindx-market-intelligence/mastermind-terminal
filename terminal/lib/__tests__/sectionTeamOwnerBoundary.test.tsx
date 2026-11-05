// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectionTeam from "@/components/settings/SectionTeam";
import { accountIdentity, GUEST_IDENTITY, type AccountIdentity } from "@/lib/accountIdentity";
import { LEX } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = "11111111-2222-4333-8444-555555555555";
const B = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const t = (key: string, fallback?: string) => LEX[key]?.[0] ?? fallback ?? key;
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function bodyFor(url: string, owner: string) {
  if (url === "/api/teams") return { teams: [{ id: owner, name: owner === A ? "Alpha desk" : "Beta desk" }] };
  if (url.endsWith("/members")) return {
    callerRole: owner === A ? "owner" : "member",
    members: [{ userId: owner, role: owner === A ? "owner" : "member", displayName: owner === A ? "Alpha person" : "Beta person" }],
  };
  if (url.endsWith("/settings")) return { settings: [
    { key: "default_chart_theme", value: owner === A ? "red_up" : "green_up" },
    { key: "share_layouts_by_default", value: owner === A },
  ] };
  return { invites: [{ id: "alpha-invite", email: "alpha@example.com", role: "member" }] };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(identity: AccountIdentity) {
  await act(async () => root.render(<SectionTeam identity={identity} email="same@example.com" lang="en" t={t}
    // Deliberately stale/optional profile: ownership must come from identity.
    user={{ id: A, email: "same@example.com" } as never}
    onClose={() => {}} onPatchMeta={() => {}} onRefreshUser={async () => {}} />));
}
const text = () => container.textContent ?? "";
const live = () => container.querySelector('[data-testid="team-live"]')!;

describe("Team canonical owner boundary", () => {
  const stages = ["teams", "members", "invitations", "settings"] as const;
  for (const stage of stages) for (const boundary of ["fetch", "json"] as const) for (const outcome of ["success", "error"] as const) {
    it(`ignores A ${stage} ${boundary} ${outcome} while B is pending, then shows only B`, async () => {
      let requesting = A;
      const old = deferred<unknown>();
      const next = deferred<unknown>();
      const calls: string[] = [];
      let heldUrl = "";
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const owner = requesting;
        calls.push(`${owner} ${url}`);
        const match = stage === "teams" ? url === "/api/teams" : stage === "invitations" ? url.includes("/invitations?") : url.endsWith(`/${stage}`);
        if (owner === A && match) {
          heldUrl = url;
          if (boundary === "json") return { ok: true, status: 200, json: () => old.promise } as Response;
          return old.promise;
        }
        if (owner === B && url === "/api/teams") return { ok: true, status: 200, json: () => next.promise } as Response;
        return response(bodyFor(url, owner));
      }));
      await render(accountIdentity(A, "same@example.com"));
      expect(heldUrl).not.toBe("");
      requesting = B;
      await render(accountIdentity(B, "same@example.com"));
      expect(text()).not.toMatch(/Alpha|alpha@example/);
      expect(live().getAttribute("data-team-id")).toBe("");
      expect(live().getAttribute("data-caller-role")).toBe("");
      const count = calls.length;
      await act(async () => {
        if (outcome === "error") old.reject(new Error("old read failed"));
        else old.resolve(boundary === "json" ? bodyFor(heldUrl, A) : response(bodyFor(heldUrl, A)));
      });
      expect(calls).toHaveLength(count);
      expect(text()).not.toMatch(/Alpha|alpha@example/);
      expect(live().getAttribute("data-caller-role")).toBe("");
      await act(async () => next.resolve(bodyFor("/api/teams", B)));
      expect(text()).toContain("Beta desk");
      expect(text()).toContain("Beta person");
      expect(text()).not.toMatch(/Alpha|alpha@example/);
      expect(live().getAttribute("data-caller-role")).toBe("member");
      expect(container.querySelector(`[data-user-id="${B}"]`)?.textContent).toContain(LEX.acsTeamYou[0]);
      expect(container.querySelector('[data-testid="team-settings-readonly"]')?.textContent).toContain("Green");
      expect(container.querySelector('[data-testid="team-change-role"]')).toBeNull();
    });
  }

  it("drops a settled owner's roster on sign-out without reading or offering team creation", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => response(bodyFor(String(input), A)));
    vi.stubGlobal("fetch", fetch);
    await render(accountIdentity(A, "same@example.com"));
    expect(text()).toContain("Alpha desk");
    const count = fetch.mock.calls.length;
    await render(GUEST_IDENTITY);
    expect(text()).not.toMatch(/Alpha|alpha@example/);
    expect(fetch).toHaveBeenCalledTimes(count);
    expect(container.querySelector('[data-testid="team-create"]')).toBeNull();
    expect(container.querySelector('[data-testid="team-settings"]')).toBeNull();
  });

  it("keeps the same account's loaded state when only its display email changes", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => response(bodyFor(String(input), A)));
    vi.stubGlobal("fetch", fetch);
    await render(accountIdentity(A, "before@example.com"));
    const count = fetch.mock.calls.length;
    await render(accountIdentity(A, "after@example.com"));
    expect(text()).toContain("Alpha desk");
    expect(fetch).toHaveBeenCalledTimes(count);
  });

  it("accepts independent settings writes in either response order", async () => {
    const chart = deferred<Response>();
    const share = deferred<Response>();
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const { key } = JSON.parse(String(init.body));
        writes.push(key);
        return key === "default_chart_theme" ? chart.promise : share.promise;
      }
      return response(bodyFor(String(input), A));
    }));
    await render(accountIdentity(A));
    const select = container.querySelector('[data-testid="team-settings-chart"]') as HTMLSelectElement;
    const checkbox = container.querySelector('[data-testid="team-settings-share"] input') as HTMLInputElement;
    await act(async () => {
      select.value = "green_up";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => checkbox.click());
    expect(writes).toEqual(["default_chart_theme", "share_layouts_by_default"]);
    expect(select.disabled).toBe(true);
    expect(checkbox.disabled).toBe(true);
    await act(async () => share.resolve(response({})));
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    expect(select.disabled).toBe(true);
    await act(async () => chart.resolve(response({})));
    expect(select.value).toBe("green_up");
    expect(checkbox.checked).toBe(false);
  });

  it("an old settings PATCH cannot overwrite a completed same-team reload", async () => {
    const patch = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return patch.promise;
      if (init?.method === "POST") return response({ inviteUrl: "https://example.invalid/one-time", invite: { email: "fixture@example.com" } });
      return response(bodyFor(String(input), A));
    }));
    await render(accountIdentity(A));
    await act(async () => {
      const select = container.querySelector('[data-testid="team-settings-chart"]') as HTMLSelectElement;
      select.value = "green_up";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      const email = container.querySelector('[data-testid="team-invite-email"]') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "fixture@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (container.querySelector('[data-testid="team-invite-create"]') as HTMLButtonElement).click());
    expect((container.querySelector('[data-testid="team-settings-chart"]') as HTMLSelectElement).value).toBe("red_up");
    await act(async () => patch.resolve(response({})));
    const select = container.querySelector('[data-testid="team-settings-chart"]') as HTMLSelectElement;
    expect(select.value).toBe("red_up");
    expect(select.disabled).toBe(false);
    expect(container.querySelector('[data-testid="team-settings-msg"]')).toBeNull();
    expect((container.querySelector('[data-testid="team-invite-url"]') as HTMLInputElement).value).toBe("https://example.invalid/one-time");
  });

  for (const operation of ["role", "transfer", "retry"] as const) {
    for (const reload of ["success", "failure"] as const) {
      it(`late ${operation} failure cannot restore controls after a ${reload} roster reload`, async () => {
        const write = deferred<Response>();
        const invitation = deferred<Response>();
        let refreshed = false;
        let transferRequests = 0;
        const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/transfer-ownership")) {
            transferRequests += 1;
            if (operation === "retry") return response({ message: "Initial conflict" }, 409);
            return write.promise;
          }
          if (init?.method === "PATCH") return write.promise;
          if (init?.method === "POST") return invitation.promise;
          if (url === "/api/teams" && refreshed && reload === "failure") return response({ message: "Read refused" }, 403);
          if (url.endsWith("/members")) return response({ callerRole: refreshed ? "member" : "owner", members: [
            { userId: A, role: refreshed ? "member" : "owner", displayName: "Current caller" },
            { userId: B, role: "admin", displayName: "Current teammate" },
          ] });
          return response(bodyFor(url, A));
        });
        vi.stubGlobal("fetch", fetch);
        await render(accountIdentity(A));
        const click = async (selector: string) => {
          const button = container.querySelector(selector) as HTMLButtonElement;
          expect(button).not.toBeNull();
          expect(button.disabled).toBe(false);
          await act(async () => button.click());
        };
        await act(async () => {
          const email = container.querySelector('[data-testid="team-invite-email"]') as HTMLInputElement;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "fixture@example.com");
          email.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await click('[data-testid="team-invite-create"]');
        if (operation === "role") await click('[data-testid="team-change-role"] button');
        else {
          await click('[data-testid="team-transfer-ownership"]');
          await click('[data-testid="team-transfer-recipients"] button');
          await click('[data-testid="team-transfer-next"]');
          await click('[data-testid="team-transfer-confirm"]');
          if (operation === "retry") await click('[data-testid="team-transfer-retry"]');
        }
        refreshed = true;
        await act(async () => invitation.resolve(response({ inviteUrl: "https://example.invalid/one-time" })));
        expect(live().getAttribute("data-caller-role")).toBe(reload === "success" ? "member" : "");
        expect(container.querySelector('[data-testid="team-change-role"]')).toBeNull();
        if (operation === "retry") {
          await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
          expect(transferRequests).toBe(1);
        } else {
          await act(async () => write.resolve(response({ message: "Old write refused" }, operation === "transfer" ? 409 : 403)));
        }
        expect(live().getAttribute("data-caller-role")).toBe(reload === "success" ? "member" : "");
        expect(container.querySelector('[data-testid="team-change-role"]')).toBeNull();
        expect(container.querySelector('[data-testid="team-transfer-dialog"]')).toBeNull();
        expect(text()).not.toContain("Old write refused");
        if (reload === "failure") expect(text()).not.toContain("Current teammate");
        expect((container.querySelector('[data-testid="team-invite-url"]') as HTMLInputElement).value).toBe("https://example.invalid/one-time");
      });
    }
  }


  for (const nextTeam of ["none", "other"] as const) {
    it(`clears a one-time invitation when a successful reload resolves ${nextTeam} team`, async () => {
      let changed = false;
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          changed = true;
          return response({ inviteUrl: "https://example.invalid/old-team-link" });
        }
        if (changed && url === "/api/teams") return response({ teams: nextTeam === "none" ? [] : [{ id: B, name: "Different team" }] });
        return response(bodyFor(url, A));
      }));
      await render(accountIdentity(A));
      await act(async () => {
        const email = container.querySelector('[data-testid="team-invite-email"]') as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "fixture@example.com");
        email.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => (container.querySelector('[data-testid="team-invite-create"]') as HTMLButtonElement).click());
      expect(live().getAttribute("data-team-id")).toBe(nextTeam === "none" ? "" : B);
      expect(container.querySelector('[data-testid="team-invite-url"]')).toBeNull();
      expect(container.querySelector(nextTeam === "none" ? '[data-testid="team-none"]' : '[data-testid="team-invite-form"]')).not.toBeNull();
    });
  }

  it("loads the canonical account when a guest signs in", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => response(bodyFor(String(input), A)));
    vi.stubGlobal("fetch", fetch);
    await render(GUEST_IDENTITY);
    expect(fetch).not.toHaveBeenCalled();
    await render(accountIdentity(A));
    expect(text()).toContain("Alpha desk");
    expect(live().getAttribute("data-caller-role")).toBe("owner");
    expect(container.querySelector('[data-testid="team-settings"]')).not.toBeNull();
  });

});
