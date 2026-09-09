"""B-F12-9 canary: transfer audit rows and lock-hold measurement.

CI run 34394270728 failed `audit:transfer_writes_two_rows` on head 1dffaa75 because
the before-count included INSERT trigger rows (old_role IS NULL; before=3) while the
after-read kept only `old_role is not null` (the two transfer UPDATE rows). The
receipt already showed the required pair
`[('owner','admin',t_owner), ('admin','owner',t_owner)]`. These tests lock the
source so that conjunct cannot regress.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANARY = ROOT / "terminal" / "scripts" / "f12_team_postgres_canary.py"


def _transfer_block() -> str:
    src = CANARY.read_text(encoding="utf-8")
    marker = "# --- B-F12-9:"
    at = src.find(marker)
    assert at >= 0, "canary is missing the B-F12-9 transfer block"
    return src[at:]


def test_transfer_audit_before_and_after_count_the_same_population():
    """RED on 1dffaa75: audit_before counted every team_role_changes row."""
    block = _transfer_block()
    before_at = block.find("audit_before")
    assert before_at > 0
    window = block[max(0, before_at - 400) : before_at]
    assert "old_role is not null" in window, (
        "audit_before must count only UPDATE/DELETE log rows (old_role is not null), "
        "matching the after-read. Insert-trigger rows (owner/admin/member, old_role NULL) "
        "must not be in the before count. CI run 34394270728: before=3 after=2."
    )
    after_at = block.find("audit_rows = cur.fetchall()")
    assert after_at > 0
    after_window = block[max(0, after_at - 400) : after_at]
    assert "old_role is not null" in after_window


def test_transfer_audit_conjunct_requires_exactly_two_new_update_rows():
    block = _transfer_block()
    assert "len(audit_rows) == audit_before + 2" in block
    assert "len(audit_rows) >= audit_before + 2" not in block


def test_lock_hold_check_can_fail():
    """Risk 5: lock-hold must be a real measurement, not `>= 0` which cannot fail."""
    block = _transfer_block()
    assert "lock_hold_ms >= 0" not in block
    assert "0 < lock_hold_ms" in block
    assert "clock_timestamp()" in block
