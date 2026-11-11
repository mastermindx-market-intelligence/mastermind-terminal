#!/usr/bin/env bash
# Unit suites that read capture-produced evidence: the records-mode composition
# readers (selectedComposition) and every evidence-lock suite (sha256 locks that
# the capture step refreshes on this checkout). They run in the terminal-unit
# evidence lane after capture, exactly where `npm test` ran them before the
# unit split; the parallel unit shards exclude this same list.
set -euo pipefail
cd "$(dirname "$0")/../.."
shopt -s nullglob
# Markers: the composition reader, the evidence-lock message, and the lexicon
# projection lock (its packet is rewritten by every batch-1 capture). grep exit
# 1 (no match) fails the script under -e; the callers also refuse an empty list.
grep -lE 'selectedComposition\(|without (a )?recaptur|assertCapturedLexProjection\(' \
  lib/__tests__/*.test.ts lib/__tests__/*.test.tsx | LC_ALL=C sort
