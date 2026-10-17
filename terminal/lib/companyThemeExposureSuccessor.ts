/** Pure, closed validation of the Macro shadow contract. No source resolver or use grant. */
import Ajv2020 from "ajv/dist/2020";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type ObjectValue = { [key: string]: JsonValue };
export type ShadowContractReason = "INVALID_JSON" | "CLOSED_CONTRACT" | "CLOCK_BINDING" | "RECEIPT_BINDING" | "IDENTITY_BINDING" | "COVERAGE_BINDING" | "STATE_BINDING" | "STATUS_BINDING";
type Failure = { ok: false; reason_codes: readonly ShadowContractReason[] };
export interface OwnerReceipt {
  owner: string; schema: string; generation_id: string; graph_generation_id: string; subject_id: string;
  query: { effective_at: string; known_at: string }; effective_at: string; known_at: string;
  available_at: string; recorded_at: string; availability: "AVAILABLE" | "VALID_EMPTY" | "UNAVAILABLE";
  payload: JsonValue; sha256: string;
}
export interface StateObservation {
  owner: string; schema: string; presence: "POSITIVE" | "VALID_EMPTY" | "UNAVAILABLE" | "INVALID";
  freshness: "FRESH" | "STALE" | "FUTURE" | "UNKNOWN";
  value: JsonValue; null_reason: string | null; units: string | null; window: string | null;
  coverage: { declared: number; observed: number; basis: string };
  conflicts: JsonValue[]; source_receipts: OwnerReceipt[];
  freshness_policy: { max_age_hours: number; owner_policy_revision: string };
}
export interface StateSubject {
  node_id: string; kind: "local_theme" | "canonical_theme"; name_en: string; name_zh: string;
  source_family: string | null; native_id: string | null;
  mapping: { state: "MAPPED" | "UNMAPPED" | "SUBJECT_IS_CANONICAL"; theme_node_ids: string[] };
  availability: "AVAILABLE" | "UNAVAILABLE"; reason_codes: string[];
  eligibility: { status: "QUALIFIED" | "NOT_QUALIFIED" | "INELIGIBLE"; policy_revision: string | null; reason_codes: string[] };
  owner_receipts: { ontology: OwnerReceipt | null; identity: OwnerReceipt | null; membership: OwnerReceipt | null; rights: OwnerReceipt | null; eligibility: OwnerReceipt | null };
  observations: { [name: string]: StateObservation };
  aggregation: { status: "SUPPLIED" | "UNAVAILABLE" | "NOT_APPLICABLE"; receipt: OwnerReceipt | null; reason_codes: string[] };
}
export interface StateRead {
  schema: "gmi.theme_state_read/v1"; status: "QUALIFIED" | "DESCRIPTIVE" | "UNAVAILABLE";
  reason_codes: string[]; subject_id: string; generation_id: string; state_sha256: string;
  state_generated_at: string | null; effective_at: string; known_at: string; subject: StateSubject | null;
}
export interface StateBinding {
  schema: "theme_state/v1"; status: "AVAILABLE" | "MISSING"; expected_generation_id: string;
  generation_id: string | null; state_sha256: string | null; state_generated_at: string | null;
  canonical_json_sha256: string | null; raw_bytes_sha256: null; raw_bytes_status: "UNMATERIALIZED";
  graph_generation_id: string | null; owner_generations: { [role: string]: string } | null;
  effective_at: string; known_at: string; reads: StateRead[];
}
interface AuthorityCaps { is_context_only: true; may_rank: false; may_gate: false; may_size: false; may_escalate: false; may_trade: false; may_publish: false }
interface CanonicalExposure { theme_id: string; name_en: string; name_zh: string; basket_id: string; mapping_qualifier: "direct" | "proxy" | "curated" }
interface CanonicalCoverage { status: "no_active_membership" | "mapped" | "unmapped_only" | "mixed"; active_basket_count: number; mapped_basket_count: number; unmapped_basket_count: number }
interface LocalRow { company_node_id: string; node_id: string; source_family: string; native_id: string; membership_basis: string; source_refs: string[]; membership_receipt_sha256: string }
interface LocalCoverage { status: "AVAILABLE" | "VALID_EMPTY" | "UNAVAILABLE"; declared_count: number | null; observed_count: number | null; state_available_count: number | null; reason_codes: string[] }
export interface CompanyThemeExposureShadowV2 {
  schema: "company_theme_exposure.v2"; authority: "context_only"; mode: "shadow"; authority_caps: AuthorityCaps;
  generated_at: string; generation_id: string; status: "ready" | "partial";
  company: { ticker: string }; company_intelligence: { generation_id: string; context_sha256: string; latest_event_id: string | null; latest_event_call_date: string | null };
  exposures: CanonicalExposure[]; coverage: CanonicalCoverage; canonical_membership_qualification: "CURRENT_VALID_DATE_NOT_PIT";
  company_identity: OwnerReceipt | null; local_membership: OwnerReceipt | null;
  local_memberships: LocalRow[]; local_coverage: LocalCoverage; theme_state: StateBinding; warnings: string[];
}
export interface CompanyThemeExposureShadowManifestV2 {
  schema: "company_theme_exposure_manifest.v2"; mode: "shadow"; authority_caps: AuthorityCaps;
  generation_id: string; generated_at: string; company_count: number; exposure_count: number; local_membership_count: number;
  coverage: { active_membership_count: number; mapped_membership_count: number; unmapped_membership_count: number; active_member_ticker_count: number; unmapped_only_ticker_count: number; active_member_tickers_without_company_context: number };
  local_coverage: { available_company_count: number; valid_empty_company_count: number; unavailable_company_count: number };
  source: { company_intelligence: { generation_id: string; sha256: string }; membership: { canonical_json_sha256: string }; crosswalk: { canonical_json_sha256: string }; theme_state: StateBinding; company_identity_reads: { canonical_json_sha256: string }; local_membership_reads: { canonical_json_sha256: string }; builder: "company_theme_exposure.v2.shadow" };
  files: Record<string, never>; status: "ready" | "partial" | "empty"; warnings: string[];
}
export type ShadowExposureParseResult = { ok: true; context: CompanyThemeExposureShadowV2 } | Failure;
export type ShadowManifestParseResult = { ok: true; manifest: CompanyThemeExposureShadowManifestV2 } | Failure;

