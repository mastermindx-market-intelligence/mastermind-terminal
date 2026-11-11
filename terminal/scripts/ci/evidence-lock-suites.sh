#!/usr/bin/env bash
# Unit suites that read capture-produced evidence: the records-mode composition
# readers (selectedComposition) and every evidence-lock suite (sha256 locks that
# the capture step refreshes on this checkout). They run in the terminal-unit
# evidence lane after capture, exactly where `npm test` ran them before the
# unit split; the parallel unit shards exclude this same list.
set -euo pipefail
cd "$(dirname "$0")/../.."
shopt -s nullglob
grep -lE 'selectedComposition\(|without (a )?recaptur' lib/__tests__/*.test.ts lib/__tests__/*.test.tsx | LC_ALL=C sort
