/**
 * Earnings expectations / repricing evidence boundary.
 *
 * Read-only composition of the already verified event_workspace.v1 presentation.
 * Never reads historical Yahoo observations, post-event articles or unlicensed
 * adjusted bars. In particular, an actual result is NOT an estimate surprise.
 */
import type {
  EventWorkspacePresented,
  EventWorkspacePresentedItem,
} from "./eventWorkspacePresent";

export type RepricingLane = "reported" | "guidance" | "consensus" | "reaction";
export type RepricingLaneStatus = "SOURCE_BACKED" | "SOURCE_NOT_BOUND" | "NOT_ADMITTED";

export interface RepricingEvidenceLane {
  id: RepricingLane;
  status: RepricingLaneStatus;
  label: [string, string];
  statusLabel: [string, string];
  value: [string, string];
  detail: [string, string];
  /** A selection is allowed only for evidence with a byte-replayed source. */
  evidence: EventWorkspacePresentedItem | null;
}

export interface RepricingEvidenceContext {
  eventId: string;
  periodLabel: string;
  lanes: readonly RepricingEvidenceLane[];
  repricingInference: "NOT_ESTABLISHED";
  historicalConsensusAdmitted: false;
  eventPriceReactionJoined: false;
  authority: "CONTEXT_ONLY_NO_TRADING";
}

export type RepricingEvidenceSource = Pick<
  EventWorkspacePresented,
  "event_id" | "period_label" | "reported" | "facts" | "guidance" | "honest"
>;

function firstSourced(
  items: readonly EventWorkspacePresentedItem[],
  { numericRange = false }: { numericRange?: boolean } = {},
): EventWorkspacePresentedItem | null {
  return items.find((item) => (
    item.evidence?.receipt_state === "byte_replayed" &&
    !!item.value.trim() &&
    !/^(?:unavailable|no structured range|暂无|无结构化指引)/i.test(item.value.trim()) &&
    (!numericRange || /^\d+(?:\.\d+)?(?:[–-]\d+(?:\.\d+)?)?%$/.test(item.value.trim()))
  )) ?? null;
}

/** Source proof and known-missingness, not an earnings prediction or score. */
export function composeEarningsExpectationEvidence(
  presented: RepricingEvidenceSource,
): RepricingEvidenceContext {
  const actual = firstSourced(presented.reported) ?? firstSourced(
    presented.facts.filter((item) => !/questions_count/i.test(item.id)),
  );
  const guide = firstSourced(presented.guidance, { numericRange: true });

  return {
    eventId: presented.event_id,
    periodLabel: presented.period_label,
    historicalConsensusAdmitted: false,
    eventPriceReactionJoined: false,
    repricingInference: "NOT_ESTABLISHED",
    authority: "CONTEXT_ONLY_NO_TRADING",
    lanes: [
      {
        id: "reported",
        status: actual ? "SOURCE_BACKED" : "SOURCE_NOT_BOUND",
        label: ["Reported operating evidence", "已报告经营证据"],
        statusLabel: actual ? ["Source-backed", "来源可核验"] : ["Not bound", "未绑定"],
        value: actual ? [actual.value, actual.value] : ["No replayable result", "暂无可回放结果"],
        detail: actual
          ? ["Open the underlying company disclosure evidence", "打开相应公司披露来源"]
          : ["Do not infer an actual value from commentary", "不从评论中推断实际数值"],
        evidence: actual,
      },
      {
        id: "guidance",
        status: guide ? "SOURCE_BACKED" : "SOURCE_NOT_BOUND",
        label: ["Company-issued guidance", "公司发布的指引"],
        statusLabel: guide ? ["Source-backed", "来源可核验"] : ["Not bound", "未绑定"],
        value: guide ? [guide.value, guide.value] : ["No verified numerical range", "暂无核验的数值区间"],
        detail: guide
          ? ["Company guidance is not analyst consensus", "公司指引不等于分析师共识"]
          : ["A narrative outlook is not a sourced guidance range", "叙述性展望不等于可核验的指引区间"],
        evidence: guide,
      },
      {
        id: "consensus",
        status: "NOT_ADMITTED",
        label: ["Prior analyst expectations", "事前分析师预期"],
        statusLabel: ["Not admitted", "尚未准入"],
        value: ["No comparable PIT estimate vintage", "缺少可比的历史时点估计版本"],
        detail: [
          "Missing issuer + fiscal target + metric + basis + as-of + rights; no beat/miss claim",
          "缺少发行主体、财季、指标、口径、截至时间及权限；不得声称超预期或不及预期",
        ],
        evidence: null,
      },
      {
        id: "reaction",
        status: "NOT_ADMITTED",
        label: ["Market repricing", "市场重估"],
        statusLabel: ["Not joined", "尚未关联"],
        value: ["No qualified event-price return", "缺少合格的事件价格回报"],
        detail: [
          "No admissible source/calendar/event-window join; no priced-in conclusion",
          "缺少合格来源、交易日历及事件窗口关联；不得断言已被定价",
        ],
        evidence: null,
      },
    ],
  };
}
