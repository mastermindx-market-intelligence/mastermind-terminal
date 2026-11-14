/** Original synthetic examples, projected by Macro engine/us_candidate_lanes.py
 * at d8a12a7. No captured market payload or live recommendation.
 * Raw-source and display digests identify the generated synthetic input. */
import type { ProphetCandidateRead } from "@/lib/prophetCandidatePool";
const FIXTURE: ProphetCandidateRead = {
  "schema": "mastermind.prophet_candidate_pool_read.v1",
  "market": "US",
  "source": {
    "path": "site/factordata/us_standouts.json",
    "sha256": "sha256:8611ad3b474beb599920be4bf15d6948e38eba2ee452a07a7c82c48070617dc4",
    "bytes": 2060
  },
  "projection": {
    "status": "ready",
    "reason": null,
    "as_of": "2026-11-12",
    "counts": {
      "eligible": 4,
      "in_buy_lane": 2,
      "off_buy_lane": 2,
      "scored": 2,
      "unscored": 2
    },
    "rows": [
      {
        "ticker": "DEMOA",
        "name": "Aster Instruments",
        "sector": "Industrials",
        "pool_rank": 1,
        "in_buy_lane": true,
        "lane": "featured",
        "headline_reason": "board_featured",
        "lane_reasons": [
          "board_featured"
        ],
        "tier_cascade": null,
        "admission_class": null,
        "prophet_score_basis": "buy_lane_pool",
        "prophet": {
          "score": 82.5
        }
      },
      {
        "ticker": "DEMOB",
        "name": "Beacon Systems",
        "sector": "Technology",
        "pool_rank": 2,
        "in_buy_lane": true,
        "lane": "featured",
        "headline_reason": "already_open",
        "lane_reasons": [
          "already_open"
        ],
        "tier_cascade": null,
        "admission_class": null,
        "prophet_score_basis": "buy_lane_pool",
        "prophet": {
          "score": 0.0
        }
      },
      {
        "ticker": "DEMOC",
        "name": "Cedar Networks",
        "sector": "Technology",
        "pool_rank": "7",
        "in_buy_lane": false,
        "lane": "forming",
        "headline_reason": "sector_cap_overflow",
        "lane_reasons": [
          "sector_cap_overflow"
        ],
        "tier_cascade": null,
        "admission_class": null,
        "prophet_score_basis": null,
        "prophet": null
      },
      {
        "ticker": "DEMOD",
        "name": "Dawn Materials 晨光材料",
        "sector": "Materials",
        "pool_rank": 12,
        "in_buy_lane": false,
        "lane": "forming",
        "headline_reason": "not_yet",
        "lane_reasons": [
          "not_yet"
        ],
        "tier_cascade": null,
        "admission_class": null,
        "prophet_score_basis": null,
        "prophet": null
      }
    ],
    "display_only": true,
    "source_digest": "947a6877ef663c5fe79e01974990a04618ee4ed67c5c70b8e4c5d882c33303f0"
  }
};
export function candidatePoolFixture(): ProphetCandidateRead { return structuredClone(FIXTURE); }
