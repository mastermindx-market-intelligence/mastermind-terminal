# Shared by the existing fund and CN/HK launchd lanes, before checkout or cache writes.
# Return 10 when another owner remains; never delete a lock with an absent/unknown PID.
acquire_fund_writer_lock() {
  local waited=0 owner current
  if [ "${2:-}" = "--lock-held" ]; then
    [ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" = "$$" ] || return 1
    return 0
  fi
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    owner="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    case "$owner" in
      ''|*[!0-9]*) ;;
      *)
        if ! kill -0 "$owner" 2>/dev/null; then
          current="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
          if [ "$current" = "$owner" ]; then
            rm -f "$LOCK_DIR/pid"
            rmdir "$LOCK_DIR" 2>/dev/null || true
            continue
          fi
        fi ;;
    esac
    [ "$waited" -lt "${1:-0}" ] || return 10
    sleep 5
    waited=$((waited + 5))
  done
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
}
release_fund_writer_lock() {
  if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" = "$$" ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}
