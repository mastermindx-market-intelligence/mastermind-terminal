"""Independent Python oracle for the shared P1 authored-text vectors only.

Not a production Python manifest validator, schema owner, identity resolver, or
permission grant. Macro's complete paired-schema integration remains separate.
"""
from __future__ import annotations

import json
from pathlib import Path
import unittest

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "terminal/lib/__tests__/fixtures/investigation_text_vectors.json"
)
# ECMAScript TrimString WhiteSpace + LineTerminator, explicitly fixed here so
# Python str.strip's different whitespace set cannot silently change the rule.
TRIM = "\u0009\u000b\u000c\u0020\u00a0\ufeff\u000a\u000d\u1680\u2028\u2029\u202f\u205f\u3000" + "".join(
    chr(point) for point in range(0x2000, 0x200B)
)


def text_error(text: str, field: str) -> str | None:
    """Express the frozen test-vector rule, without changing the supplied text."""
    if not text.strip(TRIM):
        return "empty_text"
    limit = {"title": 160, "question": 2000}[field]
    for index, character in enumerate(text, start=1):
        point = ord(character)
        if 0xD800 <= point <= 0xDFFF:
            return "invalid_unicode"
        if point == 0:
            return "unsupported_code_point"
        if index > limit:
            return "text_too_long"
    if any((1 <= ord(char) <= 31 and char not in "\t\n\r") or ord(char) == 127 for char in text):
        return "invalid_control"
    if field == "title" and any(char in "\t\n\r" for char in text):
        return "invalid_control"
    return None


class InvestigationTextVectors(unittest.TestCase):
    def test_shared_vectors_and_exact_roundtrip(self) -> None:
        bundle = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(bundle["schema"], "investigation_text_vectors.v1")
        self.assertEqual(len(bundle["vectors"]), 30)
        for vector in bundle["vectors"]:
            with self.subTest(vector=vector["name"]):
                before = vector["text"]
                error = text_error(before, vector["field"])
                self.assertEqual(error is None, vector["valid"])
                self.assertEqual(error, vector["code"])
                self.assertEqual(json.loads(json.dumps(before, ensure_ascii=True)), before)
                if error is None:
                    self.assertEqual(before.encode("utf-8").decode("utf-8"), before)

    def test_preserves_distinct_composed_and_decomposed_belief_text(self) -> None:
        self.assertNotEqual("é", "e\u0301")
        self.assertEqual(text_error("é", "question"), None)
        self.assertEqual(text_error("e\u0301", "question"), None)


if __name__ == "__main__":
    unittest.main()
