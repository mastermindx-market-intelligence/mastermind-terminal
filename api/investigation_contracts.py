"""Pure Python pairing of Terminal's versioned Investigation manifest contract.

Accepts already-decoded values, never a wire payload. It owns no persistence,
adapter registry, entitlement, historical resolver or compiler. Callers supply
admitted owner/kind pairs; shape acceptance cannot establish reference existence.
"""
from __future__ import annotations

from datetime import date
import json
import math
import re

from api.investigation_scenario import validate_scenario_capture

TRIM = "\t\v\f \u00a0\ufeff\n\r\u1680\u2028\u2029\u202f\u205f\u3000" + "".join(chr(n) for n in range(0x2000, 0x200B))
UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
# Prophet D05 investigation_manifest.v3 (READ extension of v2; v3 writes stay closed in the TS command
# parser and the shared admission registry). RFC 3339 profile is byte-identical to TS and SQL.
RFC3339 = re.compile(r"[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])\Z")
CONTEXT_REF = re.compile(r"[A-Za-z0-9_.-]{1,1024}\Z")
MEMBER_PATH = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,127}\Z")
MAX_MEMBER_SHA256 = 8
PROPHET_RESEARCH_EVIDENCE_TYPES = ("today_selection", "b03_occurrence", "plan_origin", "evaluation")
USER_DECISION_DISPOSITIONS = ("investigate", "watch", "pass")
MILESTONE_STATES = ("open", "met", "missed", "withdrawn")
MAX_MILESTONES = 20
MAX_MILESTONE_EVIDENCE_INDEXES = 16
NAMESPACE = re.compile(r"[a-z][a-z0-9_.-]{0,63}\Z")
FIELD = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}\Z")
KINDS = frozenset(("security", "issuer", "industry", "subtheme", "theme", "regime", "economy", "event", "portfolio", "option_underlying", "option_contract", "policy_question"))
# Sector Intelligence (packet 3.2): sector/basket/company are admitted ONLY by v2
# validation; the shared v1 kind set above stays byte-identical.
KINDS_V2 = KINDS | frozenset(("sector", "basket", "company"))

