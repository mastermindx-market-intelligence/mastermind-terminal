"""Canonical temporal contract for ``fund.earnings.next_date``.

``next_date`` is a claim about the *future*: it means the earliest known report date
that is not earlier than the current UTC calendar day. Every fundamentals emitter
(US / HK / CN) shares this one selector so the three artifact families cannot drift
apart, and so a vendor calendar that has gone stale degrades to ``None`` instead of
publishing a past date under a "next" label.

Boundary rules (see mastermind-terminal#474):

* a date later today, and today itself, are valid — a date-only source cannot prove
  whether a same-day report has already been filed;
* a past date is never valid;
* mixed past/future candidates select the earliest candidate that is not past;
* malformed / unparseable candidates are ignored, never repaired or guessed;
* an empty candidate set yields ``None``;
* when the vendor withdraws a future date, the result is ``None`` — a previously
  emitted date is never carried forward once it has crossed into the past.

Historical reports are unaffected; they remain in ``earnings.q[]`` / ``earnings.fy[]``.
"""
from __future__ import annotations

import datetime as dt

__all__ = ["utc_today", "select_next_earnings_date"]


def utc_today() -> dt.date:
    """The current UTC calendar day.

    Isolated so the observation day is injectable in tests and never depends on the
    host timezone, on DST, or on a browser-local midnight.
    """
    return dt.datetime.now(dt.timezone.utc).date()


def _parse_calendar_day(candidate: object) -> dt.date | None:
    """Best-effort exact date parse; ``None`` for anything not provably a calendar day.

    Deliberately conservative. Vendor frames leak ``float('nan')``, ``pandas.NaT`` and
    ``None`` into date columns, all of which stringify into plausible-looking junk
    (``'nan'``, ``'NaT'``, ``'None'``); each must be dropped rather than guessed at.

    The exact-type check on the way out is load-bearing, not defensive noise:
    ``pandas.NaT`` is a *subclass of ``datetime``*, so it passes an ``isinstance``
    gate, and ``NaT.date()`` returns ``NaT`` rather than raising. Comparing that to a
    real date raises ``TypeError: Cannot compare NaT with datetime.date object`` — i.e.
    one null in a vendor calendar would abort the emitter instead of being skipped.
    ``pandas.Timestamp.date()`` returns a genuine ``datetime.date``, so requiring the
    exact type separates the two without importing pandas here.
    """
    if candidate is None or isinstance(candidate, bool):
        return None
    parsed: object
    if isinstance(candidate, dt.datetime):
        parsed = candidate.date()
    elif isinstance(candidate, dt.date):
        parsed = candidate
    else:
        text = str(candidate).strip()
        if not text:
            return None
        try:
            parsed = dt.date.fromisoformat(text[:10])
        except (TypeError, ValueError):
            return None
    return parsed if type(parsed) is dt.date else None


def select_next_earnings_date(
    raw_dates: object,
    *,
    today: dt.date | None = None,
) -> str | None:
    """Return the earliest known report date on or after ``today``, as ``YYYY-MM-DD``.

    ``raw_dates`` accepts a single value or any sequence of candidates, exactly as the
    upstream vendor calendars hand them over. Returns ``None`` when no candidate is
    provably a present-or-future calendar day.
    """
    if raw_dates is None:
        candidates: list[object] = []
    elif isinstance(raw_dates, (str, bytes)) or not hasattr(raw_dates, "__iter__"):
        candidates = [raw_dates]
    else:
        candidates = list(raw_dates)

    observation_day = today or utc_today()

    upcoming = [
        parsed
        for parsed in (_parse_calendar_day(candidate) for candidate in candidates)
        if parsed is not None and parsed >= observation_day
    ]
    return min(upcoming).isoformat() if upcoming else None
