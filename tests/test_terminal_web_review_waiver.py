"""Source-only checks for Terminal's Chairman-attended Web review waiver.

These contracts do not claim protected merge, installed client instructions, an
actual native GitHub approval, or a production session behavioral canary.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def section(relative: str, start: str, end: str) -> str:
    body = read(relative)
    return body.split(start, 1)[1].split(end, 1)[0]


def test_root_attended_web_waiver_retains_approval_and_machine_boundary():
    body = section(
        "AGENTS.md", "## Session-owned PR/source review", "## Finish the existing release"
    )
    for evidence in (
        "FAST, STANDARD, and CRITICAL",
        "do not impose a blanket independent technical reviewer",
        "Existing native GitHub/CODEOWNERS approvals",
        "recorded release/security holds",
        "exact-head CI",
        "never self-approve, self-merge",
        "signed automatic GitHub/Executive machine review path",
        "A proposed PR",
        "child is **not** formal GitHub non-author",
        "No denied or EFFECT_UNKNOWN reviewer operation may be rerouted",
    ):
        assert evidence in body, evidence
    assert 'only after Mastermind #2018/#2026' not in body
    assert 'incumbent full-path/review requirements remain' not in body


def test_nested_attended_web_waiver_is_not_an_author_signed_skip_label():
    body = section(
        "terminal/AGENTS.md", "## Review without another session", "## Original-PR delivery ownership"
    )
    for evidence in (
        "FAST, STANDARD, and CRITICAL",
        "no blanket independent reviewer requirement",
        "ordinary executable/non-T0",
        "native GitHub/CODEOWNERS requirements",
        "explicit security/release holds",
        "default-OFF signed automatic GitHub/Executive machine reviewer",
        "do not assume a proposed PR is live",
        "No account switching",
        "self-merge",
    ):
        assert evidence in body, evidence
    assert 'Until that consumer is accepted/enrolled, preserve required independent review' not in body
    assert 'other non-T0 changes' not in body


def test_claude_inherits_single_source_without_duplicate_waiver():
    for relative in ("CLAUDE.md", "terminal/CLAUDE.md"):
        body = read(relative)
        assert body.startswith("@AGENTS.md\n"), relative
        assert body.count("@AGENTS.md") == 1
