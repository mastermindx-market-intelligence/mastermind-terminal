from pathlib import Path
from difflib import SequenceMatcher, unified_diff
from collections import Counter
from bisect import bisect_right
import copy, hashlib, json, re, sys

root = Path(sys.argv[1])
names = ["lint-current.json", "lint-shell-baseline.json", "lint-differential-receipt.json"]
raw = {name: (root / name).read_bytes() for name in names}
current_entries = json.loads(raw["lint-current.json"])
base_entries = json.loads(raw["lint-shell-baseline.json"])
base = next(item for item in base_entries if item["filePath"].endswith("TerminalShell.tsx"))
current = next(item for item in current_entries if item["filePath"].endswith("TerminalShell.tsx"))
base_lines = base["source"].splitlines()
current_lines = current["source"].splitlines()
matcher = SequenceMatcher(None, base_lines, current_lines, autojunk=False)
line_map = {j + k + 1: i + k + 1 for i, j, count in matcher.get_matching_blocks() for k in range(count)}

def mapped_line(value):
    if value is None:
        return None
    return line_map.get(value, f"UNMAPPED:{value}")

def starts_utf16(source):
    starts, total = [], 0
    for line in source.splitlines(keepends=True):
        starts.append(total)
        total += len(line.encode("utf-16-le")) // 2
    return starts, total

base_starts, base_total = starts_utf16(base["source"])
current_starts, current_total = starts_utf16(current["source"])

def mapped_range_position(position):
    if position == current_total:
        return base_total
    index = bisect_right(current_starts, position) - 1
    old_line = line_map.get(index + 1)
    if old_line is None:
        return f"UNMAPPED_RANGE:{position}"
    return base_starts[old_line - 1] + position - current_starts[index]

def normalize_message(message, include_prose=True):
    # Only map explicit source locations. Do not strip rule prose or code text.
    message = re.sub(r"(TerminalShell\.tsx:)(\d+)(:\d+)", lambda m: m[1] + str(mapped_line(int(m[2]))) + m[3], message)
    message = re.sub(r"^([ >]*)(\d+)( \|)", lambda m: m[1] + str(mapped_line(int(m[2]))) + m[3], message, flags=re.M)
    if include_prose:
        message = re.sub(r"(at line )(\d+)", lambda m: m[1] + str(mapped_line(int(m[2]))), message)
    return message

def normalize_diagnostic(message):
    item = copy.deepcopy(message)
    for name in ("line", "endLine"):
        if name in item:
            item[name] = mapped_line(item[name])
    item["message"] = normalize_message(item["message"])
    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "range" and isinstance(child, list) and len(child) == 2 and all(isinstance(x, int) for x in child):
                    value[key] = [mapped_range_position(x) for x in child]
                else:
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(item)
    return item

def anchor(item, current=False):
    return tuple([item.get("ruleId"), item.get("severity"), item.get("nodeType"), item.get("messageId"),
                  mapped_line(item.get("line")) if current else item.get("line"),
                  item.get("column"),
                  mapped_line(item.get("endLine")) if current else item.get("endLine"),
                  item.get("endColumn")])

base_by_anchor = {anchor(item): item for item in base["messages"]}
pairs = [(base_by_anchor.get(anchor(item, True)), item) for item in current["messages"]]
changed_text, frames_only_unmatched, message_unmatched, full_unmatched = [], [], [], []
for old, new in pairs:
    if old is None:
        full_unmatched.append({"current": new, "reason": "new diagnostic anchor"})
        continue
    common = {"rule": new["ruleId"], "severity": new["severity"], "base_line": old["line"], "current_line": new["line"],
              "column": new["column"], "message_id": new.get("messageId"), "base_message_header": old["message"].splitlines()[0],
              "current_message_header": new["message"].splitlines()[0]}
    if old["message"] != new["message"]:
        changed_text.append({**common, "cause": "explicit source locations in code frame" if normalize_message(new["message"], False) == old["message"] else "prose source-line reference",
                             "contains_added_component_text": "SovereignAuctionContext" in new["message"]})
    if normalize_message(new["message"], False) != old["message"]:
        frames_only_unmatched.append(common)
    if normalize_message(new["message"]) != old["message"]:
        message_unmatched.append({**common, "diff": list(unified_diff(old["message"].splitlines(), normalize_message(new["message"]).splitlines(), n=1))})
    normalized = normalize_diagnostic(new)
    if normalized != old:
        full_unmatched.append({**common, "differing_fields": [key for key in sorted(set(old) | set(normalized)) if old.get(key) != normalized.get(key)]})

def canonical(items):
    return sorted(json.dumps(item, sort_keys=True, ensure_ascii=False, separators=(",", ":")) for item in items)

base_canonical = canonical(base["messages"])
current_canonical = canonical(normalize_diagnostic(item) for item in current["messages"])
def canonical_hash(items):
    return hashlib.sha256(("\n".join(items) + "\n").encode()).hexdigest()
def source_meta(value):
    data = value.encode()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "git_blob_sha1": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()}
receipt = {
    "scope": "Read-only analysis of the three existing logs; no lint rerun, source read/write, browser-process interaction, or production claim",
    "log_directory": str(root),
    "inputs": [{"name": name, "bytes": len(raw[name]), "sha256": hashlib.sha256(raw[name]).hexdigest()} for name in names],
    "original_receipt_preserved": json.loads(raw["lint-differential-receipt.json"]),
    "logged_source": {"baseline": source_meta(base["source"]), "current": source_meta(current["source"]),
                      "diff": list(unified_diff(base_lines, current_lines, fromfile="logged-baseline-source", tofile="logged-current-source", n=3)),
                      "line_opcodes": matcher.get_opcodes()},
    "counts": {"baseline_errors": base["errorCount"], "baseline_warnings": base["warningCount"], "current_errors": current["errorCount"],
               "current_warnings": current["warningCount"], "baseline_diagnostics": len(base["messages"]), "current_diagnostics": len(current["messages"]),
               "raw_message_differences": len(changed_text), "after_codeframe_location_mapping_unmatched": len(frames_only_unmatched),
               "after_all_explicit_source_location_mapping_unmatched": len(message_unmatched), "full_normalized_diagnostics_unmatched": len(full_unmatched)},
    "anchor_multisets_equal": Counter(anchor(item) for item in base["messages"]) == Counter(anchor(item, True) for item in current["messages"]),
    "raw_message_differences": changed_text,
    "remaining_after_codeframe_mapping": frames_only_unmatched,
    "remaining_after_message_mapping": message_unmatched,
    "remaining_after_full_diagnostic_mapping": full_unmatched,
    "canonical_baseline_diagnostics_sha256": canonical_hash(base_canonical),
    "canonical_current_diagnostics_sha256": canonical_hash(current_canonical),
    "full_diagnostic_multisets_equal": base_canonical == current_canonical,
    "diagnostics_on_inserted_lines": [item for item in current["messages"] if item.get("line") not in line_map],
    "non_shell_results": [{"path": item["filePath"], "errorCount": item["errorCount"], "warningCount": item["warningCount"]} for item in current_entries if not item["filePath"].endswith("TerminalShell.tsx")],
    "decision": "No introduced lint diagnostic in these exact logged snapshots; full-file lint remains red with 54 pre-existing errors and 14 warnings" if base_canonical == current_canonical else "Unresolved normalized diagnostic differences; inspect remaining fields before adjudication"
}
print(json.dumps(receipt, ensure_ascii=False))
