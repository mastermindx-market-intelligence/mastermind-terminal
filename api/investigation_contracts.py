"""Pure Python pairing of Terminal's versioned Investigation manifest contract.

Accepts already-decoded values, never a wire payload. It owns no persistence,
adapter registry, entitlement, historical resolver or compiler. Callers supply
admitted owner/kind pairs; shape acceptance cannot establish reference existence.
"""
from __future__ import annotations

from datetime import date, datetime
import json
import math
import re

TRIM = "\t\v\f \u00a0\ufeff\n\r\u1680\u2028\u2029\u202f\u205f\u3000" + "".join(chr(n) for n in range(0x2000, 0x200B))
UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
NAMESPACE = re.compile(r"[a-z][a-z0-9_.-]{0,63}\Z")
FIELD = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}\Z")
KINDS = frozenset(("security", "issuer", "industry", "subtheme", "theme", "regime", "economy", "event", "portfolio", "option_underlying", "option_contract", "policy_question"))


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
        require(counters[0] <= 16384 and depth <= 24, "$", "non_json_value")
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


def canonical_investigation_json(value):
    """Serialize an accepted semantic value, preserving exact authored Unicode."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def validate_investigation_manifest(raw, admission=None):
    """Return detached accepted value or a bounded first error; never normalize text."""
    admission = admission if admission is not None else {}
    try:
        data_only(raw)
        v2 = type(raw) is dict and raw.get("schema") == "investigation_manifest.v2"
        m = obj(raw, "$", ("schema", "intent", "layout_refs", "thesis_refs", "evidence_refs", "continuation") + (("argument_relations",) if v2 else ()), ("review_baseline_ref",))
        choice(m["schema"], "$.schema", ("investigation_manifest.v1", "investigation_manifest.v2"))
        v2 = m["schema"] == "investigation_manifest.v2"
        limit = 4000 if v2 else 2000

        def subject(v, p):
            r = obj(v, p, ("kind", "owner", "object_id"), ("version_ref",))
            pattern(r["owner"], p + ".owner", NAMESPACE, "invalid_namespace")
            text(r["object_id"], p + ".object_id", 256, True)
            if "version_ref" in r:
                text(r["version_ref"], p + ".version_ref", 256, True)
            require(type(r["kind"]) is str and r["kind"] in KINDS and any(a["owner"] == r["owner"] and r["kind"] in a["kinds"] for a in admission.get("subjects", [])), p, "unsupported_owner_kind")
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
            r = obj(v, p, ("owner", "object_type", "object_id", "mode"), ("version_ref", "fingerprint", "selection"))
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
            code = "invalid_timestamp" if v2 else "invalid_date"
            expression = r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z" if v2 else r"[0-9]{4}-[0-9]{2}-[0-9]{2}"
            require(type(value) is str and re.fullmatch(expression, value), "$.intent.research_as_of", code)
            try:
                if v2:
                    parsed = datetime.fromisoformat(value)
                    require(parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") == value, "$.intent.research_as_of", code)
                else:
                    date.fromisoformat(value)
            except ValueError:
                raise Invalid("$.intent.research_as_of", code) from None
        refs(m["layout_refs"], "$.layout_refs", 4, layout)
        refs(m["thesis_refs"], "$.thesis_refs", 16, thesis)
        refs(m["evidence_refs"], "$.evidence_refs", 128, evidence)
        continuation = obj(m["continuation"], "$.continuation", (), ("next_question", "next_observation"))
        for key, value in continuation.items():
            text(value, "$.continuation." + key, limit)
        if "review_baseline_ref" in m:
            evidence(m["review_baseline_ref"], "$.review_baseline_ref", True)
            require(not v2 or m["review_baseline_ref"] in m["evidence_refs"], "$.review_baseline_ref", "baseline_not_member")
        if v2:
            def endpoint(v, p):
                require(type(v) is dict, p, "invalid_type")
                if v.get("kind") == "thesis":
                    obj(v, p, ("kind", "thesis_id", "version_id"))
                    for k in ("thesis_id", "version_id"):
                        pattern(v[k], p + "." + k, UUID, "invalid_uuid")
                    require(any(r["thesis_id"] == v["thesis_id"] and r["version_id"] == v["version_id"] for r in m["thesis_refs"]), p, "unresolved_endpoint")
                elif v.get("kind") == "evidence":
                    obj(v, p, ("kind", "owner", "object_type", "object_id", "mode"), ("version_ref", "selection"))
                    key = evidence({k: value for k, value in v.items() if k != "kind"}, p)
                    require(any(evidence(r, p) == key for r in m["evidence_refs"]), p, "unresolved_endpoint")
                else:
                    raise Invalid(p + ".kind", "unsupported_value")
            require(type(m["argument_relations"]) is list, "$.argument_relations", "invalid_type")
            require(len(m["argument_relations"]) <= 256, "$.argument_relations", "too_many_items")
            for i, edge in enumerate(m["argument_relations"]):
                p = f"$.argument_relations[{i}]"
                obj(edge, p, ("source", "target", "relation", "rationale"), ("discrimination_criterion",))
                endpoint(edge["source"], p + ".source")
                endpoint(edge["target"], p + ".target")
                choice(edge["relation"], p + ".relation", ("supports", "weakens", "contradicts", "unresolved_interpretation", "discriminates_between"))
                text(edge["rationale"], p + ".rationale", 4000)
                if "discrimination_criterion" in edge:
                    text(edge["discrimination_criterion"], p + ".discrimination_criterion", 4000)
        serialized = canonical_investigation_json(m) if v2 else json.dumps(m, ensure_ascii=False, separators=(",", ":"))
        require(len(serialized.encode("utf-8")) <= (131072 if v2 else 65536), "$", "manifest_too_large")
        return {"ok": True, "value": json.loads(serialized)}
    except Invalid as e:
        return {"ok": False, "errors": [{"path": e.path, "code": e.code}]}
    except (TypeError, ValueError, KeyError, RecursionError, OverflowError):
        return {"ok": False, "errors": [{"path": "$", "code": "non_json_value"}]}
