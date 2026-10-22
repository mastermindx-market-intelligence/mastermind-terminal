#!/usr/bin/env bash
# Existing CN/HK intel refresh driver. Each market stages and publishes independently.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CA="$(cd "$SCRIPT_DIR/.." && pwd)"
MACRO="${MACRO_REPO:-/Users/chriswong/Documents/Cluade/Macro Dashboard}"
PY="${MM_REFRESH_PY:-$MACRO/.venv/bin/python}"
export MACRO_REPO="$MACRO" CA_ROOT="$CA"
DEPLOY=0
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --deploy) DEPLOY=1 ;;
    --force-hk|--skip-collect|--dry-run) ARGS+=("$1") ;;
    --market) shift; [ $# -gt 0 ] || exit 2; ARGS+=(--market "$1") ;;
    *) echo "unknown flag: $1"; exit 2 ;;
  esac
  shift
done
cd "$MACRO" || exit 1
set -a
[ -f "$MACRO/.env" ] && . "$MACRO/.env"
set +a
"$PY" "$CA/ingest/regional_refresh.py" --phase intel "${ARGS[@]}"
RC=$?
if [ "$DEPLOY" = "1" ] && [ "$RC" = "0" ]; then
  # All source publication remains Git-gated through the canonical build owner.
  ssh -i "$HOME/.ssh/macro_dashboard_deploy_v2" -o BatchMode=yes -o StrictHostKeyChecking=yes \
    root@146.190.142.17 'bash /opt/terminal/terminal-build.sh'
  RC=$?
fi
exit "$RC"
