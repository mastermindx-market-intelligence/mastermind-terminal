// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import InvestigationWatchPanel from "@/components/workspaces/InvestigationWatchPanel";
import InvestigationReviewPanel from "@/components/workspaces/InvestigationReviewPanel";
import { orderReceipts, receiptsFrom, type FireReceipt } from "@/lib/investigationReview";
import type { OwnerAlertRow, WatchLink } from "@/lib/investigationWatch";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const link: WatchLink = { investigation_id: "00000000-0000-4000-8000-000000000001", revision: 3 };
const FIRE = "b".repeat(64);
const firedRow: OwnerAlertRow = {
  id: "alert-1", symbol: "NVDA", active: false, created_at: "2026-10-21T14:00:00Z",
  condition: { type: "price", op: "above", value: 230, evidence: link, triggered: { at: "2026-10-21T15:40:03Z", value: 230.12, note: "price 230.12 above 230 (hub)" } },
};
const outbox = [{ alert_id: "alert-1", fire_event_id: FIRE, status: "sent", payload: { fired_at: "2026-10-21T15:40:03Z", condition_plain: "Last price above 230.00", source_asof: "2026-10-21T16:30:04Z" } }];
const receipts: FireReceipt[] = orderReceipts(receiptsFrom([firedRow], outbox, link.investigation_id));
const onArm = vi.fn(async () => {}), onRearm = vi.fn(async () => {});

let container: HTMLDivElement | null = null, root: Root | null = null;
async function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  await act(async () => { await Promise.resolve(); });
  return container!;
}
function click(button: HTMLButtonElement) {
  act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
beforeEach(() => { onArm.mockClear(); onRearm.mockClear(); });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null; container?.remove(); container = null;
});

describe("investigation watch and review surfaces", () => {
  it("renders the watch entry with kind, threshold, source, cadence, fires-once and the not-an-order sentence", async () => {
    const el = await mount(<InvestigationWatchPanel link={link} symbol="NVDA" rows={[firedRow]} lang="en" disabled={false} loadState="ready" onArm={onArm} onRearm={onRearm}/>);
    const chip = el.querySelector('[data-testid="investigation-watch-state"]');
    expect(chip?.textContent).toContain("FIRED");
    expect(chip?.textContent).toContain("15:40:03Z");
    expect(chip?.textContent).toContain("now disarmed");
    expect(el.textContent).toContain("last price above 230.00");
    expect(el.textContent).toContain("230.12");
    expect(el.textContent).toContain("alerts engine");
    expect(el.textContent).toContain("evaluated every 5 minutes");
    expect(el.textContent).toContain("fires once · re-arm manually");
    expect(el.textContent).toContain("A watch is not an order and implies no profitable signal.");
    const form = el.querySelector('[data-testid="investigation-watch-kind"]');
    expect(form?.textContent).toContain("price touch");
    expect(el.querySelector('[data-testid="investigation-watch-arm"]')).toBeTruthy();
  });

  it("lists the kinds not offered with their reason", async () => {
    const el = await mount(<InvestigationWatchPanel link={link} symbol="NVDA" rows={[]} lang="en" disabled={false} loadState="ready" onArm={onArm} onRearm={onRearm}/>);
    const kinds = el.querySelector('[data-testid="investigation-watch-kinds"]')!;
    expect(kinds.textContent).toContain("exposure change");
    expect(kinds.textContent).toContain("no evaluator in the alerts owner · follow-on L-W3C-ENG");
    expect(kinds.textContent).toContain("rotation transition");
    expect(kinds.textContent).toContain("event time");
    // The form itself only ever offers the two kinds the alerts owner can evaluate.
    const options = [...el.querySelectorAll('[data-testid="investigation-watch-kind"] option')].map(o => o.getAttribute("value"));
    expect(options).toEqual(["price_touch", "price_proximity"]);
  });

  it("renders the receipt rows and the assessment control with inconclusive as a first-class choice", async () => {
    const review = { rows: [], fired: receipts[0], revisions: [{ revision: 3, committed_at: "2026-10-21T14:02:00Z", assessment: null }] };
    const el = await mount(<InvestigationReviewPanel review={review} receipts={receipts} current={{ revision: 3, current_revision: 3 }} lang="en" disabled={false} onAssess={vi.fn()} onOpenRevision={() => {}}/>);
    const table = el.querySelector('[data-testid="investigation-review-receipts"]')!;
    for (const word of ["FIRED", "CONDITION", "OBSERVED", "SOURCE · VINTAGE", "DELIVERY", "RECEIPT ID"]) expect(table.textContent).toContain(word);
    expect(table.textContent).toContain("230.12");
    expect(table.textContent).toContain("sent");
    expect(table.textContent).toContain(FIRE);
    const buttons = [...el.querySelectorAll('[data-testid="investigation-review-assessment"] button')] as HTMLButtonElement[];
    expect(buttons.map(b => b.textContent)).toEqual(["Confirmed", "Contradicted", "Inconclusive"]);
    click(buttons[2]);
    expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
    const save = el.querySelector('[data-testid="investigation-review-save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("disables saving an assessment on a superseded revision", async () => {
    const review = { rows: [], fired: receipts[0], revisions: [{ revision: 3, committed_at: null, assessment: null }] };
    const el = await mount(<InvestigationReviewPanel review={review} receipts={receipts} current={{ revision: 2, current_revision: 3 }} lang="en" disabled={false} onAssess={vi.fn()} onOpenRevision={() => {}}/>);
    const buttons = [...el.querySelectorAll('[data-testid="investigation-review-assessment"] button')] as HTMLButtonElement[];
    click(buttons[2]);
    const save = el.querySelector('[data-testid="investigation-review-save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(el.textContent).toContain("Open the latest revision");
    // A revision row opens that revision.
    const revisionButton = el.querySelector('[data-testid="investigation-review-revisions"] button') as HTMLButtonElement;
    expect(revisionButton.textContent).toContain("r3");
  });

  it("renders in Chinese without machine text", async () => {
    const el = await mount(<InvestigationWatchPanel link={link} symbol="NVDA" rows={[firedRow]} lang="zh" disabled={false} loadState="ready" onArm={onArm} onRearm={onRearm}/>);
    expect(el.querySelector('[data-testid="investigation-watch-state"]')?.textContent).toContain("已触发");
    expect(el.textContent).toContain("每 5 分钟评估一次");
    expect(el.textContent).toContain("监测不是订单，也不暗示任何盈利信号。");
    expect(el.textContent).toContain("提醒系统无评估器");
    expect(el.textContent).not.toContain("price_touch");
    expect(el.textContent).not.toContain("opt_wall_touch");
    expect(el.textContent).not.toContain("fires once");
    const review = { rows: [{ kind: "changed" as const, object_type: "sector_origin", object_id: "xlk/semiconductors/NVDA", detail: "" }], fired: receipts[0], revisions: [] };
    const zh = await mount(<InvestigationReviewPanel review={review} receipts={receipts} current={{ revision: 3, current_revision: 3 }} lang="zh" disabled={false} onAssess={vi.fn()} onOpenRevision={() => {}}/>);
    expect(zh.textContent).toContain("已证实");
    expect(zh.textContent).toContain("尚无定论");
    expect(zh.textContent).toContain("板块来源");
    expect(zh.textContent).not.toContain("confirmed");
    expect(zh.textContent).not.toContain("still_supported");
  });
});
