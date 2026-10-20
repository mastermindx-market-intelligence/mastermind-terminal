import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, createClient, rateLimit, fetchMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createClient: vi.fn(async () => ({ rpc, auth: { getUser } })),
  rateLimit: vi.fn(() => ({ ok: true })),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit, tooMany: vi.fn() }));

// The collaborators behind the four read-only sub-routes are irrelevant to the
// admission gate: stubbing them lets the closed-mode assertions prove that the
// handler returned before any collaborator — or network — was reached. The
// main route's investigations lib is stubbed for the same reason; the open-path
// tests below still drive the routes' OWN auth and selector validation.
vi.mock("@/lib/upstreams", () => ({ R2_BASE: "https://r2.fixture.invalid" }));
vi.mock("@/lib/investigations", () => ({
  INVESTIGATION_ADMISSION: { surface: "investigation" },
  isInvestigationId: vi.fn(() => true),
  listInvestigations: vi.fn(),
  parseInvestigationCommand: vi.fn(),
  readInvestigation: vi.fn(),
  readInvestigationOperation: vi.fn(),
  reconcileInvestigationOperation: vi.fn(),
  applyInvestigationRevision: vi.fn(),
}));
vi.mock("@/lib/eventWorkspace", () => ({
  normalizeCompanyIntelligenceSymbol: (symbol: string) => symbol,
  resolveCurrentEventWorkspaceFromR2: vi.fn(),
  resolveRetainedEventWorkspaceFromR2: vi.fn(),
  resolveRetainedEventWorkspaceAtCutoff: vi.fn(),
  authorizeRetainedPublicEventContext: vi.fn(),
}));
vi.mock("@/lib/investigationIssuerRelease", () => ({
  resolveInvestigationIssuerRelease: vi.fn(),
  resolveInvestigationIssuerReleaseAtCutoff: vi.fn(),
}));
vi.mock("@/lib/investigationContracts", () => ({ validateStoredInvestigationManifest: vi.fn() }));
vi.mock("@/lib/investigationEarningsReview", () => ({
  reviewRetainedEarnings: vi.fn(),
  reviewSelectedIssuerRelease: vi.fn(),
}));
vi.mock("@/lib/theses", () => ({ readThesisVersion: vi.fn() }));

import { GET as mainGET, POST as mainPOST, PUT as mainPUT } from "@/app/api/investigations/route";
import { GET as baselineGET } from "@/app/api/investigations/baseline/route";
import { GET as reviewGET } from "@/app/api/investigations/review/route";
import { GET as replayGET } from "@/app/api/investigations/replay/route";
import { GET as thesesGET } from "@/app/api/investigations/theses/route";
import { investigationApiAdmission, investigationApiUnavailable } from "@/lib/investigationApiAdmission";
import { readInvestigation } from "@/lib/investigations";

const id = "10000000-0000-4000-8000-000000000001";
const url = (path: string) => `https://terminal.test/api/investigations${path}`;

const handlerTable = [
  { name: "main GET", run: mainGET, request: () => new Request(url("")) },
  { name: "main POST", run: mainPOST, request: () => new Request(url(""), { method: "POST", body: "{}" }) },
  { name: "main PUT", run: mainPUT, request: () => new Request(url(""), { method: "PUT", body: "{}" }) },
  { name: "baseline GET", run: baselineGET, request: () => new Request(url("/baseline?event_id=e&generation_id=g&company_id=c&fingerprint=f")) },
  { name: "review GET", run: reviewGET, request: () => new Request(url(`/review?id=${id}&revision=1`)) },
  { name: "replay GET", run: replayGET, request: () => new Request(url(`/replay?id=${id}&revision=1&policy=public_known&cutoff=2026-01-01T00:00:00Z`)) },
  { name: "theses GET", run: thesesGET, request: () => new Request(url(`/theses?id=${id}&revision=1`)) },
];

// The vitest config opts the whole fixture runtime into "open"; every closed
// assertion below stubs the variable back over that default and afterEach
// restores, so the production default (unset) is what is actually proven.
const closedValues: Array<string | undefined> = [undefined, "closed", "", "OPEN", " open", "open\n", "open,"];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("investigationApiAdmission selector", () => {
  it.each([
    ["open", true],
    ["Open", false],
    ["OPEN", false],
    [" open", false],
    ["open ", false],
    ["open\n", false],
    ["open,", false],
    ["", false],
    ["closed", false],
    ["unavailable", false],
    ["true", false],
    ["1", false],
  ] as Array<[unknown, boolean]>)("admits only the exact literal (%j)", (value, expected) => {
    expect(investigationApiAdmission(value)).toBe(expected);
  });

  it.each([undefined, null, 0, 1, true, false, {}, ["open"], new String("open"), () => "open"] as unknown[])(
    "rejects every non-string value (%s)",
    (value) => {
      expect(investigationApiAdmission(value)).toBe(false);
    },
  );
});

