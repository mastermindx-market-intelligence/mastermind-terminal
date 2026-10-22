"""Rules for CN type-1 cumulative statements and explicitly unqualified legacy history.

Response width can reveal a shortfall; it cannot certify whole-market completeness.
Receipts bound to retained rows permit a bounded historical refresh interval, never a
permanent completion inferred from the presence of one issuer or one reporting date.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
from pathlib import Path

QUARTER_ENDS = {"0331": 1, "0630": 2, "0930": 3, "1231": 4}
COMPLETE = "complete"  # legacy receipt only; never emitted or accepted as proof
OBSERVED = "coverage_unknown"
TRUNCATED, EMPTY, FAILED = "truncated", "empty", "failed"
RECEIPT_SCHEMA = "mastermind.cn-statement-observation/v2"


def normalize_period(value):
    text = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        text = text.replace("-", "")
    if not re.fullmatch(r"\d{8}", text):
        return ""
    try:
        dt.datetime.strptime(text, "%Y%m%d")
    except ValueError:
        return ""
    return text


def quarter_number(end_date):
    period = normalize_period(end_date)
    return QUARTER_ENDS.get(period[4:]) if period else None


def is_quarter_end(end_date):
    return quarter_number(end_date) is not None


def quarter_label(end_date):
    period = normalize_period(end_date)
    number = quarter_number(period)
    return f"Q{number} {period[:4]}" if number else period


def prior_quarter_end(end_date):
    period = normalize_period(end_date)
    quarter = quarter_number(period)
    if not quarter:
        return None
    year = int(period[:4]) - (quarter == 1)
    suffix = ("1231", "0331", "0630", "0930")[quarter - 1]
    return f"{year:04d}{suffix}"


def parse_quarter_label(label):
    match = re.fullmatch(r"Q([1-4]) (\d{4})", str(label or ""))
    return (match[2], int(match[1])) if match else (None, None)


def prior_quarter(year, quarter):
    return (year, quarter - 1) if quarter > 1 else (str(int(year) - 1), 4)


def contiguous_prior(present_periods, end_date):
    period, base = normalize_period(end_date), prior_quarter_end(end_date)
    if not base or base[:4] != period[:4]:
        return None
    return base if base in {normalize_period(p) for p in present_periods} else None


def report_date(ann_date, f_ann_date=None):
    for candidate in (f_ann_date, ann_date):
        period = normalize_period(candidate)
        if period:
            return f"{period[:4]}-{period[4:6]}-{period[6:]}"
    return None


def declared_report_type(row):
    value = row.get("report_type")
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    value = str(value).strip()
    if value.lower() in ("", "nan", "none", "<na>"):
        return ""
    return value[:-2] if re.fullmatch(r"\d+\.0", value) else value


def is_consolidated(row):
    """This lane qualifies only type 1 cumulative consolidated reports.

    Other vendor types can also be consolidated but have distinct duration or
    revision roles. They are not interchangeable on this lane's period key.
    Missing legacy metadata is retained separately and remains unknown.
    """
    return declared_report_type(row) in ("1", "合并报表")


def retainable_row(row):
    return not declared_report_type(row) or is_consolidated(row)


def revision_rank(row):
    flag = str(row.get("update_flag", "")).strip()
    return (int(is_consolidated(row)), int(flag in ("1", "1.0")),
            normalize_period(row.get("f_ann_date")), normalize_period(row.get("ann_date")))


_IDENTITY = {"ts_code", "end_date", "ann_date", "f_ann_date", "report_type", "update_flag", "comp_type"}


def clean_value(value):
    if isinstance(value, dict):
        return {str(k): clean_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_value(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def financial_payload(row):
    return clean_value({k: v for k, v in row.items() if k not in _IDENTITY and not k.startswith("_")})


def pick_revision(rows):
    eligible = [r for r in rows if r and retainable_row(r)]
    if not eligible:
        return None
    best = max(revision_rank(r) for r in eligible)
    tied = [r for r in eligible if revision_rank(r) == best]
    first = financial_payload(tied[0])
    if any(financial_payload(r) != first for r in tied[1:]):
        return None  # unknown authority, not lexicographic financial selection
    return tied[0]


def revision_key(row):
    return str(row.get("ts_code") or ""), normalize_period(row.get("end_date"))


def rows_digest(rows):
    normalized = [clean_value(r) for r in rows]
    normalized.sort(key=lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False))
    return hashlib.sha256(json.dumps(normalized, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def period_receipts(path):
    try:
        data = json.loads(Path(path).read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_period_receipts(path, receipts):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(receipts, sort_keys=True, indent=2, allow_nan=False))
    temporary.replace(path)


def periods_to_pull(periods, receipts, *, force=False, refresh_periods=6, now=None, historical_days=30):
    ordered = [p for item in periods if (p := normalize_period(item))]
    newest = set(sorted(ordered, reverse=True)[:max(0, int(refresh_periods))])
    now = now or dt.datetime.now(dt.timezone.utc)
    todo = []
    for period in ordered:
        receipt = receipts.get(period) or {}
        eligible = (receipt.get("schema") == RECEIPT_SCHEMA
                    and receipt.get("status") == OBSERVED
                    and receipt.get("binding_valid") is True)
        try:
            acquired = dt.datetime.fromisoformat(receipt["acquired_at"].replace("Z", "+00:00"))
            age = (now - acquired).total_seconds() if acquired.tzinfo else -1
            eligible = eligible and 0 <= age < historical_days * 86400
        except (KeyError, TypeError, ValueError):
            eligible = False
        if force or period in newest or not eligible:
            todo.append(period)
    return todo


def comparable_period(end_date):
    period = normalize_period(end_date)
    return f"{int(period[:4])-1:04d}{period[4:]}" if is_quarter_end(period) else None


def truncated_period(end_date, ticker_count, receipts, fallback_reference=None):
    reference = receipts.get(comparable_period(end_date)) or {}
    try:
        reference_count = int(reference.get("tickers") or fallback_reference or 0)
        return reference_count > 0 and int(ticker_count) < reference_count * .90
    except (TypeError, ValueError):
        return False


ADDITIVE_FIELDS = frozenset({"total_revenue", "revenue", "n_income", "n_income_attr_p"})
NON_ADDITIVE_FIELDS = frozenset({"basic_eps", "diluted_eps"})


def quarter_of(end_date):
    if isinstance(end_date, int) and not isinstance(end_date, bool):
        return end_date if end_date in (1, 2, 3, 4) else None
    return quarter_number(end_date)


def compatible_cumulative_rows(current, previous):
    if not is_consolidated(current) or not is_consolidated(previous):
        return False
    if current.get("_revision_conflict") or previous.get("_revision_conflict"):
        return False
    period = normalize_period(current.get("end_date"))
    base = normalize_period(previous.get("end_date"))
    if not period or not base or base[:4] != period[:4] or prior_quarter_end(period) != base:
        return False
    # Different correction roles or declared company scopes cannot form a verified bridge.
    for key in ("update_flag", "comp_type"):
        a, b = clean_value(current.get(key)), clean_value(previous.get(key))
        if a != b:
            return False
    return True


def discrete_value(field, end_date, cumulative, base_cumulative, *, published_discrete=None):
    if published_discrete is not None:
        return published_discrete, "published"
    if cumulative is None:
        return None, "missing"
    if quarter_of(end_date) == 1:
        return cumulative, "as_reported"
    if field in NON_ADDITIVE_FIELDS:
        return None, "discrete_eps_unavailable"
    if field not in ADDITIVE_FIELDS or base_cumulative is None:
        return None, "no_base"
    return cumulative - base_cumulative, "derived"
