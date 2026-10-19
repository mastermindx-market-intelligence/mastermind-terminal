# Private BOATS history for Terminal

`TIINGO_BOATS_HISTORY_DIR` selects the existing receipt-bound, completed-session
archive. Production uses `/mnt/terminal_storage/boats-history/current`; its
version switch is owned by the private history delivery receiver.

`TIINGO_BOATS_LIVE_DIR` optionally selects `/mnt/terminal_storage/boats-live-history`.
Provision that real directory and its `requests/` and `bars/` children as mode `0700`,
owned by the Terminal service UID. Interest and snapshot files are mode `0600`.
The application does not create or repair this provisioning. Keep the directory
outside the static web root. Enable it only with the protected consumer installed
and the existing Mac collector/SSH bridge configured; the flag does not start a
collector or authorize provider requests by itself.

The existing intraday route verifies the Supabase user with `auth.getUser()` before
recording demand and before reading its response cache. Anonymous baseline reads
retain the deployment's existing access policy and create no demand. Only 24H US
minute charts through 12h request the current, open overnight session. The immutable
US equity calendar owns holidays and the 20:00–04:00 New York boundaries. Historical
date requests, daily/second charts and regular/extended modes do not create demand.

A single Terminal process owns `requests/`: touches coalesce for 30s, requests expire
after 120s, capacity is 256 symbols and directory scans stop after 1024 entries.
Expired schema-valid owned requests may be pruned under capacity pressure; foreign
entries and another writer's pending files are preserved. The existing bridge owns
`bars/` and publishes one whole-session snapshot per symbol. Terminal performs no
Tiingo network request and has no Tiingo credential.

Snapshots retain their provider receipt even when the response is empty. The reader
checks the exact requested session, observation time, private ownership, 512 KiB and
480-minute limits, and receipt lineage. A newer snapshot replaces its entire session
window before one resampling pass; a newer empty snapshot revokes that window.
An older, unreadable or malformed snapshot preserves the completed archive. Missing
minutes are never fabricated and coverage remains `complete:false`.

Release through the existing protected `terminal-build.sh --target-sha` owner.
Verify the installed marker, selected archive, private directory ownership and an
actual authenticated chart read. Source/unit evidence does not prove live delivery;
that requires a real open-session capture, private receipt/snapshot, API and browser
readback. Remove only the LIVE_DIR configuration to disable new demand and snapshot
reads; retain original collector receipts and reconcile any active/unknown effects.
