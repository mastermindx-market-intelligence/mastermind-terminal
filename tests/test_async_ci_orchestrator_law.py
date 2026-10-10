from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_root_and_nested_agent_law_make_ci_wait_asynchronous():
    for relative in ("AGENTS.md", "terminal/AGENTS.md"):
        text = (ROOT / relative).read_text(encoding="utf-8")
        lower = text.lower()
        assert "foreground" in lower, relative
        assert "asynchronous watcher" in lower or "watcher/return path" in lower, relative
        assert "independent authorized" in lower, relative
        assert "gh run watch" in text, relative
        assert "gh run view --watch" in text, relative
        assert "gh pr checks --watch" in text, relative
        assert "repeated sleep/poll" in lower, relative
        assert "live verification" in lower, relative


def test_root_definition_of_done_does_not_turn_ci_into_a_serial_wait():
    text = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    assert "read CI state once" in text
    assert "continue independent authorized work while checks run" in text
    assert "wait for CI" not in text


def test_nested_terminal_law_preserves_owner_without_principal_idling():
    text = (ROOT / "terminal/AGENTS.md").read_text(encoding="utf-8")
    assert "Carrying CI does not mean foreground waiting" in text
    assert "Arm once" in text
    assert "repeated pending reads are not progress" in text
    assert "skip deployment and live verification" in text


def test_merge_on_green_is_a_real_durable_server_side_owner():
    workflow = (ROOT / ".github/workflows/merge-on-green.yml").read_text(encoding="utf-8")
    assert "workflow_run:" in workflow
    assert "types: [completed]" in workflow
    assert "schedule:" in workflow
    assert 'cron: "*/10 * * * *"' in workflow
    assert "cancel-in-progress: false" in workflow
    assert "python3 scripts/merge_on_green.py" in workflow
