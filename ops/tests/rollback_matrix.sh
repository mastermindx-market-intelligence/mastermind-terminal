#!/usr/bin/env bash
# Bash harness for the #504 review ruling (M1): stages a fake $APP directory and
# drives deploy_generation_begin / deploy_generation_rollback from
# ops/terminal-build.sh through the four state combinations the review
# enumerated — swapped 0/1 x .next.bak present/absent — asserting the resulting
# .next contents. Independent of the pytest suite in
# tests/test_terminal_build_rollback.py: no python, no pytest, just bash and the
# real script sourced as a library, so it can run wherever bash runs.
#
# The load-bearing case is #1 below: a pre-swap abort (swapped=0) must never let
# a leftover/stale .next.bak overwrite the still-good live .next.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../terminal-build.sh"
[ -f "$SCRIPT" ] || { echo "FATAL: $SCRIPT not found"; exit 1; }

PASS=0
FAIL=0

ok(){ PASS=$((PASS+1)); echo "  ok   - $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL - $1"; }

assert_eq(){
  local desc=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then ok "$desc"; else
    bad "$desc (expected [$expected] got [$actual])"
  fi
}

assert_true(){
  local desc=$1
  shift
  if "$@"; then ok "$desc"; else bad "$desc"; fi
}

# One case = one fresh temp $APP, sourced script, begin + rollback, then assert.
run_case(){
  local case_name=$1 swapped=$2 bak_present=$3
  local tmp app
  tmp=$(mktemp -d)
  app="$tmp/app"
  mkdir -p "$app"

  echo "old-marker-sha" > "$app/.deployment-id"

  # The fixture mirrors what the deploy body actually leaves behind at each
  # abort point (see ops/terminal-build.sh step 6):
  #   swapped=0 -> the swap never ran: .next is still the live GOOD build, and
  #                any .next.bak lying around is unrelated stale leftover (e.g.
  #                a prior deploy's `rm -rf .next.bak` failed to clear it).
  #   swapped=1 -> the old .next has already been moved aside: .next currently
  #                holds the NEW (failing) build, and .next.bak — if present —
  #                holds the true previous good build that must come back.
  mkdir -p "$app/.next"
  if [ "$swapped" = 1 ]; then
    echo "build-NEW-FAILING" > "$app/.next/BUILD_ID"
    if [ "$bak_present" = 1 ]; then
      mkdir -p "$app/.next.bak"
      echo "build-OLD-LIVE-GOOD" > "$app/.next.bak/BUILD_ID"
    fi
  else
    echo "build-OLD-LIVE-GOOD" > "$app/.next/BUILD_ID"
    if [ "$bak_present" = 1 ]; then
      mkdir -p "$app/.next.bak"
      echo "build-STALE-TWO-GENS-OLD" > "$app/.next.bak/BUILD_ID"
    fi
  fi

  local staged="$tmp/staged-deployment-id"
  echo "new-marker-sha" > "$staged"

  echo "-- case: $case_name (swapped=$swapped bak_present=$bak_present) --"

  # Source the real script as a library (guarded return-on-source at the bottom
  # of terminal-build.sh means nothing gets deployed) and drive begin+rollback.
  # `deploy_generation_rollback` returning non-zero is an EXPECTED outcome for
  # some cases, and terminal-build.sh itself is `set -euo pipefail` — sourcing
  # it re-applies that to this subshell, so the rollback call must be guarded
  # with `||` or a non-zero return exits the subshell before `echo "RC=..."`
  # ever runs (that exact trap is bug #1 this harness had while being written).
  local out rc
  out=$(
    # shellcheck disable=SC1090
    . "$SCRIPT"
    deploy_generation_begin "$app" "$staged"
    _rc=0
    deploy_generation_rollback "$app" "$swapped" || _rc=$?
    echo "RC=$_rc"
  )
  rc=$(printf '%s\n' "$out" | grep -o 'RC=[0-9]*' | tail -1 | cut -d= -f2)

  local live_build
  live_build=$(cat "$app/.next/BUILD_ID" 2>/dev/null || echo '<absent>')
  local marker
  marker=$(cat "$app/.deployment-id" 2>/dev/null || echo '<absent>')

  case "$case_name" in
    "swapped=0 bak=present (M1 repro)")
      # The load-bearing assertion: a pre-swap abort must NEVER let a stale
      # .next.bak overwrite the still-good live .next.
      assert_eq "rollback reports success (nothing needed restoring)" "0" "$rc"
      assert_eq ".next is UNTOUCHED (still the live good build)" "build-OLD-LIVE-GOOD" "$live_build"
      assert_true ".next.bak is left exactly as it was (still the stale build)" \
        _check_stale_bak_untouched "$app"
      assert_true ".next.broken must not exist — nothing was moved" \
        _check_no_broken "$app"
      ;;
    "swapped=0 bak=absent")
      assert_eq "rollback reports success (nothing to restore, nothing needed)" "0" "$rc"
      assert_eq ".next is UNTOUCHED (still the live good build)" "build-OLD-LIVE-GOOD" "$live_build"
      ;;
    "swapped=1 bak=present")
      assert_eq "rollback reports success (restored the previous build)" "0" "$rc"
      assert_eq ".next is RESTORED to the previous good build" "build-OLD-LIVE-GOOD" "$live_build"
      assert_eq "marker is restored to the old sha" "old-marker-sha" "$marker"
      ;;
    "swapped=1 bak=absent")
      # Nothing to restore to, and the build that just failed health is live —
      # this MUST be reported as a failure, never a clean rollback.
      assert_eq "rollback reports FAILURE (nothing to restore, failing build is live)" "1" "$rc"
      ;;
  esac

  rm -rf "$tmp"
}

_check_stale_bak_untouched(){
  local app=$1
  [ -d "$app/.next.bak" ] || return 1
  [ "$(cat "$app/.next.bak/BUILD_ID" 2>/dev/null)" = "build-STALE-TWO-GENS-OLD" ]
}

_check_no_broken(){
  local app=$1
  [ ! -e "$app/.next.broken" ]
}

echo "=== ops/tests/rollback_matrix.sh — 4-way swapped x .next.bak matrix ==="
run_case "swapped=0 bak=present (M1 repro)" 0 1
run_case "swapped=0 bak=absent" 0 0
run_case "swapped=1 bak=present" 1 1
run_case "swapped=1 bak=absent" 1 0

echo
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" = 0 ]