describe("investigationApiUnavailable helper", () => {
  it("returns null for the literal open value", () => {
    vi.stubEnv("INVESTIGATION_API_ADMISSION", "open");
    expect(investigationApiUnavailable()).toBeNull();
  });

  it("returns the exact closed 503 envelope otherwise", async () => {
    vi.stubEnv("INVESTIGATION_API_ADMISSION", "closed");
    const response = investigationApiUnavailable();
    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(503);
    expect(await response!.json()).toEqual({ status: "unavailable" });
    expect(response!.headers.get("cache-control")).toBe("private, no-store");
    expect(response!.headers.get("vary")).toBe("Cookie");
  });
});

describe.each(closedValues)("INVESTIGATION_API_ADMISSION=%j closes every handler", (value) => {
  beforeEach(() => {
    if (value === undefined) {
      // Cast keeps string-only vitest typings happy; at runtime the key is deleted.
      vi.stubEnv("INVESTIGATION_API_ADMISSION", undefined as unknown as string);
    } else {
      vi.stubEnv("INVESTIGATION_API_ADMISSION", value);
    }
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  it.each(handlerTable)("$name refuses closed mode before any dependency", async ({ run, request }) => {
    const input = request();
    const response = await run(input);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(input.bodyUsed).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(readInvestigation).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("admission is observed per request", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  it("does not cancel an already-admitted read or admit the next closed request", async () => {
    vi.stubEnv("INVESTIGATION_API_ADMISSION", "open");
    let releaseAuth!: (value: { data: { user: { id: string } }; error: null }) => void;
    getUser.mockImplementationOnce(() => new Promise(resolve => { releaseAuth = resolve; }));
    vi.mocked(readInvestigation).mockResolvedValue({ status: "found" } as never);
    const pending = mainGET(new Request(url(`?id=${id}&revision=1`)));
    await vi.waitFor(() => expect(getUser).toHaveBeenCalledOnce());

    vi.stubEnv("INVESTIGATION_API_ADMISSION", "closed");
    const next = await mainGET(new Request(url(`?id=${id}&revision=1`)));
    expect(next.status).toBe(503);
    expect(await next.json()).toEqual({ status: "unavailable" });
    expect(createClient).toHaveBeenCalledOnce();
    expect(readInvestigation).not.toHaveBeenCalled();

    releaseAuth({ data: { user: { id } }, error: null });
    expect((await pending).status).toBe(200);
    expect(readInvestigation).toHaveBeenCalledOnce();
  });

  it("flips open -> closed -> open without reimport or restore", async () => {
    vi.stubEnv("INVESTIGATION_API_ADMISSION", "open");
    getUser.mockResolvedValue({ data: { user: { id } }, error: null });
    vi.mocked(readInvestigation).mockResolvedValue({ status: "found" } as never);
    expect((await mainGET(new Request(url(`?id=${id}&revision=1`)))).status).toBe(200);

    vi.stubEnv("INVESTIGATION_API_ADMISSION", "closed");
    const post = new Request(url(""), { method: "POST", body: "{}" });
    expect((await mainPOST(post)).status).toBe(503);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(post.bodyUsed).toBe(false);

    vi.stubEnv("INVESTIGATION_API_ADMISSION", "open");
    expect((await mainGET(new Request(url(`?id=${id}&revision=1`)))).status).toBe(200);
  });
});

describe("with the fixture-open value the existing contracts still hold", () => {
  beforeEach(() => {
    vi.stubEnv("INVESTIGATION_API_ADMISSION", "open");
    getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  });

  it("is not an allow-all: authentication is still enforced first", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await mainGET(new Request(url(`?id=${id}`)))).status).toBe(401);
    expect((await mainPOST(new Request(url(""), { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await mainPUT(new Request(url(""), { method: "PUT", body: "{}" }))).status).toBe(401);
    expect((await reviewGET(new Request(url(`/review?id=${id}&revision=1`)))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is not an allow-all: the routes' own selector validation still runs", async () => {
    expect((await mainGET(new Request(url(`?id=${id}&revision=0`)))).status).toBe(400);
    expect((await mainGET(new Request(url(`?id=${id}&revision=1&operation_id=${id}`)))).status).toBe(400);
    expect(readInvestigation).not.toHaveBeenCalled();
  });

  it("an open, authenticated, well-formed read reaches the existing handler path", async () => {
    vi.mocked(readInvestigation).mockResolvedValue({ status: "found" } as never);
    const response = await mainGET(new Request(url(`?id=${id}&revision=1`)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "found" });
    expect(readInvestigation).toHaveBeenCalledWith(expect.anything(), id, 1);
  });
});
