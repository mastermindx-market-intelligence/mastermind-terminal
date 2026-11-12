"""Regression contracts for title ownership in multi-person transcript rosters."""
import gzip
import itertools
import json

import pytest

from ingest.collect_transcripts import _infer_role, _infer_transcript_roles
from ingest.repair_transcript_roles import repair_roles


PAIRS = [
    ("Jensen Huang", "Colette Kress"),
    ("Jane Doe", "John Smith"),
    ("Tim Cook", "Kevan Parekh"),
]


@pytest.mark.parametrize(
    "names,reverse,title_first,separator,qualified",
    itertools.product(PAIRS, (False, True), (False, True),
                      (", ", ", and ", " — ", "; "), (False, True)),
)
def test_roster_binds_both_titles_without_a_distance_or_direction_bias(
    names, reverse, title_first, separator, qualified,
):
    people = [
        (names[0], "Chief Executive Officer", "CEO"),
        (names[1], ("Executive Vice President and " if qualified else "")
         + "Chief Financial Officer", "CFO"),
    ]
    if reverse:
        people.reverse()
    entries = [
        f"{title}, {name}" if title_first else f"{name}, {title}"
        for name, title, _role in people
    ]
    text = "Joining today's call are " + separator.join(entries) + "."
    for name, _title, role in people:
        assert _infer_role(name, text) == role


def test_other_speaker_can_introduce_the_nvda_roster():
    introduction = (
        "Joining me on today's call are Jensen Huang, Chief Executive Officer, "
        "and Colette Kress, Executive Vice President and Chief Financial Officer."
    )
    segments = [
        {"speaker": "Operator", "role": "", "text": introduction},
        {"speaker": "Jensen Huang", "role": "", "text": "Thank you. Welcome."},
        {"speaker": "Colette Kress", "role": "", "text": "Revenue increased."},
        {"speaker": "Jensen Huang", "role": "", "text": "Our outlook is unchanged."},
        {"speaker": "Colette Kress", "role": "", "text": "Thank you."},
    ]
    assert _infer_transcript_roles(segments) == [
        "Operator", "CEO", "CFO", "CEO", "CFO",
    ]


@pytest.mark.parametrize("text", [
    "Jane Doe, CEO, John Smith.",
    "Jane Doe and our CEO, John Smith.",
    "Jane Doe; CEO John Smith.",
    "Jane Doe — and CEO John Smith.",
    "Jane Doe: and CEO John Smith.",
])
def test_adjacent_other_person_title_does_not_become_a_role(text):
    assert _infer_role("Jane Doe", text) == ""


@pytest.mark.parametrize("title_first", [False, True])
def test_short_role_abbreviations_bind_without_character_distance_ties(title_first):
    text = (
        "CEO, Jane Doe, CFO, John Smith."
        if title_first else "Jane Doe, CEO, John Smith, CFO."
    )
    assert _infer_role("Jane Doe", text) == "CEO"
    assert _infer_role("John Smith", text) == "CFO"


@pytest.mark.parametrize("connector", [", ", ": ", " — "])
def test_single_name_with_an_explicit_local_title(connector):
    assert _infer_role("Jane Doe", "Jane Doe" + connector + "CFO.") == "CFO"
    assert _infer_role("Jane Doe", "CFO" + connector + "Jane Doe.") == "CFO"


def test_speaker_turns_are_not_concatenated_to_form_a_title():
    segments = [
        {"speaker": "Operator", "role": "", "text": "Chief Financial Officer"},
        {"speaker": "John Smith", "role": "", "text": "Colette Kress."},
        {"speaker": "Colette Kress", "role": "", "text": "Revenue increased."},
    ]
    assert _infer_transcript_roles(segments) == ["Operator", "", ""]


@pytest.mark.parametrize("title_first", [False, True])
def test_long_titles_and_their_abbreviations_are_one_owned_role(title_first):
    entries = [
        ("Jane Doe", "Chief Executive Officer (CEO)"),
        ("John Smith", "Chief Financial Officer (CFO)"),
        ("Mary Jones", "Chief Operating Officer (COO)"),
    ]
    text = ", ".join(
        f"{title}, {name}" if title_first else f"{name}, {title}"
        for name, title in entries
    )
    assert [_infer_role(name, text) for name, _title in entries] == ["CEO", "CFO", "COO"]


def test_known_participants_are_bound_even_without_capitalized_names():
    segments = [
        {"speaker": "Operator", "text": (
            "Joining us are ana de la cruz, Chief Executive Officer, "
            "and li wei, Executive Vice President and Chief Financial Officer."
        )},
        {"speaker": "ana de la cruz", "text": "Welcome."},
        {"speaker": "li wei", "text": "Revenue increased."},
    ]
    assert _infer_transcript_roles(segments) == ["Operator", "CEO", "CFO"]


def test_ambiguous_title_does_not_leak_to_either_known_participant():
    segments = [
        {"speaker": "Operator", "text": "ana de la cruz, CFO, li wei."},
        {"speaker": "ana de la cruz", "text": "Welcome."},
        {"speaker": "li wei", "text": "Revenue increased."},
    ]
    assert _infer_transcript_roles(segments) == ["Operator", "", ""]


@pytest.mark.parametrize("old_role,expected_changes", [
    ("CFO", 0), ("CEO", 2), ("", 2),
])
def test_existing_repair_preserves_or_corrects_roles_without_changing_content(
    tmp_path, old_role, expected_changes,
):
    path = tmp_path / "NVDA" / "2026Q2.json.gz"
    path.parent.mkdir()
    payload = {
        "schema": "mastermind.tx/v1", "ticker": "NVDA", "id": "2026Q2",
        "period": "Q2 FY2026", "date": "2026-05-01",
        "title": "NVDA Earnings Call Q2 FY2026",
        "segments": [
            {"speaker": "Operator", "role": "Operator", "text": (
                "Joining me on today's call are Jensen Huang, Chief Executive "
                "Officer, and Colette Kress, Executive Vice President and "
                "Chief Financial Officer."
            )},
            {"speaker": "Jensen Huang", "role": "CEO", "text": "Welcome."},
            {"speaker": "Colette Kress", "role": old_role, "text": "Revenue increased."},
            {"speaker": "Colette Kress", "role": old_role, "text": "Thank you."},
        ],
    }
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(payload, handle)
    original = path.read_bytes()
    dry_run = repair_roles(tmp_path)
    assert dry_run["roles_changed"] == expected_changes
    assert dry_run["bodies_written"] == 0
    assert path.read_bytes() == original

    first = repair_roles(tmp_path, write=True)
    after_first = path.read_bytes()
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        actual = json.load(handle)
    assert first["roles_changed"] == expected_changes
    expected = json.loads(json.dumps(payload))
    expected["segments"][2]["role"] = "CFO"
    expected["segments"][3]["role"] = "CFO"
    assert actual == expected

    second = repair_roles(tmp_path, write=True)
    assert second["roles_changed"] == second["bodies_written"] == 0
    assert path.read_bytes() == after_first