# The exact macro.sector owner-qualified native subject cohort (captured 11-sector wire).
SECTOR_INVESTIGATION_COHORT = ("xlb", "xlk", "xlc", "xly", "xlf", "xli", "xle", "xlv", "xlp", "xlu", "xlre")
# macro.sector native generation/input token grammar (sector_native_view.receipt.v1).
NATIVE_SECTOR_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
# theme_graph.identity owner-resolved ids (Macro engine/theme_graph/identity.py).
THEME_ID = re.compile(r"theme:[a-z0-9][a-z0-9_]{1,62}\Z")
BASKET_SUITES = ("baskets", "baskets_china", "baskets_china_ths", "baskets_hk", "baskets_canada", "baskets_intl")
BASKET_ID = re.compile(r"basket:(baskets|baskets_china|baskets_china_ths|baskets_hk|baskets_canada|baskets_intl):[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
COMPANY_ID = re.compile(r"co:(us|cn|hk|ca|intl):[A-Za-z0-9.\-]+(#[0-9]+)?\Z")
# macro.sector published basket projection row id (wire grammar).
WIRE_BASKET_ID = re.compile(r"b-[a-zA-Z0-9_-]{1,100}\Z")
# theme_graph.curation_assertion native evidence/revision identities.
CURATION_EVIDENCE_ID = re.compile(r"ev:[0-9a-f]{16}\Z")
CURATION_REVISION = re.compile(r"gmirca_[0-9a-f]{32}\Z")


class Invalid(ValueError):
    def __init__(self, path, code):
        self.path, self.code = path, code


def require(condition, path, code):
    if not condition:
        raise Invalid(path, code)


def obj(value, path, required, optional=()):
    require(type(value) is dict, path, "invalid_type")
    require(set(value) <= set(required) | set(optional), path, "unknown_field")
    require(set(required) <= set(value), path, "missing_field")
    return value


def text(value, path, limit, single=False):
    require(type(value) is str, path, "invalid_type")
    require(bool(value.strip(TRIM)), path, "empty_text")
    for i, c in enumerate(value, 1):
        n = ord(c)
        require(not 0xD800 <= n <= 0xDFFF, path, "invalid_unicode")
        require(n != 0, path, "unsupported_code_point")
        require(i <= limit, path, "text_too_long")
    require(not any((1 <= ord(c) <= 31 and c not in "\t\n\r") or ord(c) == 127 for c in value), path, "invalid_control")
    require(not single or not any(c in value for c in "\t\n\r"), path, "invalid_control")


def pattern(value, path, regex, code):
    require(type(value) is str and regex.fullmatch(value) is not None, path, code)


def choice(value, path, values):
    require(type(value) is str and value in values, path, "unsupported_value")


def data_only(value):
    ancestors, counters = set(), [0, 0]

    def visit(v, depth=0):
        counters[0] += 1
        require(counters[0] <= 4096 and depth <= 24, "$", "non_json_value")
        if type(v) is str:
            counters[1] += len(v.encode("utf-16-le", errors="surrogatepass")) // 2
            require(counters[1] <= 131072, "$", "manifest_too_large")
            return
        if v is None or type(v) is bool or type(v) is int or (type(v) is float and math.isfinite(v)):
            return
        require(type(v) in (dict, list) and id(v) not in ancestors, "$", "non_json_value")
        ancestors.add(id(v))
        if type(v) is dict:
            require(all(type(k) is str for k in v), "$", "non_json_value")
            values = v.values()
        else:
            values = v
        for child in values:
            visit(child, depth + 1)
        ancestors.remove(id(v))
    visit(value)


def timestamp(value, path):
    """RFC 3339 profile shared with TS and SQL, plus real calendar-day validity of the date part."""
    require(type(value) is str and RFC3339.fullmatch(value) is not None, path, "invalid_timestamp")
    try:
        date.fromisoformat(value[:10])
    except ValueError:
        raise Invalid(path, "invalid_timestamp") from None


def user_decision(value, evidence_refs):
    """Prophet D05 closed `user_decision`; mirrors terminal/lib/investigationContracts.ts userDecision."""
    d = obj(value, "$.user_decision", ("disposition", "reason", "decided_at", "milestones"))
    choice(d["disposition"], "$.user_decision.disposition", USER_DECISION_DISPOSITIONS)
    reason = d["reason"]
    require(type(reason) is str, "$.user_decision.reason", "invalid_type")
    if reason.strip(TRIM) == "":
        require(reason == "" and d["disposition"] != "pass", "$.user_decision.reason", "empty_text")
    else:
        text(reason, "$.user_decision.reason", 2000)
    timestamp(d["decided_at"], "$.user_decision.decided_at")
    milestones = d["milestones"]
    require(type(milestones) is list, "$.user_decision.milestones", "invalid_type")
    require(len(milestones) <= MAX_MILESTONES, "$.user_decision.milestones", "too_many_items")
    ids = set()
    for i, entry in enumerate(milestones):
        path = "$.user_decision.milestones[%d]" % i
        m = obj(entry, path, ("id", "criterion", "due_on", "state", "user_observed_at", "supporting_evidence_indexes"))
        pattern(m["id"], path + ".id", UUID, "invalid_uuid")
        require(m["id"] not in ids, path + ".id", "duplicate_reference")
        ids.add(m["id"])
        text(m["criterion"], path + ".criterion", 500)
        if m["due_on"] is not None:
            require(type(m["due_on"]) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", m["due_on"]), path + ".due_on", "invalid_date")
            try:
                date.fromisoformat(m["due_on"])
            except ValueError:
                raise Invalid(path + ".due_on", "invalid_date") from None
        choice(m["state"], path + ".state", MILESTONE_STATES)
        if m["user_observed_at"] is not None:
            timestamp(m["user_observed_at"], path + ".user_observed_at")
        require(m["state"] not in ("met", "missed") or m["user_observed_at"] is not None, path + ".user_observed_at", "observation_required")
        idx = m["supporting_evidence_indexes"]
        require(type(idx) is list, path + ".supporting_evidence_indexes", "invalid_type")
        require(len(idx) <= MAX_MILESTONE_EVIDENCE_INDEXES, path + ".supporting_evidence_indexes", "too_many_items")
        seen = set()
        for k, n in enumerate(idx):
            p = "%s.supporting_evidence_indexes[%d]" % (path, k)
            ok = type(n) is int and 0 <= n < len(evidence_refs) and type(evidence_refs[n]) is dict and evidence_refs[n].get("mode") == "pinned"
            require(ok, p, "invalid_evidence_index")
            require(n not in seen, p, "duplicate_reference")
            seen.add(n)


def validate_investigation_manifest(raw, admission=None):
    """Return detached accepted value or a bounded first error; never normalize text."""
    admission = admission if admission is not None else {}
    try:
        data_only(raw)
        m = obj(raw, "$", ("schema", "intent", "layout_refs", "thesis_refs", "evidence_refs", "continuation"), ("review_baseline_ref", "review", "scenario_capture", "user_decision"))
        choice(m["schema"], "$.schema", ("investigation_manifest.v1", "investigation_manifest.v2", "investigation_manifest.v3"))
        # v3 is a strict superset of v2 for every shared field; every v2 rule applies unchanged.
        v3 = m["schema"] == "investigation_manifest.v3"
        v2 = m["schema"] == "investigation_manifest.v2" or v3
        require("user_decision" not in m or v3, "$.user_decision", "unsupported_schema")
        limit = 4000 if v2 else 2000

        def subject(v, p):
            r = obj(v, p, ("kind", "owner", "object_id"), ("version_ref",))
            pattern(r["owner"], p + ".owner", NAMESPACE, "invalid_namespace")
            text(r["object_id"], p + ".object_id", 256, True)
            if "version_ref" in r:
                text(r["version_ref"], p + ".version_ref", 256, True)
            require(type(r["kind"]) is str and r["kind"] in (KINDS_V2 if v2 else KINDS) and any(a["owner"] == r["owner"] and r["kind"] in a["kinds"] for a in admission.get("subjects", [])), p, "unsupported_owner_kind")
            # Exact owner-resolved identity for the Sector Intelligence pairs (packet 3.2):
            # a sector subject is the admitted native cohort id, never a ticker/name guess;
            # a theme_graph.identity subject keeps its owner grammar and is never
            # reinterpreted as a security/issuer (sector:financials and native xlf stay
            # distinct owners, joined only by an explicit versioned owner crosswalk).
            if v2:
                if r["owner"] == "macro.sector" and r["kind"] == "sector":
                    require(r["object_id"] in SECTOR_INVESTIGATION_COHORT, p + ".object_id", "invalid_subject_id")
                if r["owner"] == "theme_graph.identity" and r["kind"] == "theme":
                    pattern(r["object_id"], p + ".object_id", THEME_ID, "invalid_subject_id")
                if r["owner"] == "theme_graph.identity" and r["kind"] == "basket":
                    pattern(r["object_id"], p + ".object_id", BASKET_ID, "invalid_subject_id")
                if r["owner"] == "theme_graph.identity" and r["kind"] == "company":
                    pattern(r["object_id"], p + ".object_id", COMPANY_ID, "invalid_subject_id")
            return [r["owner"], r["kind"], r["object_id"], r.get("version_ref")]

        def layout(v, p):
            r = obj(v, p, ("layout_id", "layout_revision_id", "digest", "role"))
            for key in ("layout_id", "layout_revision_id"):
                pattern(r[key], p + "." + key, UUID, "invalid_uuid")
            pattern(r["digest"], p + ".digest", DIGEST, "invalid_digest")
            choice(r["role"], p + ".role", ("primary", "supporting"))
            return [r["layout_id"], r["layout_revision_id"]]

        def thesis(v, p):
            r = obj(v, p, ("thesis_id", "version_id", "role"))
            for key in ("thesis_id", "version_id"):
                pattern(r[key], p + "." + key, UUID, "invalid_uuid")
            choice(r["role"], p + ".role", ("primary", "alternative", "context"))
            return [r["thesis_id"], r["version_id"]]

        def evidence(v, p, baseline=False):
            r = obj(v, p, ("owner", "object_type", "object_id", "mode"), ("version_ref", "fingerprint", "selection", "context_ref", "member_sha256") if v3 else ("version_ref", "fingerprint", "selection"))
            for key in ("owner", "object_type"):
                pattern(r[key], p + "." + key, NAMESPACE, "invalid_namespace")
            text(r["object_id"], p + ".object_id", 256, True)
            require(any(a["owner"] == r["owner"] and r["object_type"] in a["object_types"] for a in admission.get("evidence", [])), p, "unsupported_owner_kind")
            choice(r["mode"], p + ".mode", ("pinned",) if baseline else ("pinned", "follow_head"))
            require(r["mode"] != "pinned" or "version_ref" in r, p, "pinned_version_required")
            if "version_ref" in r:
                text(r["version_ref"], p + ".version_ref", 256, True)
            if "fingerprint" in r:
                pattern(r["fingerprint"], p + ".fingerprint", DIGEST, "invalid_digest")
            require(r["mode"] != "follow_head" or not ({"version_ref", "fingerprint"} & r.keys()), p, "incompatible_reference_mode")
            field = None
            if "selection" in r:
                field = obj(r["selection"], p + ".selection", ("field",))["field"]
                pattern(field, p + ".selection.field", FIELD, "unsupported_selection")
            # `prophet.research` exists only on v3, whatever an adapter registry lists.
            require(r["owner"] != "prophet.research" or v3, p, "unsupported_owner_kind")
            # New Sector Intelligence evidence is pinned-only (packet 3.2): version_ref AND
            # fingerprint are required, selection stays omitted until a closed per-type
            # selector vocabulary exists, and each type pins its owner-resolved identity
            # grammar. No JSON state is ever hidden in object_id, selection.field, title
            # or horizon.
            if v2:
                if r["owner"] == "macro.sector" and "context_ref" in r:
                    require(r["object_type"] in ("sector_observation", "basket_observation"), p + ".context_ref", "invalid_context_ref")
                    pattern(r["context_ref"], p + ".context_ref", CONTEXT_REF, "invalid_context_ref")
                else:
                    require("context_ref" not in r, p + ".context_ref", "unsupported_context_ref")
                if "member_sha256" in r:
                    ms = r["member_sha256"]
                    ok = (r["owner"] == "macro.sector" and r["object_type"] in ("sector_observation", "basket_observation")
                          and type(ms) is dict and 1 <= len(ms) <= MAX_MEMBER_SHA256
                          and all(type(k) is str and MEMBER_PATH.fullmatch(k) and type(x) is str and DIGEST.fullmatch(x) for k, x in ms.items()))
                    require(ok, p + ".member_sha256", "invalid_member_sha256")
                if r["owner"] == "prophet.research" and v3:
                    # Closed adapter namespace, pinned-only; native readers issue object_id/version_ref.
                    require(r["object_type"] in PROPHET_RESEARCH_EVIDENCE_TYPES, p + ".object_type", "unsupported_owner_kind")
                    require(r["mode"] == "pinned", p + ".mode", "pinned_only")
                    require("fingerprint" in r, p, "fingerprint_required")
                    require("selection" not in r, p + ".selection", "unsupported_selection")
                if r["owner"] == "macro.sector" and r["object_type"] in ("sector_observation", "basket_observation"):
                    require(r["mode"] == "pinned", p + ".mode", "pinned_only")
                    if r["object_type"] == "sector_observation":
                        require(r["object_id"] in SECTOR_INVESTIGATION_COHORT, p + ".object_id", "invalid_object_id")
                    else:
                        pattern(r["object_id"], p + ".object_id", WIRE_BASKET_ID, "invalid_object_id")
                    if "version_ref" in r:
                        pattern(r["version_ref"], p + ".version_ref", NATIVE_SECTOR_TOKEN, "invalid_version_ref")
                    require("fingerprint" in r, p, "fingerprint_required")
                    require("selection" not in r, p + ".selection", "unsupported_selection")
                if r["owner"] == "theme_graph.curation_assertion" and r["object_type"] == "curation_assertion":
                    require(r["mode"] == "pinned", p + ".mode", "pinned_only")
                    pattern(r["object_id"], p + ".object_id", CURATION_EVIDENCE_ID, "invalid_object_id")
                    if "version_ref" in r:
                        pattern(r["version_ref"], p + ".version_ref", CURATION_REVISION, "invalid_version_ref")
                    require("fingerprint" in r, p, "fingerprint_required")
                    require("selection" not in r, p + ".selection", "unsupported_selection")
            return [r["owner"], r["object_type"], r["object_id"], r["mode"], r.get("version_ref"), field]

        def refs(values, p, maximum, check):
            require(type(values) is list, p, "invalid_type")
            require(len(values) <= maximum, p, "too_many_items")
            seen = set()
            for i, value in enumerate(values):
                key = json.dumps(check(value, f"{p}[{i}]"), ensure_ascii=True)
                require(key not in seen, f"{p}[{i}]", "duplicate_reference")
                seen.add(key)

        intent = obj(m["intent"], "$.intent", ("title", "question", "subjects"), ("horizon", "research_as_of"))
        text(intent["title"], "$.intent.title", 160, True)
        text(intent["question"], "$.intent.question", limit)
        refs(intent["subjects"], "$.intent.subjects", 16, subject)
        if "horizon" in intent:
            text(intent["horizon"], "$.intent.horizon", 64, True)
        if "research_as_of" in intent:
            value = intent["research_as_of"]
            require(type(value) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value), "$.intent.research_as_of", "invalid_date")
            try:
                date.fromisoformat(value)
            except ValueError:
                raise Invalid("$.intent.research_as_of", "invalid_date") from None
        refs(m["layout_refs"], "$.layout_refs", 4, layout)
        refs(m["thesis_refs"], "$.thesis_refs", 16, thesis)
        refs(m["evidence_refs"], "$.evidence_refs", 128, evidence)
        require(not v2 or sum(len(m[k]) for k in ("layout_refs", "thesis_refs", "evidence_refs")) <= 128, "$", "too_many_references")
        continuation = obj(m["continuation"], "$.continuation", (), ("next_question", "next_observation"))
        for key, value in continuation.items():
            text(value, "$.continuation." + key, limit)
        if "review_baseline_ref" in m:
            evidence(m["review_baseline_ref"], "$.review_baseline_ref", True)
        if "review" in m:
            # Mirrors terminal/lib/investigationContracts.ts and the installed SQL validator (0042+):
            # a closed assessment verdict, an optional 64-hex fire event id and an optional note.
            review = obj(m["review"], "$.review", ("assessment",), ("fire_event_id", "note"))
            choice(review["assessment"], "$.review.assessment", ("confirmed", "contradicted", "inconclusive"))
            if "fire_event_id" in review:
                pattern(review["fire_event_id"], "$.review.fire_event_id", DIGEST, "invalid_fire_event_id")
            if "note" in review:
                text(review["note"], "$.review.note", 2000)
        if v3 and "user_decision" in m:
            user_decision(m["user_decision"], m["evidence_refs"])
        if "scenario_capture" in m:
            # v2 only, and only a value the pure leaf validator accepts; nothing is coerced. A
            # reference is unresolved input metadata: no basis/result values are admitted and
            # acceptance is never a retention, entitlement or source-availability claim.
            require(v2, "$.scenario_capture", "unsupported_schema")
            require(validate_scenario_capture(m["scenario_capture"]), "$.scenario_capture", "invalid_scenario_capture")
        serialized = json.dumps(m, ensure_ascii=False, separators=(",", ":"))
        require(len(serialized.encode("utf-8")) <= (131072 if v2 else 65536), "$", "manifest_too_large")
        return {"ok": True, "value": json.loads(serialized)}
    except Invalid as e:
        return {"ok": False, "errors": [{"path": e.path, "code": e.code}]}
    except (TypeError, ValueError, KeyError, RecursionError, OverflowError):
        return {"ok": False, "errors": [{"path": "$", "code": "non_json_value"}]}
