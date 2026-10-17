import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseCompanyThemeExposureShadowV2 as exposure, parseCompanyThemeExposureShadowManifestV2 as manifest, OWNER_STATE_CONTRACT } from "../companyThemeExposureSuccessor";
import { normalizeCompanyThemeExposure as legacyExposure } from "../companyThemeExposure";

const FIXTURE_PROVENANCE = {
  "producer_commit": "d3aef3ae9a7e2fb707b4f6efe25611996d158ada",
  "state_commit": "2551f45326479a9df30435ac2ffd6c3836841bea",
  "schema_sha256": "a792ce31c36bc6df24449ff3e1b60fda4d73eb064bebc84c5dce2179d30f4632",
  "label": "controlled development fixture; no natural rights or publication",
  "fixture_stream_sha256": "315a9d9d7ccf5922287ac7e5adfd7538c5d40928c83b398d4b8c9bf31ab2070b"
} as const;
const OWNER_DEFS_CANONICAL_SHA256 = "20c518afe575351340f568b5ae91796ef10b3a95f26031609cf26edcda38930b";
const BASELINE = {
  "exposure": {
    "authority": "context_only",
    "generated_at": "2026-10-03T12:00:00Z",
    "company": {
      "ticker": "HUBB"
    },
    "company_intelligence": {
      "generation_id": "12f72d4cfd18f40064813309",
      "context_sha256": "f310047001a7feac73d8f20f04efddeb0a11bcfdb0365ca90ae6733b1c5bc2e0",
      "latest_event_id": "cie_99207faa13c1336b21b2c9e9",
      "latest_event_call_date": "2026-10-01"
    },
    "exposures": [
      {
        "theme_id": "grid",
        "name_en": "Grid",
        "name_zh": "电网",
        "mapping_qualifier": "curated",
        "basket_id": "grid"
      }
    ],
    "coverage": {
      "status": "mixed",
      "active_basket_count": 2,
      "mapped_basket_count": 1,
      "unmapped_basket_count": 1
    },
    "schema": "company_theme_exposure.v2",
    "mode": "shadow",
    "authority_caps": {
      "is_context_only": true,
      "may_rank": false,
      "may_gate": false,
      "may_size": false,
      "may_escalate": false,
      "may_trade": false,
      "may_publish": false
    },
    "generation_id": "2ce2db434d62e82e98ad9503",
    "canonical_membership_qualification": "CURRENT_VALID_DATE_NOT_PIT",
    "company_identity": {
      "owner": "identity",
      "schema": "controlled.identity/v1",
      "generation_id": "controlled-identity",
      "graph_generation_id": "controlled-graph",
      "subject_id": "co:us:HUBB",
      "query": {
        "effective_at": "2026-10-03",
        "known_at": "2026-10-03T12:00:00Z"
      },
      "effective_at": "2026-10-03",
      "known_at": "2026-10-03T09:00:00Z",
      "available_at": "2026-10-03T08:00:00Z",
      "recorded_at": "2026-10-03T09:00:00Z",
      "availability": "AVAILABLE",
      "payload": {
        "status": "RESOLVED",
        "ticker": "HUBB",
        "company_node_id": "co:us:HUBB",
        "issuer_id": "issuer:HUBB",
        "security_id": "security:HUBB"
      },
      "sha256": "7ca2b1e90bcd6bf24d5daa645002df97b59546cb84385573a00eb9a28a7a5442"
    },
    "local_membership": {
      "owner": "membership",
      "schema": "controlled.membership/v1",
      "generation_id": "controlled-membership",
      "graph_generation_id": "controlled-graph",
      "subject_id": "co:us:HUBB",
      "query": {
        "effective_at": "2026-10-03",
        "known_at": "2026-10-03T12:00:00Z"
      },
      "effective_at": "2026-10-03",
      "known_at": "2026-10-03T09:00:00Z",
      "available_at": "2026-10-03T08:00:00Z",
      "recorded_at": "2026-10-03T09:00:00Z",
      "availability": "AVAILABLE",
      "payload": {
        "company_node_id": "co:us:HUBB",
        "declared_count": 1,
        "memberships": [
          {
            "node_id": "ltheme:finviz:power_grid",
            "source_family": "finviz",
            "native_id": "power_grid",
            "membership_basis": "CURRENT_MEMBERSHIP_NOT_PIT",
            "source_refs": [
              "controlled-membership#/power_grid/HUBB"
            ]
          }
        ]
      },
      "sha256": "64819be0b40e4c7708314c54235318f8e1ab434893c35d5b483653e30e9454ed"
    },
    "local_memberships": [
      {
        "node_id": "ltheme:finviz:power_grid",
        "source_family": "finviz",
        "native_id": "power_grid",
        "membership_basis": "CURRENT_MEMBERSHIP_NOT_PIT",
        "source_refs": [
          "controlled-membership#/power_grid/HUBB"
        ],
        "company_node_id": "co:us:HUBB",
        "membership_receipt_sha256": "64819be0b40e4c7708314c54235318f8e1ab434893c35d5b483653e30e9454ed"
      }
    ],
    "local_coverage": {
      "status": "AVAILABLE",
      "declared_count": 1,
      "observed_count": 1,
      "state_available_count": 1,
      "reason_codes": []
    },
    "theme_state": {
      "schema": "theme_state/v1",
      "status": "AVAILABLE",
      "expected_generation_id": "64dd0f7a510b052607448fc31550755e",
      "generation_id": "64dd0f7a510b052607448fc31550755e",
      "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
      "state_generated_at": "2026-10-03T12:00:00Z",
      "canonical_json_sha256": "0bb5fc9976b009515cd397e84dbc9b389d689e21c3490d2c0ab302bcb03acaad",
      "raw_bytes_sha256": null,
      "raw_bytes_status": "UNMATERIALIZED",
      "graph_generation_id": "controlled-graph",
      "owner_generations": {
        "eligibility": "controlled-eligibility",
        "identity": "controlled-identity",
        "membership": "controlled-membership",
        "ontology": "controlled-ontology",
        "rights": "controlled-rights",
        "specialist": "controlled-specialist"
      },
      "effective_at": "2026-10-03",
      "known_at": "2026-10-03T12:00:00Z",
      "reads": [
        {
          "schema": "gmi.theme_state_read/v1",
          "status": "DESCRIPTIVE",
          "reason_codes": [],
          "subject_id": "ltheme:finviz:power_grid",
          "generation_id": "64dd0f7a510b052607448fc31550755e",
          "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
          "state_generated_at": "2026-10-03T12:00:00Z",
          "effective_at": "2026-10-03",
          "known_at": "2026-10-03T12:00:00Z",
          "subject": {
            "node_id": "ltheme:finviz:power_grid",
            "kind": "local_theme",
            "name_en": "Grid",
            "name_zh": "电网",
            "source_family": "finviz",
            "native_id": "power_grid",
            "mapping": {
              "state": "UNMAPPED",
              "theme_node_ids": []
            },
            "availability": "AVAILABLE",
            "reason_codes": [],
            "eligibility": {
              "status": "NOT_QUALIFIED",
              "policy_revision": null,
              "reason_codes": [
                "D2E_UNSEALED"
              ]
            },
            "owner_receipts": {
              "ontology": {
                "owner": "ontology",
                "schema": "controlled.ontology/v1",
                "generation_id": "controlled-ontology",
                "graph_generation_id": "controlled-graph",
                "subject_id": "ltheme:finviz:power_grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "canonical_mapping": {
                    "state": "UNMAPPED",
                    "theme_node_ids": []
                  }
                },
                "sha256": "1476d9e978b2dc1948dfe36cf2b32b79e0d4621486a025139f51fbfd1e39a29d"
              },
              "identity": {
                "owner": "identity",
                "schema": "controlled.identity/v1",
                "generation_id": "controlled-identity",
                "graph_generation_id": "controlled-graph",
                "subject_id": "ltheme:finviz:power_grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "RESOLVED",
                  "issuer_ids": [
                    "issuer:HUBB"
                  ]
                },
                "sha256": "0983daaee5af12f0f45c316ab53a13bdbe80e1263e10ac2409a0f040b5954f1e"
              },
              "membership": {
                "owner": "membership",
                "schema": "controlled.membership/v1",
                "generation_id": "controlled-membership",
                "graph_generation_id": "controlled-graph",
                "subject_id": "ltheme:finviz:power_grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "AVAILABLE",
                  "members": [
                    {
                      "ticker": "HUBB",
                      "issuer_id": "issuer:HUBB",
                      "security_id": "security:HUBB"
                    }
                  ],
                  "declared_count": 1,
                  "eligible_count": 1,
                  "observed_count": 1,
                  "basis": "qualified_owner_query",
                  "era": "OBSERVED"
                },
                "sha256": "b5d396c55f0c6a1a2ac1093d686927ab4817941e2eb1bf28ce9b5cda6d7831ce"
              },
              "rights": {
                "owner": "rights",
                "schema": "controlled.rights/v1",
                "generation_id": "controlled-rights",
                "graph_generation_id": "controlled-graph",
                "subject_id": "ltheme:finviz:power_grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "allowed": true,
                  "purpose": "research_internal",
                  "revision": "controlled-rights"
                },
                "sha256": "c294d767fd31122298487bd9bab3b141229d89eaf7966c8bee4a7f1aaa4865ad"
              },
              "eligibility": {
                "owner": "eligibility",
                "schema": "controlled.eligibility/v1",
                "generation_id": "controlled-eligibility",
                "graph_generation_id": "controlled-graph",
                "subject_id": "ltheme:finviz:power_grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "NOT_QUALIFIED",
                  "policy_revision": null,
                  "reason_codes": [
                    "D2E_UNSEALED"
                  ]
                },
                "sha256": "558416202a533f168f06ce9274b45bae69669df9aaddb7757d27a5a898f88446"
              }
            },
            "observations": {},
            "aggregation": {
              "status": "NOT_APPLICABLE",
              "receipt": null,
              "reason_codes": []
            }
          }
        },
        {
          "schema": "gmi.theme_state_read/v1",
          "status": "DESCRIPTIVE",
          "reason_codes": [],
          "subject_id": "theme:grid",
          "generation_id": "64dd0f7a510b052607448fc31550755e",
          "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
          "state_generated_at": "2026-10-03T12:00:00Z",
          "effective_at": "2026-10-03",
          "known_at": "2026-10-03T12:00:00Z",
          "subject": {
            "node_id": "theme:grid",
            "kind": "canonical_theme",
            "name_en": "Grid",
            "name_zh": "电网",
            "source_family": null,
            "native_id": null,
            "mapping": {
              "state": "SUBJECT_IS_CANONICAL",
              "theme_node_ids": []
            },
            "availability": "AVAILABLE",
            "reason_codes": [],
            "eligibility": {
              "status": "NOT_QUALIFIED",
              "policy_revision": null,
              "reason_codes": [
                "D2E_UNSEALED"
              ]
            },
            "owner_receipts": {
              "ontology": {
                "owner": "ontology",
                "schema": "controlled.ontology/v1",
                "generation_id": "controlled-ontology",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "canonical_mapping": {
                    "state": "SUBJECT_IS_CANONICAL",
                    "theme_node_ids": []
                  }
                },
                "sha256": "85f1054b1c383e849b07371455d6c199e8076380c1b38ac150482f81addbecaa"
              },
              "identity": {
                "owner": "identity",
                "schema": "controlled.identity/v1",
                "generation_id": "controlled-identity",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "RESOLVED",
                  "issuer_ids": [
                    "issuer:HUBB"
                  ]
                },
                "sha256": "0983daaee5af12f0f45c316ab53a13bdbe80e1263e10ac2409a0f040b5954f1e"
              },
              "membership": {
                "owner": "membership",
                "schema": "controlled.membership/v1",
                "generation_id": "controlled-membership",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "AVAILABLE",
                  "members": [
                    {
                      "ticker": "HUBB",
                      "issuer_id": "issuer:HUBB",
                      "security_id": "security:HUBB"
                    }
                  ],
                  "declared_count": 1,
                  "eligible_count": 1,
                  "observed_count": 1,
                  "basis": "qualified_owner_query",
                  "era": "OBSERVED"
                },
                "sha256": "b5d396c55f0c6a1a2ac1093d686927ab4817941e2eb1bf28ce9b5cda6d7831ce"
              },
              "rights": {
                "owner": "rights",
                "schema": "controlled.rights/v1",
                "generation_id": "controlled-rights",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "allowed": true,
                  "purpose": "research_internal",
                  "revision": "controlled-rights"
                },
                "sha256": "c294d767fd31122298487bd9bab3b141229d89eaf7966c8bee4a7f1aaa4865ad"
              },
              "eligibility": {
                "owner": "eligibility",
                "schema": "controlled.eligibility/v1",
                "generation_id": "controlled-eligibility",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "NOT_QUALIFIED",
                  "policy_revision": null,
                  "reason_codes": [
                    "D2E_UNSEALED"
                  ]
                },
                "sha256": "558416202a533f168f06ce9274b45bae69669df9aaddb7757d27a5a898f88446"
              }
            },
            "observations": {},
            "aggregation": {
              "status": "UNAVAILABLE",
              "receipt": null,
              "reason_codes": [
                "CANONICAL_AGGREGATION_UNSUPPLIED"
              ]
            }
          }
        }
      ]
    },
    "warnings": [
      "active_membership_unmapped"
    ],
    "status": "partial"
  },
  "manifest": {
    "schema": "company_theme_exposure_manifest.v2",
    "mode": "shadow",
    "authority_caps": {
      "is_context_only": true,
      "may_rank": false,
      "may_gate": false,
      "may_size": false,
      "may_escalate": false,
      "may_trade": false,
      "may_publish": false
    },
    "generation_id": "2ce2db434d62e82e98ad9503",
    "generated_at": "2026-10-03T12:00:00Z",
    "company_count": 1,
    "exposure_count": 1,
    "local_membership_count": 1,
    "coverage": {
      "active_membership_count": 2,
      "mapped_membership_count": 1,
      "unmapped_membership_count": 1,
      "active_member_ticker_count": 1,
      "unmapped_only_ticker_count": 0,
      "active_member_tickers_without_company_context": 0
    },
    "local_coverage": {
      "available_company_count": 1,
      "valid_empty_company_count": 0,
      "unavailable_company_count": 0
    },
    "source": {
      "company_intelligence": {
        "generation_id": "12f72d4cfd18f40064813309",
        "sha256": "9e10c35b7a74b3dead2ac55b05ac63742a5dd1c82e7ed0197ba0958878831198"
      },
      "membership": {
        "canonical_json_sha256": "c46919f03c197f9328fa836fbf08025ce7fec094abb4df196c1d4aba02723806"
      },
      "crosswalk": {
        "canonical_json_sha256": "fc7cfb121c74289b4696ddaf936c108bb75200a044bac8fdf292d1fdfc00c752"
      },
      "theme_state": {
        "schema": "theme_state/v1",
        "status": "AVAILABLE",
        "expected_generation_id": "64dd0f7a510b052607448fc31550755e",
        "generation_id": "64dd0f7a510b052607448fc31550755e",
        "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
        "state_generated_at": "2026-10-03T12:00:00Z",
        "canonical_json_sha256": "0bb5fc9976b009515cd397e84dbc9b389d689e21c3490d2c0ab302bcb03acaad",
        "raw_bytes_sha256": null,
        "raw_bytes_status": "UNMATERIALIZED",
        "graph_generation_id": "controlled-graph",
        "owner_generations": {
          "eligibility": "controlled-eligibility",
          "identity": "controlled-identity",
          "membership": "controlled-membership",
          "ontology": "controlled-ontology",
          "rights": "controlled-rights",
          "specialist": "controlled-specialist"
        },
        "effective_at": "2026-10-03",
        "known_at": "2026-10-03T12:00:00Z",
        "reads": [
          {
            "schema": "gmi.theme_state_read/v1",
            "status": "DESCRIPTIVE",
            "reason_codes": [],
            "subject_id": "ltheme:finviz:power_grid",
            "generation_id": "64dd0f7a510b052607448fc31550755e",
            "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
            "state_generated_at": "2026-10-03T12:00:00Z",
            "effective_at": "2026-10-03",
            "known_at": "2026-10-03T12:00:00Z",
            "subject": {
              "node_id": "ltheme:finviz:power_grid",
              "kind": "local_theme",
              "name_en": "Grid",
              "name_zh": "电网",
              "source_family": "finviz",
              "native_id": "power_grid",
              "mapping": {
                "state": "UNMAPPED",
                "theme_node_ids": []
              },
              "availability": "AVAILABLE",
              "reason_codes": [],
              "eligibility": {
                "status": "NOT_QUALIFIED",
                "policy_revision": null,
                "reason_codes": [
                  "D2E_UNSEALED"
                ]
              },
              "owner_receipts": {
                "ontology": {
                  "owner": "ontology",
                  "schema": "controlled.ontology/v1",
                  "generation_id": "controlled-ontology",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "ltheme:finviz:power_grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "canonical_mapping": {
                      "state": "UNMAPPED",
                      "theme_node_ids": []
                    }
                  },
                  "sha256": "1476d9e978b2dc1948dfe36cf2b32b79e0d4621486a025139f51fbfd1e39a29d"
                },
                "identity": {
                  "owner": "identity",
                  "schema": "controlled.identity/v1",
                  "generation_id": "controlled-identity",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "ltheme:finviz:power_grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "status": "RESOLVED",
                    "issuer_ids": [
                      "issuer:HUBB"
                    ]
                  },
                  "sha256": "0983daaee5af12f0f45c316ab53a13bdbe80e1263e10ac2409a0f040b5954f1e"
                },
                "membership": {
                  "owner": "membership",
                  "schema": "controlled.membership/v1",
                  "generation_id": "controlled-membership",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "ltheme:finviz:power_grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "status": "AVAILABLE",
                    "members": [
                      {
                        "ticker": "HUBB",
                        "issuer_id": "issuer:HUBB",
                        "security_id": "security:HUBB"
                      }
                    ],
                    "declared_count": 1,
                    "eligible_count": 1,
                    "observed_count": 1,
                    "basis": "qualified_owner_query",
                    "era": "OBSERVED"
                  },
                  "sha256": "b5d396c55f0c6a1a2ac1093d686927ab4817941e2eb1bf28ce9b5cda6d7831ce"
                },
                "rights": {
                  "owner": "rights",
                  "schema": "controlled.rights/v1",
                  "generation_id": "controlled-rights",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "ltheme:finviz:power_grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "allowed": true,
                    "purpose": "research_internal",
                    "revision": "controlled-rights"
                  },
                  "sha256": "c294d767fd31122298487bd9bab3b141229d89eaf7966c8bee4a7f1aaa4865ad"
                },
                "eligibility": {
                  "owner": "eligibility",
                  "schema": "controlled.eligibility/v1",
                  "generation_id": "controlled-eligibility",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "ltheme:finviz:power_grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "status": "NOT_QUALIFIED",
                    "policy_revision": null,
                    "reason_codes": [
                      "D2E_UNSEALED"
                    ]
                  },
                  "sha256": "558416202a533f168f06ce9274b45bae69669df9aaddb7757d27a5a898f88446"
                }
              },
              "observations": {},
              "aggregation": {
                "status": "NOT_APPLICABLE",
                "receipt": null,
                "reason_codes": []
              }
            }
          },
          {
            "schema": "gmi.theme_state_read/v1",
            "status": "DESCRIPTIVE",
            "reason_codes": [],
            "subject_id": "theme:grid",
            "generation_id": "64dd0f7a510b052607448fc31550755e",
            "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
            "state_generated_at": "2026-10-03T12:00:00Z",
            "effective_at": "2026-10-03",
            "known_at": "2026-10-03T12:00:00Z",
            "subject": {
              "node_id": "theme:grid",
              "kind": "canonical_theme",
              "name_en": "Grid",
              "name_zh": "电网",
              "source_family": null,
              "native_id": null,
              "mapping": {
                "state": "SUBJECT_IS_CANONICAL",
                "theme_node_ids": []
              },
              "availability": "AVAILABLE",
              "reason_codes": [],
              "eligibility": {
                "status": "NOT_QUALIFIED",
                "policy_revision": null,
                "reason_codes": [
                  "D2E_UNSEALED"
                ]
              },
              "owner_receipts": {
                "ontology": {
                  "owner": "ontology",
                  "schema": "controlled.ontology/v1",
                  "generation_id": "controlled-ontology",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "theme:grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "canonical_mapping": {
                      "state": "SUBJECT_IS_CANONICAL",
                      "theme_node_ids": []
                    }
                  },
                  "sha256": "85f1054b1c383e849b07371455d6c199e8076380c1b38ac150482f81addbecaa"
                },
                "identity": {
                  "owner": "identity",
                  "schema": "controlled.identity/v1",
                  "generation_id": "controlled-identity",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "theme:grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "status": "RESOLVED",
                    "issuer_ids": [
                      "issuer:HUBB"
                    ]
                  },
                  "sha256": "0983daaee5af12f0f45c316ab53a13bdbe80e1263e10ac2409a0f040b5954f1e"
                },
                "membership": {
                  "owner": "membership",
                  "schema": "controlled.membership/v1",
                  "generation_id": "controlled-membership",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "theme:grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "status": "AVAILABLE",
                    "members": [
                      {
                        "ticker": "HUBB",
                        "issuer_id": "issuer:HUBB",
                        "security_id": "security:HUBB"
                      }
                    ],
                    "declared_count": 1,
                    "eligible_count": 1,
                    "observed_count": 1,
                    "basis": "qualified_owner_query",
                    "era": "OBSERVED"
                  },
                  "sha256": "b5d396c55f0c6a1a2ac1093d686927ab4817941e2eb1bf28ce9b5cda6d7831ce"
                },
                "rights": {
                  "owner": "rights",
                  "schema": "controlled.rights/v1",
                  "generation_id": "controlled-rights",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "theme:grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "allowed": true,
                    "purpose": "research_internal",
                    "revision": "controlled-rights"
                  },
                  "sha256": "c294d767fd31122298487bd9bab3b141229d89eaf7966c8bee4a7f1aaa4865ad"
                },
                "eligibility": {
                  "owner": "eligibility",
                  "schema": "controlled.eligibility/v1",
                  "generation_id": "controlled-eligibility",
                  "graph_generation_id": "controlled-graph",
                  "subject_id": "theme:grid",
                  "query": {
                    "effective_at": "2026-10-03",
                    "known_at": "2026-10-03T12:00:00Z"
                  },
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T09:00:00Z",
                  "available_at": "2026-10-03T08:00:00Z",
                  "recorded_at": "2026-10-03T09:00:00Z",
                  "availability": "AVAILABLE",
                  "payload": {
                    "status": "NOT_QUALIFIED",
                    "policy_revision": null,
                    "reason_codes": [
                      "D2E_UNSEALED"
                    ]
                  },
                  "sha256": "558416202a533f168f06ce9274b45bae69669df9aaddb7757d27a5a898f88446"
                }
              },
              "observations": {},
              "aggregation": {
                "status": "UNAVAILABLE",
                "receipt": null,
                "reason_codes": [
                  "CANONICAL_AGGREGATION_UNSUPPLIED"
                ]
              }
            }
          }
        ]
      },
      "company_identity_reads": {
        "canonical_json_sha256": "5e434031587faea9315570bd8dd1ce0612f9067acb42886e518e0443d21814be"
      },
      "local_membership_reads": {
        "canonical_json_sha256": "7da9353fd3629876ad9bc6a7c4d401415b376da52f64fe30edeb9971c2cd3eb1"
      },
      "builder": "company_theme_exposure.v2.shadow"
    },
    "files": {},
    "status": "partial",
    "warnings": [
      "active_memberships_unmapped"
    ]
  }
};
const DELTAS = {
  "qualified": [
    {
      "path": [
        "exposure",
        "generation_id"
      ],
      "value": "c3b0fcc7c0ab7558fd806867"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "expected_generation_id"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bf"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "generation_id"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bf"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "state_sha256"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bfd83ebb6be1acf9bcabf3da2ebaeaa6c7"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": "7629e327b5b181286dc2673c0fbd87d1c10d2517365cc2e60ef152e3e1357de9"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "status"
      ],
      "value": "QUALIFIED"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "generation_id"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bf"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "state_sha256"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bfd83ebb6be1acf9bcabf3da2ebaeaa6c7"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject",
        "eligibility",
        "status"
      ],
      "value": "QUALIFIED"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject",
        "eligibility",
        "policy_revision"
      ],
      "value": "controlled-sealed"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject",
        "eligibility",
        "reason_codes"
      ],
      "value": []
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject",
        "owner_receipts",
        "eligibility",
        "payload",
        "status"
      ],
      "value": "QUALIFIED"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject",
        "owner_receipts",
        "eligibility",
        "payload",
        "policy_revision"
      ],
      "value": "controlled-sealed"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject",
        "owner_receipts",
        "eligibility",
        "payload",
        "reason_codes"
      ],
      "value": []
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject",
        "owner_receipts",
        "eligibility",
        "sha256"
      ],
      "value": "d181ab7232f48b5394e968b6ff16388e39ca98f10bbd947b60d13debea5ef6e5"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "generation_id"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bf"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "state_sha256"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bfd83ebb6be1acf9bcabf3da2ebaeaa6c7"
    },
    {
      "path": [
        "manifest",
        "generation_id"
      ],
      "value": "c3b0fcc7c0ab7558fd806867"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "expected_generation_id"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bf"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "generation_id"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bf"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "state_sha256"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bfd83ebb6be1acf9bcabf3da2ebaeaa6c7"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": "7629e327b5b181286dc2673c0fbd87d1c10d2517365cc2e60ef152e3e1357de9"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "status"
      ],
      "value": "QUALIFIED"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "generation_id"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bf"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "state_sha256"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bfd83ebb6be1acf9bcabf3da2ebaeaa6c7"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject",
        "eligibility",
        "status"
      ],
      "value": "QUALIFIED"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject",
        "eligibility",
        "policy_revision"
      ],
      "value": "controlled-sealed"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject",
        "eligibility",
        "reason_codes"
      ],
      "value": []
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject",
        "owner_receipts",
        "eligibility",
        "payload",
        "status"
      ],
      "value": "QUALIFIED"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject",
        "owner_receipts",
        "eligibility",
        "payload",
        "policy_revision"
      ],
      "value": "controlled-sealed"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject",
        "owner_receipts",
        "eligibility",
        "payload",
        "reason_codes"
      ],
      "value": []
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject",
        "owner_receipts",
        "eligibility",
        "sha256"
      ],
      "value": "d181ab7232f48b5394e968b6ff16388e39ca98f10bbd947b60d13debea5ef6e5"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "generation_id"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bf"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "state_sha256"
      ],
      "value": "214f1bb2a6a549b1688b52f31b5249bfd83ebb6be1acf9bcabf3da2ebaeaa6c7"
    }
  ],
  "valid_empty": [
    {
      "path": [
        "exposure",
        "generation_id"
      ],
      "value": "77a89f2d19675e3a9e36f5a1"
    },
    {
      "path": [
        "exposure",
        "local_membership",
        "availability"
      ],
      "value": "VALID_EMPTY"
    },
    {
      "path": [
        "exposure",
        "local_membership",
        "payload",
        "declared_count"
      ],
      "value": 0
    },
    {
      "path": [
        "exposure",
        "local_membership",
        "payload",
        "memberships"
      ],
      "value": []
    },
    {
      "path": [
        "exposure",
        "local_membership",
        "sha256"
      ],
      "value": "09878ce3728851a5db01698ed1d07814784caf247afd683b7fea925b9f7a9d1b"
    },
    {
      "path": [
        "exposure",
        "local_memberships"
      ],
      "value": []
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "status"
      ],
      "value": "VALID_EMPTY"
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "declared_count"
      ],
      "value": 0
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "observed_count"
      ],
      "value": 0
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "state_available_count"
      ],
      "value": 0
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads"
      ],
      "value": [
        {
          "schema": "gmi.theme_state_read/v1",
          "status": "DESCRIPTIVE",
          "reason_codes": [],
          "subject_id": "theme:grid",
          "generation_id": "64dd0f7a510b052607448fc31550755e",
          "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
          "state_generated_at": "2026-10-03T12:00:00Z",
          "effective_at": "2026-10-03",
          "known_at": "2026-10-03T12:00:00Z",
          "subject": {
            "node_id": "theme:grid",
            "kind": "canonical_theme",
            "name_en": "Grid",
            "name_zh": "电网",
            "source_family": null,
            "native_id": null,
            "mapping": {
              "state": "SUBJECT_IS_CANONICAL",
              "theme_node_ids": []
            },
            "availability": "AVAILABLE",
            "reason_codes": [],
            "eligibility": {
              "status": "NOT_QUALIFIED",
              "policy_revision": null,
              "reason_codes": [
                "D2E_UNSEALED"
              ]
            },
            "owner_receipts": {
              "ontology": {
                "owner": "ontology",
                "schema": "controlled.ontology/v1",
                "generation_id": "controlled-ontology",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "canonical_mapping": {
                    "state": "SUBJECT_IS_CANONICAL",
                    "theme_node_ids": []
                  }
                },
                "sha256": "85f1054b1c383e849b07371455d6c199e8076380c1b38ac150482f81addbecaa"
              },
              "identity": {
                "owner": "identity",
                "schema": "controlled.identity/v1",
                "generation_id": "controlled-identity",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "RESOLVED",
                  "issuer_ids": [
                    "issuer:HUBB"
                  ]
                },
                "sha256": "0983daaee5af12f0f45c316ab53a13bdbe80e1263e10ac2409a0f040b5954f1e"
              },
              "membership": {
                "owner": "membership",
                "schema": "controlled.membership/v1",
                "generation_id": "controlled-membership",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "AVAILABLE",
                  "members": [
                    {
                      "ticker": "HUBB",
                      "issuer_id": "issuer:HUBB",
                      "security_id": "security:HUBB"
                    }
                  ],
                  "declared_count": 1,
                  "eligible_count": 1,
                  "observed_count": 1,
                  "basis": "qualified_owner_query",
                  "era": "OBSERVED"
                },
                "sha256": "b5d396c55f0c6a1a2ac1093d686927ab4817941e2eb1bf28ce9b5cda6d7831ce"
              },
              "rights": {
                "owner": "rights",
                "schema": "controlled.rights/v1",
                "generation_id": "controlled-rights",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "allowed": true,
                  "purpose": "research_internal",
                  "revision": "controlled-rights"
                },
                "sha256": "c294d767fd31122298487bd9bab3b141229d89eaf7966c8bee4a7f1aaa4865ad"
              },
              "eligibility": {
                "owner": "eligibility",
                "schema": "controlled.eligibility/v1",
                "generation_id": "controlled-eligibility",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "NOT_QUALIFIED",
                  "policy_revision": null,
                  "reason_codes": [
                    "D2E_UNSEALED"
                  ]
                },
                "sha256": "558416202a533f168f06ce9274b45bae69669df9aaddb7757d27a5a898f88446"
              }
            },
            "observations": {},
            "aggregation": {
              "status": "UNAVAILABLE",
              "receipt": null,
              "reason_codes": [
                "CANONICAL_AGGREGATION_UNSUPPLIED"
              ]
            }
          }
        }
      ]
    },
    {
      "path": [
        "manifest",
        "generation_id"
      ],
      "value": "77a89f2d19675e3a9e36f5a1"
    },
    {
      "path": [
        "manifest",
        "local_membership_count"
      ],
      "value": 0
    },
    {
      "path": [
        "manifest",
        "local_coverage",
        "available_company_count"
      ],
      "value": 0
    },
    {
      "path": [
        "manifest",
        "local_coverage",
        "valid_empty_company_count"
      ],
      "value": 1
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads"
      ],
      "value": [
        {
          "schema": "gmi.theme_state_read/v1",
          "status": "DESCRIPTIVE",
          "reason_codes": [],
          "subject_id": "theme:grid",
          "generation_id": "64dd0f7a510b052607448fc31550755e",
          "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
          "state_generated_at": "2026-10-03T12:00:00Z",
          "effective_at": "2026-10-03",
          "known_at": "2026-10-03T12:00:00Z",
          "subject": {
            "node_id": "theme:grid",
            "kind": "canonical_theme",
            "name_en": "Grid",
            "name_zh": "电网",
            "source_family": null,
            "native_id": null,
            "mapping": {
              "state": "SUBJECT_IS_CANONICAL",
              "theme_node_ids": []
            },
            "availability": "AVAILABLE",
            "reason_codes": [],
            "eligibility": {
              "status": "NOT_QUALIFIED",
              "policy_revision": null,
              "reason_codes": [
                "D2E_UNSEALED"
              ]
            },
            "owner_receipts": {
              "ontology": {
                "owner": "ontology",
                "schema": "controlled.ontology/v1",
                "generation_id": "controlled-ontology",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "canonical_mapping": {
                    "state": "SUBJECT_IS_CANONICAL",
                    "theme_node_ids": []
                  }
                },
                "sha256": "85f1054b1c383e849b07371455d6c199e8076380c1b38ac150482f81addbecaa"
              },
              "identity": {
                "owner": "identity",
                "schema": "controlled.identity/v1",
                "generation_id": "controlled-identity",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "RESOLVED",
                  "issuer_ids": [
                    "issuer:HUBB"
                  ]
                },
                "sha256": "0983daaee5af12f0f45c316ab53a13bdbe80e1263e10ac2409a0f040b5954f1e"
              },
              "membership": {
                "owner": "membership",
                "schema": "controlled.membership/v1",
                "generation_id": "controlled-membership",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "AVAILABLE",
                  "members": [
                    {
                      "ticker": "HUBB",
                      "issuer_id": "issuer:HUBB",
                      "security_id": "security:HUBB"
                    }
                  ],
                  "declared_count": 1,
                  "eligible_count": 1,
                  "observed_count": 1,
                  "basis": "qualified_owner_query",
                  "era": "OBSERVED"
                },
                "sha256": "b5d396c55f0c6a1a2ac1093d686927ab4817941e2eb1bf28ce9b5cda6d7831ce"
              },
              "rights": {
                "owner": "rights",
                "schema": "controlled.rights/v1",
                "generation_id": "controlled-rights",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "allowed": true,
                  "purpose": "research_internal",
                  "revision": "controlled-rights"
                },
                "sha256": "c294d767fd31122298487bd9bab3b141229d89eaf7966c8bee4a7f1aaa4865ad"
              },
              "eligibility": {
                "owner": "eligibility",
                "schema": "controlled.eligibility/v1",
                "generation_id": "controlled-eligibility",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "NOT_QUALIFIED",
                  "policy_revision": null,
                  "reason_codes": [
                    "D2E_UNSEALED"
                  ]
                },
                "sha256": "558416202a533f168f06ce9274b45bae69669df9aaddb7757d27a5a898f88446"
              }
            },
            "observations": {},
            "aggregation": {
              "status": "UNAVAILABLE",
              "receipt": null,
              "reason_codes": [
                "CANONICAL_AGGREGATION_UNSUPPLIED"
              ]
            }
          }
        }
      ]
    },
    {
      "path": [
        "manifest",
        "source",
        "local_membership_reads",
        "canonical_json_sha256"
      ],
      "value": "b2ebb887f2f4710fa5463e0409a4d936cfc710513ce5c3e692f194fc202dc2de"
    }
  ],
  "unavailable": [
    {
      "path": [
        "exposure",
        "generation_id"
      ],
      "value": "42778bc643315c7958ef6482"
    },
    {
      "path": [
        "exposure",
        "local_membership",
        "availability"
      ],
      "value": "UNAVAILABLE"
    },
    {
      "path": [
        "exposure",
        "local_membership",
        "payload"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "local_membership",
        "sha256"
      ],
      "value": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
    },
    {
      "path": [
        "exposure",
        "local_memberships"
      ],
      "value": []
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "status"
      ],
      "value": "UNAVAILABLE"
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "declared_count"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "observed_count"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "state_available_count"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "reason_codes"
      ],
      "value": [
        "LOCAL_MEMBERSHIP_UNAVAILABLE"
      ]
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads"
      ],
      "value": [
        {
          "schema": "gmi.theme_state_read/v1",
          "status": "DESCRIPTIVE",
          "reason_codes": [],
          "subject_id": "theme:grid",
          "generation_id": "64dd0f7a510b052607448fc31550755e",
          "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
          "state_generated_at": "2026-10-03T12:00:00Z",
          "effective_at": "2026-10-03",
          "known_at": "2026-10-03T12:00:00Z",
          "subject": {
            "node_id": "theme:grid",
            "kind": "canonical_theme",
            "name_en": "Grid",
            "name_zh": "电网",
            "source_family": null,
            "native_id": null,
            "mapping": {
              "state": "SUBJECT_IS_CANONICAL",
              "theme_node_ids": []
            },
            "availability": "AVAILABLE",
            "reason_codes": [],
            "eligibility": {
              "status": "NOT_QUALIFIED",
              "policy_revision": null,
              "reason_codes": [
                "D2E_UNSEALED"
              ]
            },
            "owner_receipts": {
              "ontology": {
                "owner": "ontology",
                "schema": "controlled.ontology/v1",
                "generation_id": "controlled-ontology",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "canonical_mapping": {
                    "state": "SUBJECT_IS_CANONICAL",
                    "theme_node_ids": []
                  }
                },
                "sha256": "85f1054b1c383e849b07371455d6c199e8076380c1b38ac150482f81addbecaa"
              },
              "identity": {
                "owner": "identity",
                "schema": "controlled.identity/v1",
                "generation_id": "controlled-identity",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "RESOLVED",
                  "issuer_ids": [
                    "issuer:HUBB"
                  ]
                },
                "sha256": "0983daaee5af12f0f45c316ab53a13bdbe80e1263e10ac2409a0f040b5954f1e"
              },
              "membership": {
                "owner": "membership",
                "schema": "controlled.membership/v1",
                "generation_id": "controlled-membership",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "AVAILABLE",
                  "members": [
                    {
                      "ticker": "HUBB",
                      "issuer_id": "issuer:HUBB",
                      "security_id": "security:HUBB"
                    }
                  ],
                  "declared_count": 1,
                  "eligible_count": 1,
                  "observed_count": 1,
                  "basis": "qualified_owner_query",
                  "era": "OBSERVED"
                },
                "sha256": "b5d396c55f0c6a1a2ac1093d686927ab4817941e2eb1bf28ce9b5cda6d7831ce"
              },
              "rights": {
                "owner": "rights",
                "schema": "controlled.rights/v1",
                "generation_id": "controlled-rights",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "allowed": true,
                  "purpose": "research_internal",
                  "revision": "controlled-rights"
                },
                "sha256": "c294d767fd31122298487bd9bab3b141229d89eaf7966c8bee4a7f1aaa4865ad"
              },
              "eligibility": {
                "owner": "eligibility",
                "schema": "controlled.eligibility/v1",
                "generation_id": "controlled-eligibility",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "NOT_QUALIFIED",
                  "policy_revision": null,
                  "reason_codes": [
                    "D2E_UNSEALED"
                  ]
                },
                "sha256": "558416202a533f168f06ce9274b45bae69669df9aaddb7757d27a5a898f88446"
              }
            },
            "observations": {},
            "aggregation": {
              "status": "UNAVAILABLE",
              "receipt": null,
              "reason_codes": [
                "CANONICAL_AGGREGATION_UNSUPPLIED"
              ]
            }
          }
        }
      ]
    },
    {
      "path": [
        "exposure",
        "warnings"
      ],
      "value": [
        "active_membership_unmapped",
        "local_membership_unavailable"
      ]
    },
    {
      "path": [
        "manifest",
        "generation_id"
      ],
      "value": "42778bc643315c7958ef6482"
    },
    {
      "path": [
        "manifest",
        "local_membership_count"
      ],
      "value": 0
    },
    {
      "path": [
        "manifest",
        "local_coverage",
        "available_company_count"
      ],
      "value": 0
    },
    {
      "path": [
        "manifest",
        "local_coverage",
        "unavailable_company_count"
      ],
      "value": 1
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads"
      ],
      "value": [
        {
          "schema": "gmi.theme_state_read/v1",
          "status": "DESCRIPTIVE",
          "reason_codes": [],
          "subject_id": "theme:grid",
          "generation_id": "64dd0f7a510b052607448fc31550755e",
          "state_sha256": "64dd0f7a510b052607448fc31550755efa12d115d5fc3922f9b8564b6a8b330f",
          "state_generated_at": "2026-10-03T12:00:00Z",
          "effective_at": "2026-10-03",
          "known_at": "2026-10-03T12:00:00Z",
          "subject": {
            "node_id": "theme:grid",
            "kind": "canonical_theme",
            "name_en": "Grid",
            "name_zh": "电网",
            "source_family": null,
            "native_id": null,
            "mapping": {
              "state": "SUBJECT_IS_CANONICAL",
              "theme_node_ids": []
            },
            "availability": "AVAILABLE",
            "reason_codes": [],
            "eligibility": {
              "status": "NOT_QUALIFIED",
              "policy_revision": null,
              "reason_codes": [
                "D2E_UNSEALED"
              ]
            },
            "owner_receipts": {
              "ontology": {
                "owner": "ontology",
                "schema": "controlled.ontology/v1",
                "generation_id": "controlled-ontology",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "canonical_mapping": {
                    "state": "SUBJECT_IS_CANONICAL",
                    "theme_node_ids": []
                  }
                },
                "sha256": "85f1054b1c383e849b07371455d6c199e8076380c1b38ac150482f81addbecaa"
              },
              "identity": {
                "owner": "identity",
                "schema": "controlled.identity/v1",
                "generation_id": "controlled-identity",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "RESOLVED",
                  "issuer_ids": [
                    "issuer:HUBB"
                  ]
                },
                "sha256": "0983daaee5af12f0f45c316ab53a13bdbe80e1263e10ac2409a0f040b5954f1e"
              },
              "membership": {
                "owner": "membership",
                "schema": "controlled.membership/v1",
                "generation_id": "controlled-membership",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "AVAILABLE",
                  "members": [
                    {
                      "ticker": "HUBB",
                      "issuer_id": "issuer:HUBB",
                      "security_id": "security:HUBB"
                    }
                  ],
                  "declared_count": 1,
                  "eligible_count": 1,
                  "observed_count": 1,
                  "basis": "qualified_owner_query",
                  "era": "OBSERVED"
                },
                "sha256": "b5d396c55f0c6a1a2ac1093d686927ab4817941e2eb1bf28ce9b5cda6d7831ce"
              },
              "rights": {
                "owner": "rights",
                "schema": "controlled.rights/v1",
                "generation_id": "controlled-rights",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "allowed": true,
                  "purpose": "research_internal",
                  "revision": "controlled-rights"
                },
                "sha256": "c294d767fd31122298487bd9bab3b141229d89eaf7966c8bee4a7f1aaa4865ad"
              },
              "eligibility": {
                "owner": "eligibility",
                "schema": "controlled.eligibility/v1",
                "generation_id": "controlled-eligibility",
                "graph_generation_id": "controlled-graph",
                "subject_id": "theme:grid",
                "query": {
                  "effective_at": "2026-10-03",
                  "known_at": "2026-10-03T12:00:00Z"
                },
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T09:00:00Z",
                "available_at": "2026-10-03T08:00:00Z",
                "recorded_at": "2026-10-03T09:00:00Z",
                "availability": "AVAILABLE",
                "payload": {
                  "status": "NOT_QUALIFIED",
                  "policy_revision": null,
                  "reason_codes": [
                    "D2E_UNSEALED"
                  ]
                },
                "sha256": "558416202a533f168f06ce9274b45bae69669df9aaddb7757d27a5a898f88446"
              }
            },
            "observations": {},
            "aggregation": {
              "status": "UNAVAILABLE",
              "receipt": null,
              "reason_codes": [
                "CANONICAL_AGGREGATION_UNSUPPLIED"
              ]
            }
          }
        }
      ]
    },
    {
      "path": [
        "manifest",
        "source",
        "local_membership_reads",
        "canonical_json_sha256"
      ],
      "value": "9be51b5d9c1eea311cc81e135110c1fcac00f5c2e44e462e52134dc1195a231b"
    },
    {
      "path": [
        "manifest",
        "warnings"
      ],
      "value": [
        "active_memberships_unmapped",
        "local_membership_unavailable"
      ]
    }
  ],
  "missing": [
    {
      "path": [
        "exposure",
        "generation_id"
      ],
      "value": "800a588915259c5d771533da"
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "state_available_count"
      ],
      "value": 0
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "reason_codes"
      ],
      "value": [
        "STATE_CONTEXT_UNAVAILABLE"
      ]
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "status"
      ],
      "value": "MISSING"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "generation_id"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "state_sha256"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "state_generated_at"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "graph_generation_id"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "owner_generations"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads"
      ],
      "value": []
    },
    {
      "path": [
        "exposure",
        "warnings"
      ],
      "value": [
        "active_membership_unmapped",
        "theme_state_missing"
      ]
    },
    {
      "path": [
        "manifest",
        "generation_id"
      ],
      "value": "800a588915259c5d771533da"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "status"
      ],
      "value": "MISSING"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "generation_id"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "state_sha256"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "state_generated_at"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "graph_generation_id"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "owner_generations"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads"
      ],
      "value": []
    },
    {
      "path": [
        "manifest",
        "warnings"
      ],
      "value": [
        "active_memberships_unmapped",
        "theme_state_missing"
      ]
    }
  ],
  "future": [
    {
      "path": [
        "exposure",
        "generation_id"
      ],
      "value": "8f0ed2fefd883229876e4b64"
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "state_available_count"
      ],
      "value": 0
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "reason_codes"
      ],
      "value": [
        "STATE_CONTEXT_UNAVAILABLE"
      ]
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "expected_generation_id"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf32"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "generation_id"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf32"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "state_sha256"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf323ce10263f092f197b0e5cfe3a852d91e"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "state_generated_at"
      ],
      "value": "2026-10-03T13:00:00Z"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": "9ff0bee54907f1f7ba2a1fa61b567f0abd68388c21d29cd1b6f89500df580424"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "status"
      ],
      "value": "UNAVAILABLE"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "reason_codes"
      ],
      "value": [
        "STATE_NOT_YET_EMITTED"
      ]
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "generation_id"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf32"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "state_sha256"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf323ce10263f092f197b0e5cfe3a852d91e"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "state_generated_at"
      ],
      "value": "2026-10-03T13:00:00Z"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "status"
      ],
      "value": "UNAVAILABLE"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "reason_codes"
      ],
      "value": [
        "STATE_NOT_YET_EMITTED"
      ]
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "generation_id"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf32"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "state_sha256"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf323ce10263f092f197b0e5cfe3a852d91e"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "state_generated_at"
      ],
      "value": "2026-10-03T13:00:00Z"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "subject"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "warnings"
      ],
      "value": [
        "active_membership_unmapped",
        "theme_state_unavailable"
      ]
    },
    {
      "path": [
        "manifest",
        "generation_id"
      ],
      "value": "8f0ed2fefd883229876e4b64"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "expected_generation_id"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf32"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "generation_id"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf32"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "state_sha256"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf323ce10263f092f197b0e5cfe3a852d91e"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "state_generated_at"
      ],
      "value": "2026-10-03T13:00:00Z"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": "9ff0bee54907f1f7ba2a1fa61b567f0abd68388c21d29cd1b6f89500df580424"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "status"
      ],
      "value": "UNAVAILABLE"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "reason_codes"
      ],
      "value": [
        "STATE_NOT_YET_EMITTED"
      ]
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "generation_id"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf32"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "state_sha256"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf323ce10263f092f197b0e5cfe3a852d91e"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "state_generated_at"
      ],
      "value": "2026-10-03T13:00:00Z"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "status"
      ],
      "value": "UNAVAILABLE"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "reason_codes"
      ],
      "value": [
        "STATE_NOT_YET_EMITTED"
      ]
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "generation_id"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf32"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "state_sha256"
      ],
      "value": "fa37077c96addd08ea489fdc547cbf323ce10263f092f197b0e5cfe3a852d91e"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "state_generated_at"
      ],
      "value": "2026-10-03T13:00:00Z"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "subject"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "warnings"
      ],
      "value": [
        "active_memberships_unmapped",
        "theme_state_unavailable"
      ]
    }
  ],
  "rights": [
    {
      "path": [
        "exposure",
        "generation_id"
      ],
      "value": "745054e83dd3563cb770fe35"
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "state_available_count"
      ],
      "value": 0
    },
    {
      "path": [
        "exposure",
        "local_coverage",
        "reason_codes"
      ],
      "value": [
        "STATE_CONTEXT_UNAVAILABLE"
      ]
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "expected_generation_id"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "generation_id"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "state_sha256"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234c139c54db95415da3cb6ab2c5736f7d0"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": "1374698540fd483bfe5062f50c3c77ae4fd43d97dc0ced3faaa6b7fe4366f087"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "status"
      ],
      "value": "UNAVAILABLE"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "reason_codes"
      ],
      "value": [
        "RIGHTS_NOT_ADMITTED",
        "RIGHTS_UNAVAILABLE"
      ]
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "generation_id"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "state_sha256"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234c139c54db95415da3cb6ab2c5736f7d0"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject"
      ],
      "value": null
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "generation_id"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "state_sha256"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234c139c54db95415da3cb6ab2c5736f7d0"
    },
    {
      "path": [
        "exposure",
        "warnings"
      ],
      "value": [
        "active_membership_unmapped",
        "theme_state_unavailable"
      ]
    },
    {
      "path": [
        "manifest",
        "generation_id"
      ],
      "value": "745054e83dd3563cb770fe35"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "expected_generation_id"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "generation_id"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "state_sha256"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234c139c54db95415da3cb6ab2c5736f7d0"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": "1374698540fd483bfe5062f50c3c77ae4fd43d97dc0ced3faaa6b7fe4366f087"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "status"
      ],
      "value": "UNAVAILABLE"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "reason_codes"
      ],
      "value": [
        "RIGHTS_NOT_ADMITTED",
        "RIGHTS_UNAVAILABLE"
      ]
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "generation_id"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "state_sha256"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234c139c54db95415da3cb6ab2c5736f7d0"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject"
      ],
      "value": null
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "generation_id"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "state_sha256"
      ],
      "value": "30ae19e9b65333f9d51ab9acb8474234c139c54db95415da3cb6ab2c5736f7d0"
    },
    {
      "path": [
        "manifest",
        "warnings"
      ],
      "value": [
        "active_memberships_unmapped",
        "theme_state_unavailable"
      ]
    }
  ],
  "specialist": [
    {
      "path": [
        "exposure",
        "generation_id"
      ],
      "value": "673b8848f0f5f29c26570777"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "expected_generation_id"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "generation_id"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "state_sha256"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247d02a990fb84780540661b268595e4ba5"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": "2b11b33e52eaef1898591534716ee5e79efb1cb0d1852bdde79edb5c57c0b3fb"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "generation_id"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "state_sha256"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247d02a990fb84780540661b268595e4ba5"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        0,
        "subject",
        "observations"
      ],
      "value": {
        "closed_session_leadership": {
          "owner": "specialist",
          "schema": "specialist.native/v1",
          "presence": "POSITIVE",
          "freshness": "FRESH",
          "value": {
            "acceleration": null,
            "null_reason": "SHORT_HISTORY",
            "return": 1.25
          },
          "null_reason": null,
          "units": "percentage_points",
          "window": "5_closed_sessions",
          "coverage": {
            "declared": 2,
            "observed": 1,
            "basis": "CURRENT_MEMBERSHIP_NOT_PIT"
          },
          "conflicts": [
            {
              "owner": "other_native",
              "value": -1,
              "reason": "different_window"
            }
          ],
          "source_receipts": [
            {
              "owner": "specialist",
              "schema": "controlled.specialist/v1",
              "generation_id": "controlled-specialist",
              "graph_generation_id": "controlled-graph",
              "subject_id": "ltheme:finviz:power_grid",
              "query": {
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T12:00:00Z"
              },
              "effective_at": "2026-10-03T08:00:00Z",
              "known_at": "2026-10-03T09:00:00Z",
              "available_at": "2026-10-03T08:00:00Z",
              "recorded_at": "2026-10-03T09:00:00Z",
              "availability": "AVAILABLE",
              "payload": {
                "acceleration": null,
                "null_reason": "SHORT_HISTORY",
                "return": 1.25
              },
              "sha256": "44aec23609ffc77c2cbacb55cd46adfe1b6ac83bb02385d8ec5b0130ff4639f7"
            }
          ],
          "freshness_policy": {
            "max_age_hours": 30,
            "owner_policy_revision": "controlled-owner-30h"
          }
        }
      }
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "generation_id"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247"
    },
    {
      "path": [
        "exposure",
        "theme_state",
        "reads",
        1,
        "state_sha256"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247d02a990fb84780540661b268595e4ba5"
    },
    {
      "path": [
        "manifest",
        "generation_id"
      ],
      "value": "673b8848f0f5f29c26570777"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "expected_generation_id"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "generation_id"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "state_sha256"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247d02a990fb84780540661b268595e4ba5"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "canonical_json_sha256"
      ],
      "value": "2b11b33e52eaef1898591534716ee5e79efb1cb0d1852bdde79edb5c57c0b3fb"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "generation_id"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "state_sha256"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247d02a990fb84780540661b268595e4ba5"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        0,
        "subject",
        "observations"
      ],
      "value": {
        "closed_session_leadership": {
          "owner": "specialist",
          "schema": "specialist.native/v1",
          "presence": "POSITIVE",
          "freshness": "FRESH",
          "value": {
            "acceleration": null,
            "null_reason": "SHORT_HISTORY",
            "return": 1.25
          },
          "null_reason": null,
          "units": "percentage_points",
          "window": "5_closed_sessions",
          "coverage": {
            "declared": 2,
            "observed": 1,
            "basis": "CURRENT_MEMBERSHIP_NOT_PIT"
          },
          "conflicts": [
            {
              "owner": "other_native",
              "value": -1,
              "reason": "different_window"
            }
          ],
          "source_receipts": [
            {
              "owner": "specialist",
              "schema": "controlled.specialist/v1",
              "generation_id": "controlled-specialist",
              "graph_generation_id": "controlled-graph",
              "subject_id": "ltheme:finviz:power_grid",
              "query": {
                "effective_at": "2026-10-03",
                "known_at": "2026-10-03T12:00:00Z"
              },
              "effective_at": "2026-10-03T08:00:00Z",
              "known_at": "2026-10-03T09:00:00Z",
              "available_at": "2026-10-03T08:00:00Z",
              "recorded_at": "2026-10-03T09:00:00Z",
              "availability": "AVAILABLE",
              "payload": {
                "acceleration": null,
                "null_reason": "SHORT_HISTORY",
                "return": 1.25
              },
              "sha256": "44aec23609ffc77c2cbacb55cd46adfe1b6ac83bb02385d8ec5b0130ff4639f7"
            }
          ],
          "freshness_policy": {
            "max_age_hours": 30,
            "owner_policy_revision": "controlled-owner-30h"
          }
        }
      }
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "generation_id"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247"
    },
    {
      "path": [
        "manifest",
        "source",
        "theme_state",
        "reads",
        1,
        "state_sha256"
      ],
      "value": "372a30ce844930fc3409bb98e5ec7247d02a990fb84780540661b268595e4ba5"
    }
  ]
};
const LEGACY = {
  "exposure": {
    "schema": "company_theme_exposure.v1",
    "authority": "context_only",
    "generated_at": "2026-10-03T12:00:00Z",
    "generation_id": "f09416c89d28fae9b73e6b49",
    "status": "partial",
    "company": {
      "ticker": "HUBB"
    },
    "company_intelligence": {
      "generation_id": "12f72d4cfd18f40064813309",
      "context_sha256": "f310047001a7feac73d8f20f04efddeb0a11bcfdb0365ca90ae6733b1c5bc2e0",
      "latest_event_id": "cie_99207faa13c1336b21b2c9e9",
      "latest_event_call_date": "2026-10-01"
    },
    "exposures": [
      {
        "theme_id": "grid",
        "name_en": "Grid",
        "name_zh": "电网",
        "mapping_qualifier": "curated",
        "basket_id": "grid"
      }
    ],
    "coverage": {
      "status": "mixed",
      "active_basket_count": 2,
      "mapped_basket_count": 1,
      "unmapped_basket_count": 1
    },
    "theme_state": {
      "status": "missing",
      "as_of": null,
      "sha256": null
    },
    "warnings": [
      "active_membership_unmapped",
      "theme_state_missing"
    ]
  },
  "manifest": {
    "schema": "company_theme_exposure_manifest.v1",
    "generation_id": "f09416c89d28fae9b73e6b49",
    "generated_at": "2026-10-03T12:00:00Z",
    "company_count": 1,
    "exposure_count": 1,
    "coverage": {
      "active_membership_count": 2,
      "mapped_membership_count": 1,
      "unmapped_membership_count": 1,
      "active_member_ticker_count": 1,
      "unmapped_only_ticker_count": 0,
      "active_member_tickers_without_company_context": 0
    },
    "source": {
      "company_intelligence": {
        "generation_id": "12f72d4cfd18f40064813309",
        "sha256": "9e10c35b7a74b3dead2ac55b05ac63742a5dd1c82e7ed0197ba0958878831198"
      },
      "membership": {
        "sha256": "c46919f03c197f9328fa836fbf08025ce7fec094abb4df196c1d4aba02723806"
      },
      "crosswalk": {
        "sha256": "fc7cfb121c74289b4696ddaf936c108bb75200a044bac8fdf292d1fdfc00c752"
      },
      "theme_state": {
        "status": "missing",
        "as_of": null,
        "sha256": null
      },
      "builder": "company_theme_exposure.v1"
    },
    "files": {},
    "status": "partial",
    "warnings": [
      "active_memberships_unmapped",
      "theme_state_missing"
    ]
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test-only negative mutation harness.
type Loose = Record<string, any>; // Test-only controlled mutation harness, never production types.
const clone = <T>(value: T): T => structuredClone(value);
function fixture(name = "descriptive"): { exposure: Loose; manifest: Loose } {
  const result = clone(BASELINE) as { exposure: Loose; manifest: Loose };
  for (const op of DELTAS[name as keyof typeof DELTAS] ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Delta replay over controlled JSON fixture.
    let parent: any = result;
    for (const key of op.path.slice(0, -1)) parent = parent[key];
    parent[op.path[op.path.length - 1]] = clone(op.value);
  }
  return result;
}
function local(item: Loose): Loose { return item.theme_state.reads.find((r: Loose) => r.subject_id.startsWith("ltheme:")); }
function reject(change: (item: Loose) => void, name = "descriptive") { const item = fixture(name).exposure; change(item); expect(exposure(item).ok).toBe(false); }

describe("closed shadow reader from actual controlled Macro and State owners", () => {
  it("embeds the owner definitions exactly and pins development provenance", () => {
    const canonical = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
    expect(createHash("sha256").update(canonical(OWNER_STATE_CONTRACT.defs)).digest("hex")).toBe(OWNER_DEFS_CANONICAL_SHA256);
    expect(OWNER_STATE_CONTRACT.schema_sha256).toBe("a792ce31c36bc6df24449ff3e1b60fda4d73eb064bebc84c5dce2179d30f4632");
    expect(FIXTURE_PROVENANCE.producer_commit).toBe("d3aef3ae9a7e2fb707b4f6efe25611996d158ada");
    // A changed nested definition must fail the independently generated parity digest.
    const changed = clone(OWNER_STATE_CONTRACT.defs) as Loose; changed.read_receipt.additionalProperties = true;
    expect(createHash("sha256").update(canonical(changed)).digest("hex")).not.toBe(OWNER_DEFS_CANONICAL_SHA256);
  });
  it.each(["descriptive", "qualified", "valid_empty", "unavailable", "missing", "future", "rights", "specialist"])("accepts real composed %s without mutation", name => {
    const item = fixture(name), before = JSON.stringify(item); const a = exposure(item.exposure), b = manifest(item.manifest);
    expect(a.ok).toBe(true); expect(b.ok).toBe(true);
    if (a.ok) expect(a.context).toBe(item.exposure); if (b.ok) expect(b.manifest).toBe(item.manifest);
    expect(JSON.stringify(item)).toBe(before);
  });
  it("preserves local unmapped context and explicit current-valid canonical qualification", () => {
    const item = fixture().exposure; expect(local(item).subject.mapping).toEqual({ state: "UNMAPPED", theme_node_ids: [] });
    expect(exposure(item).ok).toBe(true); expect(item.local_coverage.state_available_count).toBe(1);
    expect(item.canonical_membership_qualification).toBe("CURRENT_VALID_DATE_NOT_PIT");
  });
  it("preserves specialist units/windows/nulls/conflicts and source clocks", () => {
    const item = fixture("specialist").exposure, before = clone(local(item).subject.observations);
    expect(exposure(item).ok).toBe(true); expect(local(item).subject.observations).toEqual(before);
    expect(before.closed_session_leadership.value.acceleration).toBeNull(); expect(before.closed_session_leadership.units).toBe("percentage_points");
  });
  it("does not grant delivery rights from a retained research receipt", () => {
    const item = fixture("rights").exposure; expect(exposure(item).ok).toBe(true);
    expect(local(item).status).toBe("UNAVAILABLE"); expect(item.local_memberships).toHaveLength(1); expect(item.local_coverage.state_available_count).toBe(0);
    expect(item.authority_caps.may_publish).toBe(false); expect(Object.keys(item)).not.toContain("delivery_allowed");
  });
  it("keeps explicit empty and unavailable count meanings", () => {
    expect(fixture("valid_empty").exposure.local_coverage.declared_count).toBe(0);
    expect(fixture("unavailable").exposure.local_coverage.declared_count).toBeNull();
    reject(i => { i.local_coverage.declared_count = 0; }, "unavailable");
  });
  it("requires exact dense index descriptors for open JSON arrays without normalization", () => {
    const item = fixture("specialist").exposure;
    const sparse = new Array(1) as unknown[] & { extra?: number };
    sparse.extra = 1;
    local(item).subject.observations.closed_session_leadership.value = sparse;
    expect(JSON.stringify(sparse)).toBe("[null]"); // Lossy stringify must never qualify this input.
    expect(exposure(item)).toEqual({ ok: false, reason_codes: ["INVALID_JSON"] });
    expect(Object.hasOwn(sparse, "0")).toBe(false); expect(sparse.extra).toBe(1);
    for (const value of [[], [null], [1, { named_null: null }, []]]) {
      local(item).subject.observations.closed_session_leadership.value = value;
      const result = exposure(item); expect(result.ok).toBe(true);
      if (result.ok) expect(result.context).toBe(item);
      expect(local(item).subject.observations.closed_session_leadership.value).toBe(value);
    }
  });
  it("preserves actual v1 acceptance and closes it against v2 additions", () => {
    expect(legacyExposure(clone(LEGACY.exposure))).not.toBeNull();
    expect(legacyExposure(fixture().exposure)).toBeNull();
    expect(legacyExposure({ ...clone(LEGACY.exposure), local_memberships: [] })).toBeNull();
    expect(exposure(clone(LEGACY.exposure)).ok).toBe(false);
  });
  it("has no fetch or ambient clock dependency", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden"); });
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("ambient clock forbidden"); });
    try { expect(exposure(fixture().exposure).ok).toBe(true); expect(manifest(fixture().manifest).ok).toBe(true); expect(fetchSpy).not.toHaveBeenCalled(); expect(nowSpy).not.toHaveBeenCalled(); } finally { fetchSpy.mockRestore(); nowSpy.mockRestore(); }
    const source = readFileSync(new URL("../companyThemeExposureSuccessor.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'].*(?:companyThemeExposure["']|companyIntelligence|route|components)/);
  });
  it.each([
    ["unknown root key", (i: Loose) => { i.extra = true; }],
    ["unknown state key", (i: Loose) => { i.theme_state.extra = true; }],
    ["unknown subject key", (i: Loose) => { local(i).subject.extra = true; }],
    ["numeric true", (i: Loose) => { i.authority_caps.is_context_only = 1; }],
    ["numeric false", (i: Loose) => { i.authority_caps.may_publish = 0; }],
    ["boolean count", (i: Loose) => { i.local_coverage.declared_count = true; }],
    ["publication flag", (i: Loose) => { i.authority_caps.may_publish = true; }],
    ["published mode", (i: Loose) => { i.mode = "published"; }],
    ["materialized state bytes", (i: Loose) => { i.theme_state.raw_bytes_status = "MATERIALIZED"; i.theme_state.raw_bytes_sha256 = "a".repeat(64); }],
    ["non-PIT rewrite", (i: Loose) => { i.canonical_membership_qualification = "PIT_QUALIFIED"; }],
    ["NaN", (i: Loose) => { i.local_coverage.observed_count = NaN; }],
    ["nested observation extra", (i: Loose) => { local(i).subject.observations.fake = { invented: true }; }],
  ] as const)("refuses shape/type/publication mutation: %s", (_, change) => reject(change));
  it.each([
    ["parent event null mismatch", (i: Loose) => { i.company_intelligence.latest_event_call_date = null; }],
    ["query substitution", (i: Loose) => { i.theme_state.known_at = "2026-10-03T13:00:00Z"; }],
    ["wrong state generation", (i: Loose) => { i.theme_state.generation_id = "a".repeat(32); }],
    ["digest scope substitution", (i: Loose) => { i.theme_state.state_sha256 = i.theme_state.canonical_json_sha256; }],
    ["wrong read generation", (i: Loose) => { local(i).generation_id = "a".repeat(32); }],
    ["unrelated read", (i: Loose) => { local(i).subject_id = "ltheme:finviz:OTHER"; }],
    ["duplicate read", (i: Loose) => { i.theme_state.reads.push(clone(local(i))); }],
    ["wrong native ID", (i: Loose) => { local(i).subject.native_id = "OTHER"; }],
    ["HUBB inverse / OTHER forward", (i: Loose) => { local(i).subject.owner_receipts.membership.payload.members[0] = { ticker: "OTHER", issuer_id: "issuer:OTHER", security_id: "security:OTHER" }; }],
    ["wrong issuer", (i: Loose) => { local(i).subject.owner_receipts.membership.payload.members[0].issuer_id = "issuer:OTHER"; }],
    ["wrong security", (i: Loose) => { local(i).subject.owner_receipts.membership.payload.members[0].security_id = "security:OTHER"; }],
    ["inverse source clock refreshed", (i: Loose) => { i.local_membership.available_at = "2026-10-03T08:00:00.000001Z"; }],
    ["usable state emitted +1microsecond", (i: Loose) => { i.theme_state.state_generated_at = "2026-10-03T12:00:00.000001Z"; for (const r of i.theme_state.reads) r.state_generated_at = i.theme_state.state_generated_at; }],
    ["usable state exceeds30h by1microsecond", (i: Loose) => { i.theme_state.state_generated_at = "2026-10-02T05:59:59.999999Z"; for (const r of i.theme_state.reads) r.state_generated_at = i.theme_state.state_generated_at; }],
    ["date-only knowledge at same-day cutoff", (i: Loose) => { i.local_membership.known_at = "2026-10-03"; }],
    ["definitely impossible receipt chronology", (i: Loose) => { i.local_membership.available_at = "2026-10-04"; }],
    ["malformed empty inferred AVAILABLE", (i: Loose) => { i.local_membership.payload.memberships = []; i.local_membership.payload.declared_count = 0; }],
    ["local coverage drift", (i: Loose) => { i.local_coverage.state_available_count = 0; }],
    ["canonical coverage drift", (i: Loose) => { i.coverage.active_basket_count = 3; }],
    ["observation declared/observed drift", (i: Loose) => { local(i).subject.observations.test = clone(fixture("specialist").exposure.theme_state.reads[0].subject.observations.closed_session_leadership); local(i).subject.observations.test.coverage.observed = 3; }],
    ["warning drift", (i: Loose) => { i.warnings = []; i.status = "ready"; }],
    ["usable canonical source after cutoff", (i: Loose) => { const r = i.theme_state.reads.find((v: Loose) => v.subject_id === "theme:grid").subject.owner_receipts.ontology; r.known_at = r.recorded_at = "2026-10-03T13:00:00Z"; }],
    ["usable canonical date-only source knowledge", (i: Loose) => { const r = i.theme_state.reads.find((v: Loose) => v.subject_id === "theme:grid").subject.owner_receipts.ontology; r.known_at = r.recorded_at = "2026-10-03"; }],
    ["usable subject missing rights receipt", (i: Loose) => { local(i).subject.owner_receipts.rights = null; }],
    ["usable subject denied research rights", (i: Loose) => { local(i).subject.owner_receipts.rights.payload.allowed = false; }],
    ["invalid calendar date", (i: Loose) => { i.company_intelligence.latest_event_call_date = "2026-02-30"; }],
  ] as const)("cross-field RED control: %s", (_, change) => reject(change));
  it("refuses QUALIFIED when eligibility is not qualified", () => reject(i => { local(i).status = "QUALIFIED"; }));
  it("admits the exact30h boundary and equivalent timezone source clocks", () => {
    const item = fixture().exposure; item.theme_state.state_generated_at = "2026-10-02T06:00:00Z"; for (const r of item.theme_state.reads) r.state_generated_at = item.theme_state.state_generated_at;
    item.local_membership.available_at = "2026-10-03T10:00:00+02:00"; expect(exposure(item).ok).toBe(true);
  });
  it("admits date-only uncertainty as unavailable, not inferred emptiness", () => {
    const item = fixture("unavailable").exposure; item.local_membership.known_at = "2026-10-03"; item.local_coverage.reason_codes = ["KNOWLEDGE_TIME_UNPROVEN", "LOCAL_MEMBERSHIP_UNAVAILABLE"];
    expect(exposure(item).ok).toBe(true); expect(item.local_coverage.declared_count).toBeNull();
  });
  it.each([
    ["files cannot become materialized", (i: Loose) => { i.files = { "companies/HUBB.json": { bytes: 1, sha256: "a".repeat(64) } }; }],
    ["numeric caps", (i: Loose) => { i.authority_caps.may_publish = 0; }],
    ["global canonical arithmetic", (i: Loose) => { i.coverage.active_membership_count++; }],
    ["global local denominator", (i: Loose) => { i.local_coverage.available_company_count++; }],
    ["empty company nonempty projection", (i: Loose) => { i.company_count = 0; i.local_coverage.available_company_count = 0; }],
    ["manifest query drift", (i: Loose) => { i.generated_at = "2026-10-03T13:00:00Z"; }],
    ["manifest status drift", (i: Loose) => { i.status = "ready"; }],
  ] as const)("manifest refuses %s", (_, change) => { const item = fixture().manifest; change(item); expect(manifest(item).ok).toBe(false); });
});
