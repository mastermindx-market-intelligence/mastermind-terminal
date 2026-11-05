"use client";

/**
 * Context-only composition under Company Intelligence's already verified event.
 * Uses no new fetch, data store, cross-event score or analyst-vintage inference.
 */
import type { EventWorkspacePresentedItem } from "../../lib/eventWorkspacePresent";
import { pick } from "../../lib/finFormat";
import {
  composeEarningsExpectationEvidence,
  type RepricingEvidenceSource,
} from "../../lib/earningsExpectationBoundary";

interface EarningsRepricingEvidenceProps {
  presented: RepricingEvidenceSource;
  zh: boolean;
  onChooseEvidence?: (item: EventWorkspacePresentedItem) => void;
}

export default function EarningsRepricingEvidence({
  presented, zh, onChooseEvidence,
}: EarningsRepricingEvidenceProps) {
  const result = composeEarningsExpectationEvidence(presented);
  const lang = zh ? 1 : 0;

  return (
    <section
      className="ci-paper-results-card"
      data-ci-repricing-evidence=""
      data-ci-inference={result.repricingInference}
      aria-label={pick(zh, "Earnings expectations and repricing evidence", "业绩预期和重估证据")}
    >
      <header>
        <div>
          <h4>{pick(zh, "Expectations & repricing evidence", "市场预期与业绩重估")}</h4>
          <p>
            {pick(zh, "Separate verified results, company guidance, prior analyst estimates and market reaction. No trading signal.", "区分已核验业绩、公司指引、事前分析师预期及价格反应；不推断交易信号。")}
          </p>
        </div>
        <span>{pick(zh, "Research context", "仅供研究")}</span>
      </header>
      <div className="ci-paper-results-list">
        {result.lanes.map((lane) => {
          const selectable = lane.evidence != null && !!onChooseEvidence;
          const receiptStateAttribute = lane.status;
          const content = (
            <>
              <span>{lane.label[lang]} · {lane.statusLabel[lang]}</span>
              <strong>{lane.value[lang]}</strong>
              <small>{lane.detail[lang]}</small>
            </>
          );
          return selectable ? (
            <button
              key={lane.id}
              type="button"
              className="ci-paper-results-row"
              data-ci-repricing-lane={lane.id}
              data-ci-repricing-status={receiptStateAttribute}
              onClick={() => onChooseEvidence?.(lane.evidence!)}
            >
              {content}
              <i aria-hidden>›</i>
            </button>
          ) : (
            <div
              key={lane.id}
              className="ci-paper-results-row"
              data-ci-repricing-lane={lane.id}
              data-ci-repricing-status={receiptStateAttribute}
            >
              {content}
            </div>
          );
        })}
      </div>
      <p className="ci-paper-results-empty" data-ci-repricing-conclusion="not-established">
        {pick(zh, "The evidence does not establish what was priced in. No surprise, mispricing or return forecast is asserted.", "证据尚不能证明业绩已被市场提前定价；不得据此声称超预期、定价偏差或预测回报。")}
      </p>
    </section>
  );
}
