# Retry-safe watchlist import

This addition lets a research script add one ticker to an existing personal watchlist, using the same watchlist the Terminal reads. It does not create a new watchlist store, edit teams or place trades.

Existing API keys stay read-only. A newly minted key can explicitly opt into `watchlists:write`. `POST /api/v1/watchlists/{id}/symbols` accepts a single symbol and optional section. The owner UUID comes from the authenticated key, never the request body. Shared lists remain read-only.

`Idempotency-Key` binds the API key, target list and normalized request. A repeated request returns the saved result without repeating the insert. Reusing the key for a different request returns409. The database commits the insert and replay receipt together. Revocation and current ownership are checked before a replay.

The command-line importer retains the same key through bounded retries, honors `Retry-After`, and never follows redirects with the credential. Concurrent duplicates, timeout after commit, changed-payload conflict, read-only/revoked keys, and foreign-list access are required checks.

Delivery remains draft until implementation, PostgreSQL/HTTP proof, one focused access-control/idempotency review, UI evidence and required CI pass. Source merge, migration application, release and actual live verification are separate steps.
