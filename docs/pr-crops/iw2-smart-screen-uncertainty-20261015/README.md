# Smart Screen uncertain-save state

When a write may have landed but its answer cannot be verified, the last account copy is now labelled unconfirmed. The original request survives. Refresh reads without resending or settling it; explicit Retry retains its original screen id, expected revision and body. Forgetting a local request does not undo an account change. Invalid read-only revisions cannot replace a readable screen; record schema 1 with a newer grammar remains supported as read-only.

Validation: nine discriminating failures on parent 48b8aa564, then 37 client + 40 predicate + 20 route checks pass. Typecheck passes; focused lint has zero errors and one inherited unused-disable warning in record.ts. The final browser journey passes at 1440×900 desktop (English), 820×1180 tablet (Chinese), and 390×844 mobile (English), one worker and no retries. Each uses the actual isolated Smart Screen API, changes only the write response, and exercises create, review update and delete. Six explicit writes per device; refresh/reload send zero writes and leave the original request pending until explicit Retry.

| Viewport | Uncertain reply | Recovered original |
|---|---|---|
| Desktop | [image](desktop-uncertain-account.png) | [image](desktop-recovered-original.png) |
| Tablet | [image](tablet-uncertain-account.png) | [image](tablet-recovered-original.png) |
| Mobile | [image](mobile-uncertain-account.png) | [image](mobile-recovered-original.png) |

All six images inspected. These are local fixture routes, not production account or live-access acceptance. Existing release holds remain. Existing healthy-state matrices are reused; no unrelated recapture or broad test replay.
