"""Publication integrity for Terminal OHLC JSON."""

import pandas as pd

from ingest.build_universe import build_ohlc_json


def test_build_ohlc_json_drops_only_zero_volume_flat_non_trading_rows():
    """Suspension placeholders are omitted without deleting a genuinely traded flat day."""
    idx = pd.to_datetime(["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24"])
    source = pd.DataFrame(
        {
            "open": [24.34, 24.56, 25.00, 26.00],
            "close": [24.56, 24.56, 25.00, 26.00],
            "high": [25.39, 24.56, 25.00, 26.00],
            "low": [24.20, 24.56, 25.00, 26.00],
            "volume": [47_735_572.0, 0.0, 10_000.0, float("nan")],
        },
        index=idx,
    )

    doc = build_ohlc_json("002155.SZ", source)

    assert [bar[0] for bar in doc["bars"]] == [
        "2026-08-19",
        "2026-08-21",
        "2026-08-24",
    ]
    assert doc["bars"][1][-1] == 10_000.0
    assert doc["bars"][2][-1] is None