// OWNER_STATE_CONTRACT is inserted verbatim from the frozen owner schema by the source packet.
export const OWNER_STATE_CONTRACT = {
  "schema_sha256": "a792ce31c36bc6df24449ff3e1b60fda4d73eb064bebc84c5dce2179d30f4632",
  "source_commit": "2551f45326479a9df30435ac2ffd6c3836841bea",
  "defs": {
    "receipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "owner",
        "schema",
        "generation_id",
        "graph_generation_id",
        "subject_id",
        "query",
        "effective_at",
        "known_at",
        "available_at",
        "recorded_at",
        "availability",
        "payload",
        "sha256"
      ],
      "properties": {
        "owner": {
          "type": "string",
          "minLength": 1
        },
        "schema": {
          "type": "string",
          "minLength": 1
        },
        "generation_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "graph_generation_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "subject_id": {
          "type": "string",
          "minLength": 1
        },
        "query": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "effective_at",
            "known_at"
          ],
          "properties": {
            "effective_at": {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$"
            },
            "known_at": {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$"
            }
          }
        },
        "effective_at": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$"
        },
        "known_at": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$"
        },
        "available_at": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$"
        },
        "recorded_at": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$"
        },
        "availability": {
          "enum": [
            "AVAILABLE",
            "VALID_EMPTY",
            "UNAVAILABLE"
          ]
        },
        "payload": {},
        "sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      }
    },
    "observation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "owner",
        "schema",
        "presence",
        "freshness",
        "value",
        "null_reason",
        "units",
        "window",
        "coverage",
        "conflicts",
        "source_receipts",
        "freshness_policy"
      ],
      "properties": {
        "owner": {
          "type": "string",
          "minLength": 1
        },
        "schema": {
          "type": "string",
          "minLength": 1
        },
        "presence": {
          "enum": [
            "POSITIVE",
            "VALID_EMPTY",
            "UNAVAILABLE",
            "INVALID"
          ]
        },
        "freshness": {
          "enum": [
            "FRESH",
            "STALE",
            "FUTURE",
            "UNKNOWN"
          ]
        },
        "value": {},
        "null_reason": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "minLength": 1
            }
          ]
        },
        "units": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "minLength": 1
            }
          ]
        },
        "window": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "minLength": 1
            }
          ]
        },
        "coverage": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "declared",
            "observed",
            "basis"
          ],
          "properties": {
            "declared": {
              "type": "integer",
              "minimum": 0
            },
            "observed": {
              "type": "integer",
              "minimum": 0
            },
            "basis": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "conflicts": {
          "type": "array",
          "items": {}
        },
        "source_receipts": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/receipt"
          }
        },
        "freshness_policy": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "max_age_hours",
            "owner_policy_revision"
          ],
          "properties": {
            "max_age_hours": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "owner_policy_revision": {
              "type": "string",
              "minLength": 1
            }
          }
        }
      }
    },
    "subject": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "node_id",
        "kind",
        "name_en",
        "name_zh",
        "source_family",
        "native_id",
        "mapping",
        "availability",
        "reason_codes",
        "eligibility",
        "owner_receipts",
        "observations",
        "aggregation"
      ],
      "properties": {
        "node_id": {
          "type": "string",
          "minLength": 1
        },
        "kind": {
          "enum": [
            "local_theme",
            "canonical_theme"
          ]
        },
        "name_en": {
          "type": "string",
          "minLength": 1
        },
        "name_zh": {
          "type": "string",
          "minLength": 1
        },
        "source_family": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "minLength": 1
            }
          ]
        },
        "native_id": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "minLength": 1
            }
          ]
        },
        "mapping": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "state",
            "theme_node_ids"
          ],
          "properties": {
            "state": {
              "enum": [
                "MAPPED",
                "UNMAPPED",
                "SUBJECT_IS_CANONICAL"
              ]
            },
            "theme_node_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "pattern": "^theme:.+"
              },
              "uniqueItems": true
            }
          },
          "allOf": [
            {
              "if": {
                "properties": {
                  "state": {
                    "const": "MAPPED"
                  }
                }
              },
              "then": {
                "properties": {
                  "theme_node_ids": {
                    "minItems": 1
                  }
                }
              }
            },
            {
              "if": {
                "properties": {
                  "state": {
                    "enum": [
                      "UNMAPPED",
                      "SUBJECT_IS_CANONICAL"
                    ]
                  }
                }
              },
              "then": {
                "properties": {
                  "theme_node_ids": {
                    "maxItems": 0
                  }
                }
              }
            }
          ]
        },
        "availability": {
          "enum": [
            "AVAILABLE",
            "UNAVAILABLE"
          ]
        },
        "reason_codes": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "uniqueItems": true
        },
        "eligibility": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "status",
            "policy_revision",
            "reason_codes"
          ],
          "properties": {
            "status": {
              "enum": [
                "QUALIFIED",
                "NOT_QUALIFIED",
                "INELIGIBLE"
              ]
            },
            "policy_revision": {
              "anyOf": [
                {
                  "type": "null"
                },
                {
                  "type": "string",
                  "minLength": 1
                }
              ]
            },
            "reason_codes": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1
              },
              "uniqueItems": true
            }
          }
        },
        "owner_receipts": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "ontology",
            "identity",
            "membership",
            "rights",
            "eligibility"
          ],
          "properties": {
            "ontology": {
              "anyOf": [
                {
                  "type": "null"
                },
                {
                  "$ref": "#/$defs/receipt"
                }
              ]
            },
            "identity": {
              "anyOf": [
                {
                  "type": "null"
                },
                {
                  "$ref": "#/$defs/receipt"
                }
              ]
            },
            "membership": {
              "anyOf": [
                {
                  "type": "null"
                },
                {
                  "$ref": "#/$defs/receipt"
                }
              ]
            },
            "rights": {
              "anyOf": [
                {
                  "type": "null"
                },
                {
                  "$ref": "#/$defs/receipt"
                }
              ]
            },
            "eligibility": {
              "anyOf": [
                {
                  "type": "null"
                },
                {
                  "$ref": "#/$defs/receipt"
                }
              ]
            }
          }
        },
        "observations": {
          "type": "object",
          "propertyNames": {
            "pattern": "^[a-z][a-z0-9_]{0,95}$"
          },
          "additionalProperties": {
            "$ref": "#/$defs/observation"
          }
        },
        "aggregation": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "status",
            "receipt",
            "reason_codes"
          ],
          "properties": {
            "status": {
              "enum": [
                "SUPPLIED",
                "UNAVAILABLE",
                "NOT_APPLICABLE"
              ]
            },
            "receipt": {
              "anyOf": [
                {
                  "type": "null"
                },
                {
                  "$ref": "#/$defs/receipt"
                }
              ]
            },
            "reason_codes": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1
              },
              "uniqueItems": true
            }
          }
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "kind": {
                "const": "canonical_theme"
              }
            }
          },
          "then": {
            "properties": {
              "node_id": {
                "pattern": "^theme:.+"
              },
              "source_family": {
                "type": "null"
              },
              "native_id": {
                "type": "null"
              },
              "mapping": {
                "properties": {
                  "state": {
                    "const": "SUBJECT_IS_CANONICAL"
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "kind": {
                "const": "local_theme"
              }
            }
          },
          "then": {
            "properties": {
              "node_id": {
                "pattern": "^ltheme:(finviz|ths):[A-Za-z0-9_.\\-]+$"
              },
              "source_family": {
                "enum": [
                  "finviz",
                  "ths"
                ]
              },
              "native_id": {
                "type": "string",
                "minLength": 1
              },
              "mapping": {
                "properties": {
                  "state": {
                    "enum": [
                      "MAPPED",
                      "UNMAPPED"
                    ]
                  }
                }
              }
            }
          }
        }
      ]
    },
    "read_receipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema",
        "status",
        "reason_codes",
        "subject_id",
        "generation_id",
        "state_sha256",
        "effective_at",
        "known_at",
        "subject",
        "state_generated_at"
      ],
      "properties": {
        "schema": {
          "const": "gmi.theme_state_read/v1"
        },
        "status": {
          "enum": [
            "DESCRIPTIVE",
            "QUALIFIED",
            "UNAVAILABLE"
          ]
        },
        "reason_codes": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "uniqueItems": true
        },
        "subject_id": {
          "type": "string",
          "minLength": 1
        },
        "generation_id": {
          "type": "string",
          "pattern": "^[a-f0-9]{32}$"
        },
        "state_sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "effective_at": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$"
        },
        "known_at": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$"
        },
        "subject": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/subject"
            }
          ]
        },
        "state_generated_at": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2})$"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "status": {
                "const": "UNAVAILABLE"
              }
            }
          },
          "then": {
            "properties": {
              "subject": {
                "type": "null"
              },
              "reason_codes": {
                "minItems": 1
              }
            }
          },
          "else": {
            "properties": {
              "subject": {
                "$ref": "#/$defs/subject"
              },
              "reason_codes": {
                "maxItems": 0
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "status": {
                "const": "QUALIFIED"
              }
            }
          },
          "then": {
            "properties": {
              "subject": {
                "properties": {
                  "availability": {
                    "const": "AVAILABLE"
                  },
                  "eligibility": {
                    "properties": {
                      "status": {
                        "const": "QUALIFIED"
                      }
                    }
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "status": {
                "const": "DESCRIPTIVE"
              }
            }
          },
          "then": {
            "properties": {
              "subject": {
                "properties": {
                  "availability": {
                    "const": "AVAILABLE"
                  },
                  "eligibility": {
                    "properties": {
                      "status": {
                        "enum": [
                          "NOT_QUALIFIED",
                          "INELIGIBLE"
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "status": {
                "enum": [
                  "QUALIFIED",
                  "DESCRIPTIVE"
                ]
              }
            }
          },
          "then": {
            "properties": {
              "state_generated_at": {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2})$"
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "state_generated_at": {
                "type": "null"
              }
            }
          },
          "then": {
            "properties": {
              "status": {
                "const": "UNAVAILABLE"
              },
              "reason_codes": {
                "contains": {
                  "enum": [
                    "STATE_GENERATION_CLOCK_UNAVAILABLE",
                    "STATE_GENERATION_CLOCK_INVALID"
                  ]
                }
              }
            }
          }
        }
      ]
    }
  }
} as const;

const text = { type: "string", minLength: 1 };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const generation = { type: "string", pattern: "^[a-f0-9]{24}$" };
const stateGeneration = { type: "string", pattern: "^[a-f0-9]{32}$" };
const clock = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2}))?$" };
const instant = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2})$" };
const count = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const strings = { type: "array", items: text, uniqueItems: true };
const nullable = (value: object) => ({ anyOf: [value, { type: "null" }] });
const closed = (properties: object) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const caps = closed({ is_context_only: { const: true, type: "boolean" }, ...Object.fromEntries(["may_rank", "may_gate", "may_size", "may_escalate", "may_trade", "may_publish"].map(k => [k, { const: false, type: "boolean" }])) });
const canonicalRow = closed({ theme_id: text, name_en: text, name_zh: text, basket_id: text, mapping_qualifier: { enum: ["direct", "proxy", "curated"] } });
const canonicalCoverage = closed({ status: { enum: ["no_active_membership", "mapped", "unmapped_only", "mixed"] }, active_basket_count: { ...count, maximum: 64 }, mapped_basket_count: { ...count, maximum: 64 }, unmapped_basket_count: { ...count, maximum: 64 } });
const localRowProperties = { node_id: text, source_family: text, native_id: text, membership_basis: text, source_refs: { ...strings, minItems: 1 } };
const binding = closed({ schema: { const: "theme_state/v1" }, status: { enum: ["AVAILABLE", "MISSING"] }, expected_generation_id: stateGeneration, generation_id: nullable(stateGeneration), state_sha256: nullable(hash), state_generated_at: nullable(instant), canonical_json_sha256: nullable(hash), raw_bytes_sha256: { type: "null" }, raw_bytes_status: { const: "UNMATERIALIZED" }, graph_generation_id: nullable(text), owner_generations: nullable({ type: "object", additionalProperties: text }), effective_at: clock, known_at: instant, reads: { type: "array", items: { $ref: "#/$defs/read_receipt" } } });
const exposureSchema = { $defs: OWNER_STATE_CONTRACT.defs, ...closed({ schema: { const: "company_theme_exposure.v2" }, authority: { const: "context_only" }, mode: { const: "shadow" }, authority_caps: caps, generated_at: instant, generation_id: generation, status: { enum: ["ready", "partial"] }, company: closed({ ticker: { type: "string", pattern: "^[A-Z0-9](?:[A-Z0-9.-]{0,14}[A-Z0-9])?$" } }), company_intelligence: closed({ generation_id: generation, context_sha256: hash, latest_event_id: nullable(text), latest_event_call_date: nullable(clock) }), exposures: { type: "array", maxItems: 64, items: canonicalRow }, coverage: canonicalCoverage, canonical_membership_qualification: { const: "CURRENT_VALID_DATE_NOT_PIT" }, company_identity: nullable({ $ref: "#/$defs/receipt" }), local_membership: nullable({ $ref: "#/$defs/receipt" }), local_memberships: { type: "array", items: closed({ company_node_id: text, ...localRowProperties, membership_receipt_sha256: hash }) }, local_coverage: closed({ status: { enum: ["AVAILABLE", "VALID_EMPTY", "UNAVAILABLE"] }, declared_count: nullable(count), observed_count: nullable(count), state_available_count: nullable(count), reason_codes: strings }), theme_state: binding, warnings: strings }) };
const digestPin = closed({ canonical_json_sha256: hash });
const manifestSchema = { $defs: OWNER_STATE_CONTRACT.defs, ...closed({ schema: { const: "company_theme_exposure_manifest.v2" }, mode: { const: "shadow" }, authority_caps: caps, generation_id: generation, generated_at: instant, company_count: count, exposure_count: count, local_membership_count: count, coverage: closed(Object.fromEntries(["active_membership_count", "mapped_membership_count", "unmapped_membership_count", "active_member_ticker_count", "unmapped_only_ticker_count", "active_member_tickers_without_company_context"].map(k => [k, count]))), local_coverage: closed({ available_company_count: count, valid_empty_company_count: count, unavailable_company_count: count }), source: closed({ company_intelligence: closed({ generation_id: generation, sha256: hash }), membership: digestPin, crosswalk: digestPin, theme_state: binding, company_identity_reads: digestPin, local_membership_reads: digestPin, builder: { const: "company_theme_exposure.v2.shadow" } }), files: closed({}), status: { enum: ["ready", "partial", "empty"] }, warnings: strings }) };
const ajv = new Ajv2020({ strict: false, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
const exposureShape = ajv.compile<CompanyThemeExposureShadowV2>(exposureSchema);
const manifestShape = ajv.compile<CompanyThemeExposureShadowManifestV2>(manifestSchema);
const identityPayloadShape = ajv.compile(closed({ status: { const: "RESOLVED" }, ticker: text, company_node_id: text, issuer_id: text, security_id: text }));
const localPayloadShape = ajv.compile(closed({ company_node_id: text, declared_count: count, memberships: { type: "array", items: closed(localRowProperties) } }));

class ContractFailure extends Error { constructor(readonly code: ShadowContractReason) { super(code); } }
function requireContract(value: unknown, code: ShadowContractReason): asserts value { if (!value) throw new ContractFailure(code); }
function finiteJson(raw: unknown): boolean {
  const active = new Set<object>();
  function visit(value: unknown, depth: number): boolean {
    if (depth > 128) return false;
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || active.has(value) || Object.getOwnPropertySymbols(value).length) return false;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    let dense = !Array.isArray(value) || Object.hasOwn(descriptors, "length") && Object.keys(descriptors).length === value.length + 1;
    if (Array.isArray(value) && dense) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(descriptors, String(index))) { dense = false; break; }
      }
    }
    const valid = dense && Object.entries(descriptors).every(([key, descriptor]) => Array.isArray(value) && key === "length" || descriptor.enumerable && "value" in descriptor && visit(descriptor.value, depth + 1));
    active.delete(value);
    return valid;
  }
  return visit(raw, 0) && new TextEncoder().encode(JSON.stringify(raw)).byteLength <= 2 * 1024 * 1024;
}
type Clock = { tick: bigint; dateOnly: boolean };
const DAY = BigInt("86400000000");
function parseClock(value: string): Clock {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  requireContract(match, "CLOCK_BINDING");
  const [, ys, ms, ds, hs, mins, secs, fraction, zone] = match;
  const [year, month, day, hour, minute, second] = [ys, ms, ds, hs ?? "0", mins ?? "0", secs ?? "0"].map(Number);
  requireContract(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 59, "CLOCK_BINDING");
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0);
  requireContract(date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day, "CLOCK_BINDING");
  let offset = 0;
  if (zone && zone !== "Z") { const zh = Number(zone.slice(1, 3)); const zm = Number(zone.slice(4)); requireContract(zh <= 23 && zm <= 59, "CLOCK_BINDING"); offset = (zh * 60 + zm) * (zone[0] === "+" ? 1 : -1); }
  return { tick: BigInt(date.getTime() - offset * 60_000) * BigInt("1000") + BigInt((fraction ?? "").padEnd(6, "0")), dateOnly: !hs };
}
function utcDay(tick: bigint): bigint { return tick >= BigInt("0") ? tick / DAY : (tick - DAY + BigInt("1")) / DAY; }
function provenBy(value: string, cutoff: string): boolean { const a = parseClock(value), b = parseClock(cutoff); return a.dateOnly ? utcDay(a.tick) < utcDay(b.tick) : b.dateOnly ? a.tick < b.tick : a.tick <= b.tick; }
function definitelyAfter(left: string, right: string): boolean { const a = parseClock(left), b = parseClock(right); return b.dateOnly ? a.tick >= b.tick + DAY : a.tick > b.tick; }
function sameClock(a: string, b: string): boolean { const x = parseClock(a), y = parseClock(b); return x.tick === y.tick && x.dateOnly === y.dateOnly; }
function sourceReasons(receipt: OwnerReceipt, binding: StateBinding): string[] {
  const reasons: string[] = [], a = parseClock(receipt.effective_at), b = parseClock(binding.effective_at);
  if (b.dateOnly ? utcDay(a.tick) > utcDay(b.tick) : a.tick > b.tick) reasons.push("SOURCE_EFFECTIVE_FUTURE");
  for (const key of ["known_at", "available_at", "recorded_at"] as const) {
    if (!provenBy(receipt[key], binding.known_at)) reasons.push(parseClock(receipt[key]).dateOnly && utcDay(parseClock(receipt[key]).tick) === utcDay(parseClock(binding.known_at).tick) ? "KNOWLEDGE_TIME_UNPROVEN" : "SOURCE_AFTER_CUTOFF");
  }
  return [...new Set(reasons)].sort();
}
function sameStrings(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
// Python owner ordering is by Unicode code point, without locale or aliases.
function ownerCompare(a: string, b: string): number { const x = Array.from(a, c => c.codePointAt(0)!), y = Array.from(b, c => c.codePointAt(0)!); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]; return x.length - y.length; }
function receiptBinding(receipt: OwnerReceipt, binding: StateBinding, role?: string, subject?: string, exactQuery = true): void {
  for (const key of ["effective_at", "available_at", "known_at", "recorded_at"] as const) parseClock(receipt[key]);
  parseClock(receipt.query.effective_at); parseClock(receipt.query.known_at);
  requireContract(!definitelyAfter(receipt.available_at, receipt.known_at) && !definitelyAfter(receipt.known_at, receipt.recorded_at), "CLOCK_BINDING");
  requireContract(!role || receipt.owner === role, "RECEIPT_BINDING");
  requireContract(!subject || receipt.subject_id === subject, "IDENTITY_BINDING");
  requireContract((!binding.graph_generation_id || receipt.graph_generation_id === binding.graph_generation_id) && (!binding.owner_generations || binding.owner_generations[receipt.owner] === receipt.generation_id), "RECEIPT_BINDING");
  requireContract(!exactQuery || receipt.query.effective_at === binding.effective_at && receipt.query.known_at === binding.known_at, "CLOCK_BINDING");
  requireContract((receipt.availability === "UNAVAILABLE") === (receipt.payload === null), "RECEIPT_BINDING");
  // Hash shape and scope are checked here; the emitting owner authenticates its payload.
}
function subjectBinding(subject: StateSubject, read: StateRead, binding: StateBinding): void {
  requireContract(subject.node_id === read.subject_id, "IDENTITY_BINDING");
  if (subject.kind === "local_theme") requireContract(subject.source_family !== null && subject.native_id !== null && /^(finviz|ths)$/.test(subject.source_family) && /^[A-Za-z0-9_.-]+$/.test(subject.native_id) && subject.node_id === `ltheme:${subject.source_family}:${subject.native_id}` && subject.mapping.state !== "SUBJECT_IS_CANONICAL", "IDENTITY_BINDING");
  else requireContract(subject.node_id.startsWith("theme:") && subject.node_id.slice(6).length > 0 && subject.node_id.slice(6).trim() === subject.node_id.slice(6) && subject.source_family === null && subject.native_id === null && subject.mapping.state === "SUBJECT_IS_CANONICAL", "IDENTITY_BINDING");
  requireContract(subject.reason_codes.length === 0, "STATE_BINDING");
  for (const [role, receipt] of Object.entries(subject.owner_receipts)) {
    if (receipt) receiptBinding(receipt, binding, role, subject.node_id, false);
    if (role !== "eligibility") {
      requireContract(receipt && receipt.availability !== "UNAVAILABLE", "RECEIPT_BINDING");
      requireContract(receipt.query.effective_at === binding.effective_at && provenBy(receipt.query.known_at, binding.known_at) && sourceReasons(receipt, binding).length === 0, "CLOCK_BINDING");
    }
  }
  // This is the owner's historical research-use invariant, never a Terminal delivery grant.
  const rights = subject.owner_receipts.rights?.payload;
  requireContract(rights && typeof rights === "object" && !Array.isArray(rights) && rights.allowed === true && rights.purpose === "research_internal", "RECEIPT_BINDING");
  for (const observation of Object.values(subject.observations)) {
    requireContract(Number.isSafeInteger(observation.coverage.declared) && Number.isSafeInteger(observation.coverage.observed) && observation.coverage.observed <= observation.coverage.declared, "COVERAGE_BINDING");
    for (const receipt of observation.source_receipts) receiptBinding(receipt, binding, undefined, subject.node_id, false);
  }
  if (subject.aggregation.receipt) receiptBinding(subject.aggregation.receipt, binding, undefined, subject.node_id, false);
}
function stateBinding(binding: StateBinding): void {
  parseClock(binding.effective_at); parseClock(binding.known_at);
  if (binding.status === "MISSING") {
    requireContract([binding.generation_id, binding.state_sha256, binding.state_generated_at, binding.canonical_json_sha256, binding.graph_generation_id, binding.owner_generations].every(v => v === null) && binding.reads.length === 0, "STATE_BINDING"); return;
  }
  requireContract(binding.state_sha256 && binding.canonical_json_sha256 && binding.state_generated_at && binding.graph_generation_id && binding.owner_generations && binding.generation_id === binding.expected_generation_id && binding.generation_id === binding.state_sha256.slice(0, 32), "STATE_BINDING");
  parseClock(binding.state_generated_at);
  const ids = binding.reads.map(r => r.subject_id); requireContract(sameStrings(ids, [...new Set(ids)].sort(ownerCompare)), "STATE_BINDING");
  for (const read of binding.reads) {
    requireContract(read.generation_id === binding.generation_id && read.state_sha256 === binding.state_sha256 && read.state_generated_at === binding.state_generated_at && read.effective_at === binding.effective_at && read.known_at === binding.known_at, "STATE_BINDING");
    if (read.status !== "UNAVAILABLE") {
      requireContract(read.state_generated_at && provenBy(read.state_generated_at, read.known_at) && parseClock(read.known_at).tick - parseClock(read.state_generated_at).tick <= BigInt("108000000000"), "CLOCK_BINDING");
      requireContract(read.subject, "STATE_BINDING"); subjectBinding(read.subject, read, binding);
    }
  }
}
function canonicalBinding(item: CompanyThemeExposureShadowV2): void {
  const c = item.coverage; const expected = c.active_basket_count === 0 ? "no_active_membership" : c.mapped_basket_count === 0 ? "unmapped_only" : c.unmapped_basket_count === 0 ? "mapped" : "mixed";
  requireContract(c.active_basket_count === c.mapped_basket_count + c.unmapped_basket_count && c.status === expected && item.exposures.length === c.mapped_basket_count, "COVERAGE_BINDING");
  const pairs = item.exposures.map(r => r.theme_id + "\u0000" + r.basket_id); requireContract(sameStrings(pairs, [...new Set(pairs)].sort(ownerCompare)), "IDENTITY_BINDING");
  const parent = item.company_intelligence;
  requireContract((parent.latest_event_id === null) === (parent.latest_event_call_date === null), "IDENTITY_BINDING");
  if (parent.latest_event_call_date !== null) parseClock(parent.latest_event_call_date);
}
function localBinding(item: CompanyThemeExposureShadowV2): void {
  const binding = item.theme_state, reasons: string[] = []; let company: ObjectValue | null = null;
  if (!item.company_identity) reasons.push("COMPANY_IDENTITY_MISSING");
  else {
    const receipt = item.company_identity; receiptBinding(receipt, binding, "identity"); reasons.push(...sourceReasons(receipt, binding));
    if (receipt.availability === "UNAVAILABLE") reasons.push("COMPANY_IDENTITY_UNAVAILABLE");
    else { requireContract(receipt.availability === "AVAILABLE" && identityPayloadShape(receipt.payload), "IDENTITY_BINDING"); company = receipt.payload as ObjectValue; requireContract(company.ticker === item.company.ticker && company.company_node_id === receipt.subject_id, "IDENTITY_BINDING"); }
  }
  let payload: ObjectValue | null = null;
  if (!item.local_membership) reasons.push("LOCAL_MEMBERSHIP_MISSING");
  else {
    const receipt = item.local_membership; receiptBinding(receipt, binding, "membership", company?.company_node_id as string | undefined); reasons.push(...sourceReasons(receipt, binding));
    if (receipt.availability === "UNAVAILABLE") reasons.push("LOCAL_MEMBERSHIP_UNAVAILABLE");
    else { requireContract(localPayloadShape(receipt.payload), "COVERAGE_BINDING"); payload = receipt.payload as ObjectValue; const rows = payload.memberships as ObjectValue[]; requireContract(payload.company_node_id === receipt.subject_id && (!company || company.company_node_id === payload.company_node_id), "IDENTITY_BINDING"); requireContract(rows.length === payload.declared_count && (receipt.availability === "VALID_EMPTY") === (rows.length === 0), "COVERAGE_BINDING"); }
  }
  const coverage = item.local_coverage;
  if (reasons.length) { requireContract(item.local_memberships.length === 0 && coverage.status === "UNAVAILABLE" && [coverage.declared_count, coverage.observed_count, coverage.state_available_count].every(v => v === null) && sameStrings(coverage.reason_codes, [...new Set(reasons)].sort()), "COVERAGE_BINDING"); return; }
  requireContract(payload && item.local_membership && company, "IDENTITY_BINDING");
  const sourceRows = (payload.memberships as ObjectValue[]).slice().sort((a, b) => ownerCompare(String(a.node_id), String(b.node_id)));
  const ids = sourceRows.map(r => r.node_id as string); requireContract(new Set(ids).size === ids.length && item.local_memberships.length === ids.length, "IDENTITY_BINDING");
  const usable = new Map(binding.reads.filter(r => r.status !== "UNAVAILABLE").map(r => [r.subject_id, r]));
  let count = 0;
  sourceRows.forEach((raw, i) => {
    const row = item.local_memberships[i]; requireContract(/^(finviz|ths)$/.test(String(raw.source_family)) && /^[A-Za-z0-9_.-]+$/.test(String(raw.native_id)) && raw.node_id === `ltheme:${raw.source_family}:${raw.native_id}`, "IDENTITY_BINDING");
    requireContract(Object.keys(localRowProperties).every(k => JSON.stringify(raw[k]) === JSON.stringify((row as unknown as ObjectValue)[k])) && row.company_node_id === payload.company_node_id && row.membership_receipt_sha256 === item.local_membership?.sha256, "IDENTITY_BINDING");
    const read = usable.get(row.node_id); if (!read) return; count++;
    const subject = read.subject!; requireContract(subject.kind === "local_theme" && subject.source_family === row.source_family && subject.native_id === row.native_id, "IDENTITY_BINDING");
    const forward = subject.owner_receipts.membership; requireContract(forward && forward.availability !== "UNAVAILABLE", "RECEIPT_BINDING");
    receiptBinding(forward, binding, "membership", row.node_id, false);
    requireContract(forward.query.effective_at === binding.effective_at && provenBy(forward.query.known_at, binding.known_at) && sourceReasons(forward, binding).length === 0 && (["effective_at", "available_at", "known_at", "recorded_at"] as const).every(k => sameClock(forward[k], item.local_membership![k])), "CLOCK_BINDING");
    const members = forward.payload && typeof forward.payload === "object" && !Array.isArray(forward.payload) ? forward.payload.members : null;
    requireContract(Array.isArray(members) && members.filter(m => m && typeof m === "object" && !Array.isArray(m) && m.ticker === item.company.ticker && m.issuer_id === company.issuer_id && m.security_id === company.security_id).length === 1, "IDENTITY_BINDING");
  });
  requireContract(coverage.status === item.local_membership.availability && coverage.declared_count === payload.declared_count && coverage.observed_count === sourceRows.length && coverage.state_available_count === count && sameStrings(coverage.reason_codes, count < sourceRows.length ? ["STATE_CONTEXT_UNAVAILABLE"] : []), "COVERAGE_BINDING");
}
function exposureMeaning(item: CompanyThemeExposureShadowV2): void {
  parseClock(item.generated_at); requireContract(item.generated_at === item.theme_state.known_at, "CLOCK_BINDING"); canonicalBinding(item); stateBinding(item.theme_state); localBinding(item);
  const related = [...new Set([...item.exposures.map(r => "theme:" + r.theme_id.trim()), ...item.local_memberships.map(r => r.node_id)])].sort(ownerCompare);
  if (item.theme_state.status === "AVAILABLE") requireContract(sameStrings(item.theme_state.reads.map(r => r.subject_id), related), "STATE_BINDING");
  const warnings = [...(item.coverage.unmapped_basket_count ? ["active_membership_unmapped"] : []), ...(item.local_coverage.status === "UNAVAILABLE" ? ["local_membership_unavailable"] : []), ...(item.theme_state.status === "MISSING" ? ["theme_state_missing"] : item.theme_state.reads.some(r => r.status === "UNAVAILABLE") ? ["theme_state_unavailable"] : [])].sort();
  requireContract(sameStrings(item.warnings, warnings) && item.status === (warnings.length ? "partial" : "ready"), "STATUS_BINDING");
}
function manifestMeaning(item: CompanyThemeExposureShadowManifestV2): void {
  parseClock(item.generated_at); const binding = item.source.theme_state; stateBinding(binding); requireContract(item.generated_at === binding.known_at, "CLOCK_BINDING");
  const c = item.coverage, local = item.local_coverage;
  requireContract(c.active_membership_count === c.mapped_membership_count + c.unmapped_membership_count && c.unmapped_only_ticker_count <= c.active_member_ticker_count && c.active_member_tickers_without_company_context <= c.active_member_ticker_count && local.available_company_count + local.valid_empty_company_count + local.unavailable_company_count === item.company_count && (item.company_count !== 0 || item.exposure_count === 0 && item.local_membership_count === 0), "COVERAGE_BINDING");
  const warnings = [...(c.unmapped_membership_count ? ["active_memberships_unmapped"] : []), ...(local.unavailable_company_count ? ["local_membership_unavailable"] : []), ...(binding.status === "MISSING" ? ["theme_state_missing"] : binding.reads.some(r => r.status === "UNAVAILABLE") ? ["theme_state_unavailable"] : [])].sort();
  requireContract(sameStrings(item.warnings, warnings) && item.status === (item.company_count === 0 ? "empty" : warnings.length ? "partial" : "ready"), "STATUS_BINDING");
}
function failure(error: unknown): Failure { return { ok: false, reason_codes: [error instanceof ContractFailure ? error.code : "CLOSED_CONTRACT"] }; }
export function parseCompanyThemeExposureShadowV2(raw: unknown): ShadowExposureParseResult {
  try { requireContract(finiteJson(raw), "INVALID_JSON"); requireContract(exposureShape(raw), "CLOSED_CONTRACT"); const context = raw as CompanyThemeExposureShadowV2; exposureMeaning(context); return { ok: true, context }; } catch (error) { return failure(error); }
}
export function parseCompanyThemeExposureShadowManifestV2(raw: unknown): ShadowManifestParseResult {
  try { requireContract(finiteJson(raw), "INVALID_JSON"); requireContract(manifestShape(raw), "CLOSED_CONTRACT"); const manifest = raw as CompanyThemeExposureShadowManifestV2; manifestMeaning(manifest); return { ok: true, manifest }; } catch (error) { return failure(error); }
}

