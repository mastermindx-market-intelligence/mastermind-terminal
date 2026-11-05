"""The canonical daily-multiple (2D/3D) session-anchor contract published to the browser.

WHY THIS EXISTS
---------------
``signal_layer/confluence.py`` builds 3D bars the way TradingView does: it groups TRADING
SESSIONS three at a time, phased by ``bar_anchor`` — the global session index, counted from the
symbol's FIRST listed session (IPO), of the fed series' first row — and labels each bar by its
OPEN session. ``ipo_bar_anchor()`` exists precisely because a truncated feed must not re-phase
the grid at its own first row.

The browser renders the same symbol from ``/data/<SYM>.json``, which IS a truncated feed for most
names. It has no IPO session calendar and it must not invent one: the phase is simply not
derivable from the truncated rows. So the producer that already knows the anchor publishes it,
and the chart consumes it. That is this module.

SHAPE (additive; absent on an unstamped document, and absence is legal)
----------------------------------------------------------------------
``<SYM>.json`` gains one object::

    "session_anchor": {"v": 1, "date": "2021-06-28", "index": 5645, "basis": "ipo"}

  ``date``   an ISO session date that appears in this document's own ``bars``. It is an anchor
             POINT, not "the first bar": a consumer locates it in whatever rows it holds and
             derives row 0's global index as ``index - position``. That keeps the contract
             correct when the feed is later extended backwards or appended to, which is what
             every nightly does.
  ``index``  that session's global index counted from the symbol's first listed session.
  ``basis``  ``"ipo"``  the deep store resolved this symbol's own session calendar — a real
                        global index (see ``confluence.ipo_bar_anchor_basis``).
             ``"feed"`` it did not. ``index`` is then 0 meaning "phase at this feed's first
                        row" — NOT a claim about the IPO. This is exactly the fallback the
                        signal engine itself takes for the same symbol, so a chart that honours
                        it still matches the Oracle bar-for-bar; it just isn't TV-phased.

  ``basis`` is load-bearing. The integer alone cannot distinguish "genuinely session 0 of a
  full-history feed" from "we could not find out" — and a consumer that treated the second as
  the first would be fabricating an IPO phase out of truncated data.

WHO WRITES IT
-------------
``ingest/stamp_session_anchors.py`` (the nightly pass, after every OHLC writer) and
``ingest/build_polygon_universe.py`` (inline, because it rebuilds the flagship documents from
scratch in Phase 1 and would otherwise drop the field for the hours until the marathon reaches
the stamping step). Both call ``stamp()`` here, so there is ONE derivation.

This module reads the session calendar ONLY through ``signal_layer.confluence`` — the same
authority the signal engine uses. It is not a second market calendar.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

# ``ingest/`` runs as SCRIPTS (``$PY ingest/gen_fund_us.py``), so sys.path[0] is ingest/, not
# the repo root — a bare ``from signal_layer...`` passes pytest and raises ModuleNotFoundError
# in the nightly. House bootstrap (see gen_slices_all.py).
CA_ROOT = Path(__file__).resolve().parents[1]
if str(CA_ROOT) not in sys.path:
    sys.path.insert(0, str(CA_ROOT))

from signal_layer import confluence  # noqa: E402

#: Contract version carried in the published object. Bump only on a breaking shape change.
CONTRACT_VERSION = 1

#: The document key. Additive — nothing reads a document by its absence.
FIELD = "session_anchor"


def anchor_for(bar_dates: list[str], symbol: str) -> dict | None:
    """The published anchor object for a document whose ``bars`` open on ``bar_dates``.

    Returns ``None`` for an empty series (nothing to anchor). The anchor point is the feed's
    FIRST session, which is the row whose global index ``confluence.ipo_bar_anchor_basis``
    actually resolves.
    """
    if not bar_dates:
        return None
    try:
        idx = pd.to_datetime(list(bar_dates))
    except Exception:
        return None
    if len(idx) == 0:
        return None
    feed = pd.Series(range(len(idx)), index=idx, dtype="float64")
    index, basis = confluence.ipo_bar_anchor_basis(feed, symbol)
    return {
        "v": CONTRACT_VERSION,
        "date": str(pd.Timestamp(idx[0]).date()),
        "index": int(index),
        "basis": basis,
    }


def stamp(doc: dict, symbol: str) -> bool:
    """Stamp ``doc`` in place with its ``session_anchor``. Returns True when the document
    CHANGED, so a caller walking thousands of files rewrites only what moved.

    A document with no usable ``bars`` is left alone rather than stamped with a guess.
    """
    bars = doc.get("bars") or []
    dates = [b[0] for b in bars if isinstance(b, (list, tuple)) and b]
    anchor = anchor_for(dates, symbol)
    if anchor is None:
        return False
    if doc.get(FIELD) == anchor:
        return False
    doc[FIELD] = anchor
    return True
