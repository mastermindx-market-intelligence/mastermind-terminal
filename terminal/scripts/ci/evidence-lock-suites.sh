#!/usr/bin/env bash
# Unit suites that read capture-produced evidence: the records-mode composition
# readers (selectedComposition), every evidence-lock suite (sha256 locks that a
# capture step refreshes on this checkout) and the lexicon projection lock (its
# packet is rewritten by every batch-1 capture). This is the one list:
#   all       every such suite; the parallel unit shards exclude exactly these
#   evidence  suites run in the terminal-unit evidence lane after its capture
#   f11       suites that read the F11 packet; they run in terminal-f11-evidence
#             after the F11 capture, because that job alone produces it
# evidence and f11 partition all: each suite runs after the capture it reads.
set -euo pipefail
cd "$(dirname "$0")/../.."
group="${1:-all}"
case "$group" in all|evidence|f11) ;; *) echo "unknown group: $group" >&2; exit 2 ;; esac
shopt -s nullglob
F11_PACKET='b-f11-10-analysis-theses-entry'
# grep exit 1 (no match) fails the script under -e; callers also refuse an empty list.
listing="$(grep -lE 'selectedComposition\(|without (a )?recaptur|assertCapturedLexProjection\(' \
  lib/__tests__/*.test.ts lib/__tests__/*.test.tsx | LC_ALL=C sort)"
while IFS= read -r suite; do
  if grep -q "$F11_PACKET" "$suite"; then in_f11=1; else in_f11=0; fi
  case "$group" in
    all) echo "$suite" ;;
    evidence) [ "$in_f11" -eq 0 ] && echo "$suite" ;;
    f11) [ "$in_f11" -eq 1 ] && echo "$suite" ;;
  esac
done <<< "$listing"
exit 0
