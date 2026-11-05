# Existing Fabric reservation failure

The original request tiingo-8698-final-integrity-review-20261011-01 failed with LOG_RESERVATION_FAILED, errno 1, before lease and before launch. Read-only status at 2026-10-11 19:31 UTC returned NOT_FOUND, result_available=false, UNVERIFIED, EXECUTION_NOT_ELIGIBLE. No original run log exists.

The original state/remote_sub directory exists, is mode 0755, and has the same UID 501 as the current process. Inspection found no immutable flag or listed ACL entry. os.access reported it not writable under this task's filesystem grants. The identical O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW reservation succeeded with mode 0600 in the already writable evidence directory; workspace-exclusive-reservation-check.json records that diagnostic. It is not a Fabric request, lease or worker launch.

remote_sub.sh supports REMOTE_SUB_LOG_DIR, but the installed adapter's _paths function hardcodes HERE/state/remote_sub/<id>.log and HERE/lanes/<id>.remote.stdout. Status, result and acceptance use those paths; request stdin packets also use the original state directory. Changing only the log environment variable would break the retained result and acceptance contract. No adapter path, lease directory, original reservation fence or filesystem grant was changed.

After the user's explicit authorization to use an already permitted independent-review carrier, the parent commissioned one bounded native reasoning/coordinator review of Terminal PR 945. It owned no files and performed no provider/network/SSH/effect work. The result is terminal-independent-review-return.txt. The original Fabric operation remains untouched and is not represented as successfully launched or accepted.
