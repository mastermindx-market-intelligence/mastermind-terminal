import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixtureAuthSetup } from "./fixtures/investigation-auth";
import { isolateWatchlistStore } from "./watchlistStore";
import type { ProposalRow } from "../lib/thesisAmendmentProposals";
import type { ThesisDetail } from "../lib/theses";

// Compose the actual isolated Thesis and proposal fixture owners with the mounted
// editor. Neither owner route is intercepted. Authorship comes from seeded test
// text, not an AI provider: no AI generation, production DB or live-principal claim.
// Same-version sibling supersession is handled by the existing proposal owner.
type ProposalPatchRecord = { method: string; path: string; state: string | null };

const isProposalPath = (pathname: string): boolean =>
  /^\/api\/thesis\/[^/]+\/proposals(\/|$)/.test(pathname);

const patchRecord = (proposal: ProposalRow, state: "accepted" | "rejected"): ProposalPatchRecord => ({
  method: "PATCH",
  path: `/api/thesis/${proposal.thesisId}/proposals/${proposal.proposalId}`,
  state,
});

test.setTimeout(120_000);
for (const zh of [false, true]) {
  test(`proposal choices stage the editor until an explicit Thesis Save (${zh ? "zh" : "en"})`, async ({ page, baseURL }, info) => {
    await isolateWatchlistStore(page, info, baseURL);
    await fixtureAuthSetup(page, baseURL!);
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), zh ? "zh" : "en");
    await page.route("**/api/brain/me", route => route.fulfill({ json: { tier: "guest", quotas: { fast: { remaining: 0, limit: 0, period: "day" }, pro: { remaining: 0, limit: 0, period: "day" } } } }));

    const subject = {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key: "AAPL", identityState: "listing_scoped", listing: { symbol: "AAPL", mic: null, securityId: null },
      companyId: null, display: "AAPL · listing scoped",
    };
    const originalContent = {
      schema: "mastermind.thesis-content/v1", title: "Capacity and margins",
      statement: "Original capacity explains the margin.", catalysts: ["Next factory disclosure"],
      falsifiers: ["Utilization falls"], risks: ["Demand attribution is incomplete"], horizon: "quarters",
      effectiveAt: "2026-10-01T09:30:00.000Z", revisionNote: "Original rationale: compare utilization before attributing demand.",
    };
    const seededStatement = "Current working interpretation before any proposal choice.";
    const seededNote = "Intervening owner revision before the proposals arrive.";

    // Original v1, then seeded v2, both through the real /api/theses owner.
    const created = await page.request.post("/api/theses", { data: { action: "create", clientRequestId: randomUUID(), subject, content: originalContent } });
    expect(created.status()).toBe(201);
    const thesisId = ((await created.json()) as { thesisId: string }).thesisId;
    const readOwner = async (): Promise<ThesisDetail> => {
      const response = await page.request.get(`/api/theses?id=${thesisId}`);
      expect(response.ok()).toBe(true);
      return ((await response.json()) as { thesis: ThesisDetail }).thesis;
    };
    const v1Owner = await readOwner();
    expect(v1Owner.currentVersion).toBe(1);
    const v1 = v1Owner.current;
    const v1Exact = structuredClone(v1);
    const seeded = await page.request.post("/api/theses", { data: {
      action: "revise", id: thesisId, expectedVersion: 1, clientRequestId: randomUUID(), subject,
      content: { ...originalContent, statement: seededStatement, revisionNote: seededNote },
    } });
    expect(seeded.ok()).toBe(true);
    const v2Owner = await readOwner();
    expect(v2Owner.currentVersion).toBe(2);
    const v2 = v2Owner.current;
    const v2Exact = structuredClone(v2);

    const bodies = [
      "Proposal one: restate the margin as a capacity-utilization ceiling.",
      "Proposal two: attribute the margin to pricing power instead of capacity.",
      "Proposal three: widen the falsifier list before changing the statement.",
      "Sibling proposal: treat original capacity as an unresolved alternative.",
    ] as const;
    const createProposal = async (body: string, version: ThesisDetail["current"]): Promise<ProposalRow> => {
      const response = await page.request.post(`/api/thesis/${thesisId}/proposals`, {
        data: { amended_from: version.id, body, evidence_refs: [] },
      });
      expect(response.status()).toBe(201);
      const proposal = (await response.json()).proposal as ProposalRow;
      expect(proposal).toMatchObject({ thesisId, amendedFrom: version.id, body, state: "proposed",
        versionNumber: version.version, versionRecordedAt: version.systemRecordedAt });
      return proposal;
    };
    const firstProposal = await createProposal(bodies[0], v1);
    // A proposal based on v2 must remain separately actionable when v1's siblings supersede.
    const secondProposal = await createProposal(bodies[1], v2);
    const thirdProposal = await createProposal(bodies[2], v1);
    const siblingProposal = await createProposal(bodies[3], v1);

    // Request recording starts only AFTER seeding. Every nonGET proposal
    // request the page emits is counted — permitted or not — and the final
    // assertion below requires that stream to equal exactly the three
    // permitted PATCH calls, so any unexpected write fails the test.
    const thesisWrites: unknown[] = [];
    const proposalWrites: ProposalPatchRecord[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/theses") { thesisWrites.push(request.postDataJSON()); return; }
      if (request.method() !== "GET" && isProposalPath(url.pathname)) {
        const payload: unknown = request.postDataJSON();
        proposalWrites.push({
          method: request.method(),
          path: url.pathname,
          state: typeof payload === "object" && payload !== null && "state" in payload
            ? String((payload as { state: unknown }).state)
            : null,
        });
      }
    });

    await page.goto(`/analysis?view=theses&thesis=${thesisId}`);
    const workspace = page.getByTestId("thesis-workspace");
    const proposalsSection = workspace.getByTestId("thesis-proposals");
    const row = (body: string) =>
      proposalsSection.getByTestId("thesis-proposal-row").filter({ has: page.getByText(body, { exact: true }) });
    const acceptControl = (body: string) => row(body).getByRole("button", { name: zh ? "接受" : "Accept", exact: true });
    const rejectControl = (body: string) => row(body).getByRole("button", { name: zh ? "拒绝" : "Reject", exact: true });
    const statementBox = workspace.getByLabel(zh ? "论点陈述" : "Thesis statement", { exact: true });

    // Reject the third proposal: disposition only — the other two rows keep
    // their choice buttons, the editor keeps the seeded v2 statement, and the
    // owner stays exactly v2 with no Thesis write.
    await expect(row(bodies[2]).locator("i")).toHaveAttribute("data-state", "proposed");
    await rejectControl(bodies[2]).click();
    await expect(row(bodies[2]).locator("i")).toHaveAttribute("data-state", "rejected");
    await expect(rejectControl(bodies[2])).toHaveCount(0);
    await expect(acceptControl(bodies[0])).toBeVisible();
    await expect(acceptControl(bodies[1])).toBeVisible();
    await expect(statementBox).toHaveValue(seededStatement);
    const afterReject = await readOwner();
    expect(afterReject).toEqual(v2Owner);
    expect(afterReject.current).toEqual(v2Exact);
    expect(afterReject.history.find(version => version.id === v1.id)).toEqual(v1Exact);
    expect(thesisWrites).toHaveLength(0);

    // Accept the first proposal: it stages the mounted editor and nothing else.
    await acceptControl(bodies[0]).click();
    await expect(statementBox).toHaveValue(bodies[0]);
    await expect(row(bodies[0]).locator("i")).toHaveAttribute("data-state", "accepted");
    await expect(row(bodies[3]).locator("i")).toHaveAttribute("data-state", "superseded");
    await expect(acceptControl(bodies[3])).toHaveCount(0);
    await expect(acceptControl(bodies[1])).toBeVisible();
    expect(thesisWrites).toHaveLength(0);
    const afterAccept = await readOwner();
    expect(afterAccept).toEqual(v2Owner);
    expect(afterAccept.current).toEqual(v2Exact);
    expect(afterAccept.history.find(version => version.id === v1.id)).toEqual(v1Exact);
    expect(proposalWrites).toEqual([
      patchRecord(thirdProposal, "rejected"),
      patchRecord(firstProposal, "accepted"),
    ]);
    await workspace.screenshot({ path: info.outputPath("proposal-editor-staged.png") });

    // Reload BEFORE Save: the staged text is discarded, the accepted proposal
    // is not auto-adopted, and the owner is still exactly v2.
    await page.reload();
    await expect.poll(async () => (await readOwner()).currentVersion).toBe(2);
    const stillV2 = await readOwner();
    expect(stillV2).toEqual(v2Owner);
    await expect(statementBox).toHaveValue(seededStatement);
    await expect(row(bodies[0]).locator("i")).toHaveAttribute("data-state", "accepted");

    // Accept the second proposal, write the analyst's own revision note, and
    // make the existing Save the single Thesis writer.
    const note = "Analyst revision note: adopt proposal two after re-reading the original rationale.";
    await acceptControl(bodies[1]).click();
    await expect(statementBox).toHaveValue(bodies[1]);
    await workspace.getByLabel(zh ? "修订说明" : "Revision note", { exact: true }).fill(note);
    await workspace.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
    await expect.poll(async () => (await readOwner()).currentVersion).toBe(3);
    expect(thesisWrites).toHaveLength(1);
    expect(thesisWrites[0]).toMatchObject({
      action: "revise", id: thesisId, expectedVersion: 2, subject,
      content: { statement: bodies[1], revisionNote: note },
    });
    const saved = await readOwner();
    expect(saved.current.id).not.toBe(v1.id);
    expect(saved.current.id).not.toBe(v2.id);
    expect(saved.history.find(version => version.id === v1.id)).toEqual(v1Exact);
    expect(saved.history.find(version => version.id === v2.id)).toEqual(v2Exact);

    // Current v3 survives reload; the proposal disposition stream holds exactly
    // the three permitted PATCH calls and nothing else nonGET.
    await page.reload();
    await expect(statementBox).toHaveValue(bodies[1]);
    await expect(row(bodies[0]).locator("i")).toHaveAttribute("data-state", "accepted");
    await expect(row(bodies[1]).locator("i")).toHaveAttribute("data-state", "accepted");
    await expect(row(bodies[2]).locator("i")).toHaveAttribute("data-state", "rejected");
    await expect(row(bodies[3]).locator("i")).toHaveAttribute("data-state", "superseded");
    expect(await readOwner()).toEqual(saved);
    const proposalRead = await page.request.get(`/api/thesis/${thesisId}/proposals`);
    expect(proposalRead.ok()).toBe(true);
    const rows = (await proposalRead.json()).proposals as ProposalRow[];
    expect(rows).toHaveLength(4);
    for (const [proposal, state] of [
      [firstProposal, "accepted"], [secondProposal, "accepted"],
      [thirdProposal, "rejected"], [siblingProposal, "superseded"],
    ] as const) expect(rows.find(row => row.proposalId === proposal.proposalId)).toMatchObject({ ...proposal, state });
    await workspace.screenshot({ path: info.outputPath("proposal-saved-v3.png") });
    expect(thesisWrites).toHaveLength(1);
    expect(proposalWrites).toEqual([
      patchRecord(thirdProposal, "rejected"),
      patchRecord(firstProposal, "accepted"),
      patchRecord(secondProposal, "accepted"),
    ]);
  });
}
