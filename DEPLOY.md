# Deploying the Mastermind Terminal — READ THIS FIRST

**The live site (`app.mastermind-x.com`) is GIT-GATED. `origin/master` is the single source of truth.**

As of 2026-07-09 the VPS build script (`/opt/terminal/terminal-build.sh`) builds **only `origin/master`**.
Editing files under `/opt/terminal/terminal` directly (scp/rsync of a working tree) **does nothing** —
the build ignores the working tree and overwrites it with `master` on every deploy. This exists because
sessions were rsync'ing working trees straight to the box and silently overwriting each other's live work.

## To ship a change — the ONLY supported flow

1. **Branch + commit** your change (work in a git checkout, not on the box).
2. **Open a PR** to `master` on `github.com/mastermindx-market-intelligence/mastermind-terminal`.
3. **Merge to `master`** (get it reviewed / conflicts resolved against everyone else's merged work).
4. **Deploy** — run the build on the VPS (it fetches + builds `origin/master`, zero-downtime, auto-rollback):

   ```sh
   ssh root@146.190.142.17 'bash /opt/terminal/terminal-build.sh'
   ```

That's it. Because everyone deploys the same committed `master`, nobody's work can be reverted by
another session's deploy.

## Canonical source preflight — W2A status

`ops/terminal_release_preflight.py` plus
`ops/terminal_source_audit.production.json` now define the reviewed read-only
entrance gate for the GitHub-canonical deployment program (#483). The preflight
requires the live marker, clean canonical checkout, accepted ref, all application
and runtime-code projections, and both installed wrappers to agree on one SHA. It
publishes an immutable receipt and mutates no source, service, build, or data.

**The incumbent `terminal-build.sh` does not call this gate yet.** W2A must first
merge and produce a `CLEAN` production receipt. W2B then owns binding the gate to
exact-target build/deploy/rollback behavior. Until that integration lands, do not
claim that running the build command below has produced a W2A preflight receipt.
See [`ops/TERMINAL_RELEASE_PREFLIGHT.md`](ops/TERMINAL_RELEASE_PREFLIGHT.md).

## What the build script does (`terminal-build.sh`)

`git fetch && reset --hard origin/master` in `/opt/terminal/.gitsrc` (a read-only-deploy-key checkout)
→ stage master's `terminal/` + overlay the box's gitignored runtime (`node_modules`, `.env*`, `public/data`)
→ `next build` in the stage → verify `BUILD_ID` → **atomic-swap `.next`** (live site stays up throughout;
auto-rolls-back if health fails) → **runtime-code sync** (cron/systemd scripts, below) → sync
`/opt/terminal/terminal` source back to `master`.

The script's authoring source is **`ops/terminal-build.sh` in this repo** — every deploy re-installs it
to `/opt/terminal/terminal-build.sh` (a change to it takes effect on the *next* deploy). Never edit the
box copy in place.

## What a deploy ships — exact paths

One `terminal-build.sh` run deploys **all** of the following from the same `origin/master` SHA.
If the deploy fails (build error or health check), **nothing** moves — app and runtime code both
stay on the previous state.

| repo path | deployed to | how |
|---|---|---|
| `terminal/` | `/opt/terminal/terminal` + live `.next` | staged `next build` → atomic `.next` swap |
| `ingest/` | `/opt/terminal/ingest` | overlay (nightly `terminal-data`, 5-min `fast_flagship`, `alerts_engine` crons) |
| `signal_layer/` | `/opt/terminal/signal_layer` | overlay (GC-v2 engine imported by `fast_flagship` — reconciled 2026-07-10) |
| `scripts/` | `/opt/terminal/scripts` | overlay (`build_data_coverage` cron) |
| `config/`, `contracts/` | `/opt/terminal/{config,contracts}` | overlay |
| `hub/` | `/opt/terminal/hub` | overlay + `npm ci` if lockfile changed + `systemctl restart quote-hub` **only if changed** |
| `ops/terminal-data` | `/usr/local/bin/terminal-data` | install (the nightly-cron wrapper) |
| `ops/terminal-build.sh` | `/opt/terminal/terminal-build.sh` | install — takes effect on the **next** deploy |
| `ingest/suite_alerts.ts` | `/opt/terminal/ingest/dist/suite_alerts.mjs` | esbuild bundle (step 9) — 5-min cron, reads `public/data`, fires `suite_event` alerts |

**Overlay = `git archive origin/master <dirs> \| tar -x`: tracked files are overwritten; box-only
untracked files are preserved.** As of 2026-07-10 every cron-run script in `ingest/` and the whole
`signal_layer/` (incl. the GC-v2 `confluence_v2.py`) are committed — **origin/master is the source
of truth for all deployed code**. Known host-owned exceptions are narrow runtime caches, generated
bundles/dependencies, and exact observed backup files; the production source-audit policy classifies
them explicitly and blocks any new unexplained path. `ingest/hk_universe_cache.json` is one temporary
special case: its producer and rsync path own the live bytes, but a historical Git snapshot remains, so
the policy pins that exact blob until W2B removes the snapshot without touching the live cache.
`terminal/public/data` is a separate
host-owned runtime-data class: Git contains reviewed fixtures/snapshots under the same path, while the
live tree is continuously refreshed. The policy pins the exact Git tree shape, validates live metadata,
and never treats mutable data content as implementation source. None of these exceptions permits an
`rsync --delete` over host-owned runtime state.

### Suite-event alerts cron (`ingest/suite_alerts.ts` → `ingest/dist/suite_alerts.mjs`)

The Node sidecar that fires `{type:"suite_event"}` alerts by running the REAL premium-suite
modules (`terminal/lib/suites`) over daily bars — zero algorithm duplication with the chart.
Because it imports `terminal/lib`, the cron consumes an **esbuild bundle** that step 9 of
`terminal-build.sh` rebuilds on every deploy into `/opt/terminal/ingest/dist/suite_alerts.mjs`
(the `dist/` output is untracked, so the step-7 overlay preserves it; a bundle failure is
non-fatal — the cron keeps the previous bundle). Evaluation basis is honest-by-design: module
defaults only (user chart params are client-side), daily bars only, one-shot disarm semantics
identical to `alerts_engine.py`.

**Box-side, install once** (not managed by the deploy — same as the other cron lines).
Offset +4 min so each run follows the 5-min data/flagship refresh:

```cron
4-59/5 * * * * cd /opt/terminal && /usr/bin/node ingest/dist/suite_alerts.mjs >> /var/log/suite-alerts.log 2>&1
```

### Outbound signed webhooks cron (`ingest/webhook_delivery.ts` → `ingest/dist/webhook_delivery.mjs`)

The Node worker that claims due `webhook_deliveries` rows, HMAC-signs the payload, and POSTs with redirects disabled and the TCP connection pinned to a pre-validated public IP. It imports `terminal/lib/webhookSigning.ts` (and the retry/URL helpers), so it must be bundled before the cron can run. **Box-side, install once** (not managed by the deploy — same as the other cron lines). Bundle, then the every-minute cadence required by the 1-minute first retry step:

```
cd /opt/terminal/terminal && npx esbuild ../ingest/webhook_delivery.ts --bundle --platform=node --format=esm --outfile=../ingest/dist/webhook_delivery.mjs --alias:@=.
```

```cron
* * * * * cd /opt/terminal && /usr/bin/node ingest/dist/webhook_delivery.mjs >> /var/log/webhook-delivery.log 2>&1
```

#### How a receiver verifies a delivery

Every request carries these headers:

```
Mastermind-Webhook-Id:          <delivery id, a uuid>
Mastermind-Webhook-Timestamp:   <unix seconds, integer>
Mastermind-Webhook-Signature:   v1=<hex>
Mastermind-Webhook-Key-Version: <integer secret version>
Mastermind-Webhook-Event-Id:    <event id>
Mastermind-Webhook-Event-Type:  <event type>
```

`<hex>` is `HMAC-SHA256(secret, "<timestamp>.<raw request body>")`, lower-case
hex, over the **exact bytes received** — parse the JSON only after verifying,
never re-serialize first. `secret` is the value returned once when the endpoint
was created or when its signing secret was rotated (Settings → Webhooks); it is
shown once and cannot be shown again, so a lost secret means rotating or
registering a new endpoint.

After a rotation the previous secret keeps working for 24 hours. A second
rotation is refused with `rotation_grace_active` / HTTP 409 until that grace
expires; refusal leaves both keys, their version and expiry unchanged. During
that window every delivery also carries:

```
Mastermind-Webhook-Signature-Previous: v1=<hex of the previous secret>
```

The current `Mastermind-Webhook-Signature` stays `v1=<hex>` so existing
receivers keep verifying against the current secret. Switch the receiver to
the new secret during those 24 hours; after the window the previous header is
omitted.

The HMAC authenticates the timestamp and raw body only. Event-id, event-type,
key-version and delivery-id headers are metadata, not independently signed
identity. For `alert.fired`, use the authenticated body's `fire_event_id`,
reject a supplied `Mastermind-Webhook-Event-Id` that disagrees with it, and
require the body's `team_id` to match the receiver's configured team. The
deduplication scope is the configured endpoint and team plus that signed fire
identity. Configure this scope alongside the receiver's secret; never obtain
it from untrusted request headers. `Mastermind-Webhook-Id` stays the delivery
id across retries, but its unsigned value must not decide whether to repeat a
business action.

An `alert.fired` body uses schema tag `mastermind.alert-fired/v1` and these
fields: `fire_event_id`, `alert_id`, `user_id`, `team_id`, `fired_at`,
`ticker`, `subject`, `subject_zh`, `summary_plain`, `summary_plain_zh`,
`condition_plain`, `condition_plain_zh`, `value`, `evidence_url`.

A personal alert fire is posted to a team endpoint only when that endpoint is
on, it is subscribed to alert fires, the firing user is a current member of
the team, and that user has turned on sending their own alert fires to the
team's webhooks.

A receiver must:

1. Read the raw body as bytes, before any JSON parsing.
2. Recompute the HMAC and compare it to the header with a **timing-safe**
   comparison (`crypto.timingSafeEqual`, `hmac.compare_digest`) — never `==`.
   During the 24-hour rotation window, accept a match on either the current
   signature or the previous signature.
3. **Reject if `|now − timestamp| > 300` seconds.** That 300-second replay
   window is what stops a captured request from being replayed later; the
   signature alone never expires.
4. Only after HMAC/freshness verification, parse the body. For schema
   `mastermind.alert-fired/v1`, bind identity and team as described above.
   Atomically dedupe acceptance/business effects by configured endpoint, team
   and signed `fire_event_id`; retain that event dedupe across delivery retries.
   Changing unsigned headers cannot create a new event identity.
5. A `mastermind.webhook-test/v1` body has no signed event identity. Treat it
   as a connectivity test, not an exactly-once business event. Cache an
   authenticated request fingerprint `SHA256(timestamp + "." + rawBody)` in
   the configured endpoint/team scope, atomically through at least
   `(timestamp + 300)` seconds since the epoch. Replaying the identical signed
   request with changed headers gets the same cache key. A freshly signed retry
   at a different timestamp can have a different key; no exactly-once guarantee
   is claimed for test events. Never use the unsigned event-id header instead.
6. Answer `2xx` to accept. Any other status, or no answer within 10 seconds,
   is retried at 1 min, 5 min, 30 min and 4 h; after the fifth attempt the
   delivery stops for good.

The executable reference verifier is `terminal/lib/webhookReceiver.ts`, with
actual-helper contract tests in `terminal/lib/__tests__/webhookReceiver.test.ts`.
`verifyWebhookRequest` receives the exact UTF-8 raw body, timestamp, current/
previous signature headers, optional event-id header, trusted receiver secrets,
configured `endpointId`/`teamId`, and `nowMs`. It uses a timing-safe HMAC check
before parsing, returns a scoped `dedupeKey`, and returns `replayUntilMs=null`
for durable alert-event dedupe or a freshness-expiry timestamp for test replay
caching. The helper does not store acceptance or execute business effects; the
receiver must implement that atomic boundary itself. The event-type and
key-version headers never override authenticated body schema or configured keys.

Redirects are never followed, and the outbound connection is pinned to a
pre-validated public address, so a receiver must answer on the address it
registered.

### Apply migration 0026 before the worker or panel expect the new columns

The settings › Webhooks panel (`SAFE_ENDPOINT_COLUMNS` in `terminal/lib/webhooks.ts`) and the every-minute `webhook_delivery` worker (`ingest/webhook_delivery.ts` endpoint select) reference 0026's columns (`secret_version`, `secret_rotated_at`, `secret_previous_expires_at`). Until the seat applies 0026, PostgREST returns a missing-column error for those selects, and `isAbsentTableError` (`terminal/lib/teams.ts`) does not classify that shape as absence — the live Webhooks panel 503s and the worker exits 1. Apply 0026 in ledger order (after `0017`–`0023`) before relying on either surface; the seat applies it after the PR merges.

### Deliberately NOT deployed

- `api/`, `docs/`, `indicator_engine/`, `tests/`, `web/`, `supabase/`, `requirements.txt` — not
  consumed on the box.
- `terminal/public/data/` — the live host-owned market/intel tree is preserved rather than synchronized by the deploy; the bounded tracked fixtures/snapshots beneath this path are policy-pinned evidence, not deployment inputs.

## Notes

- The live `terminal/public/data` tree is host-owned market/intel runtime data, refreshed by cron and
  preserved across deploys. Git also contains a bounded set of reviewed fixtures/snapshots beneath that
  path. Do not infer that live bytes are canonical Git source, and do not add/remove tracked files there
  without updating and reviewing the pinned `canonical_git_tree` in the production source-audit policy.
- Secrets live in `/opt/terminal/.env` / `terminal/.env.local` on the box (gitignored) — preserved across deploys.
- `next.config.ts` sets `typescript.ignoreBuildErrors` + `eslint.ignoreDuringBuilds`, so the build won't
  catch type errors — run `tsc --noEmit` yourself before merging.
- **Rollback restores the identity and the build together.** `.deployment-id` and the `.next` it names are
  one deploy generation. Before the new marker is installed the previous one is snapshotted to
  `.deployment-id.bak` (`cp -p`, exact bytes and metadata) — or `.deployment-id.absent` records that there
  was none. **Every** failure after that point restores `.next.bak` **and** the marker as a pair: a failed
  `.next` swap, a failed `systemctl restart`, or a failed health/identity check. They all route through one
  guarded exit, so none of them can abort the script past rollback — the script runs under `set -e`, and a
  bare failing command used to terminate the deploy with the marker already advanced. The failed build is
  kept at `.next.broken` for diagnosis.
  Two cases do **not** produce a clean rollback, and the script says so instead of pretending otherwise:
  if the marker record is gone, or if the swap already happened and there is **no** `.next.bak` to return
  to (a bootstrap deploy, or a previous run that died between the marker install and the swap). Both exit
  non-zero and report the identity `UNRESOLVED`. In the second case the build that just failed its health
  check is still live — treat the box as serving nothing provable until reconciled by hand.
  Whenever the live `.next` was moved the service is restarted, **including** on the unresolved path:
  `next start` resolves `.next/*` at request time, so a server left bound to a renamed directory serves
  one build's chunks against another build's manifests.
- **To force a rollback by hand:** stop `terminal`, `mv .next .next.broken && mv .next.bak .next`, then set
  `.deployment-id` to the SHA that build was deployed from and restart. Note the rollback snapshot is
  **not** available for this — `.deployment-id.bak` is purged on every successful deploy — so recover the
  previous SHA from `git -C /opt/terminal/.gitsrc rev-parse HEAD~1` or the prior deploy's log line.
  Swapping `.next.bak` back while leaving `.deployment-id` on the new commit is exactly the incoherent
  state this machinery exists to prevent.
- **Verifying a deploy names three identities:** the intended `origin/master` SHA, the live
  `/opt/terminal/terminal/.deployment-id`, and the live `/opt/terminal/terminal/.next/BUILD_ID`. The
  deploy fails closed unless all three agree.
  **`BUILD_ID` is not a per-deploy witness here** — Next 16.2.9 returns the constant literal
  `build-TfctsWXpff2fKS` whenever `deploymentId` is set, which `next.config.ts` always does, so it reads
  the same before and after every deploy and every rollback. It proves the live `.next` is present and
  complete, nothing more. The discriminating identity is the marker, and it is only trustworthy because
  rollback now restores it. For live proof from outside the box, read `?dpl=<full sha>` on
  `/_next/static/*` or `data-dpl-id` on `<html>` — never `BUILD_ID`.

## Shared Shell production promotion

The production profile stays off by default. After exact beta journey acceptance
and normal protected source/CI qualification, the attended host configuration lane
may install the landed `ops/terminal-shared-shell.conf` at
`/etc/systemd/system/terminal.service.d/shared-shell.conf` (root-owned, non-writable
by group/others) and daemon-reload. It declares only `MMX_SHARED_SHELL_BUILD=1`;
it does not enable an already running or restored older app. Never install a
runtime `MMX_SHARED_SHELL=1` override on production. Preserve all other unit drop-ins.

Before building, the incumbent release owner checks the installed bytes against
the exact admitted target commit and the effective unit BUILD flag, then derives
the build flag. Missing activation keeps production off; any partial or modified
activation refuses. Existing nonfeature service credential files remain supported;
manager, passed/unset variables, unit environment files, Next dotenv files and the
known npm/Next start path are checked without logging secret values. Next pins the feature flag into the resulting build. The
owner rechecks activation before restart and verifies the admitted protocol,
bridge, document, registry and source tuple before accepting an enabled generation.

Promotion still uses the single normal transaction:
`/opt/terminal/terminal-build.sh --target production --target-sha <qualified-40-hex>`.
Its installed owner must first contain this reviewed activation support through
the existing attended canonical-source installation path; the incumbent old owner
unsets production's flag and self-updates only for a subsequent run. Do not treat
a source merge or a drop-in alone as activation. Publish the app-origin bridge and
Caddy framing/redirect exceptions through the normal Macro owner before promotion,
preserving beta and foreign/no-opt-in/internal negatives. Final proof uses the real
`app.mastermind-x.com` account, shared-shell status, document READY/navigation and
private/no-store boundary. Beta proof alone is not default-production launch.

### Frozen-node delivery host composition (source only, disabled by default)

`OPTIONS_FROZEN_DELIVERY_ENABLED` is a separate explicit host capability. Absent,
empty or `0` keeps frozen-node email/webhook delivery closed; malformed configured
values fail instead of falling back. No deployment or channel activation is part
of this source change. The email drain still separately requires its incumbent
`ALERT_DRAIN_ENABLE`; existing non-node delivery defaults remain unchanged.

The existing Macro drain and Terminal webhook worker use the same private
`ingest/options_frozen_delivery_cli.py` entry, configured by absolute host-owned
`OPTIONS_FROZEN_DELIVERY_PYTHON`, `OPTIONS_FROZEN_DELIVERY_SCRIPT`, and
`OPTIONS_FROZEN_DELIVERY_ENV_FILE`. No path, credential, origin, permission or
command is accepted from a row. The private file contains the same Supabase
origin/service-role reference and the already-established `OPTIONS_FROZEN_*`
Macro account/Python/Node/source-bundle paths. The CLI uses those existing
account-policy and protected reconciliation interfaces; it does not activate
source evaluation. A different DB origin refuses before account use. Requests
travel over bounded local stdin/stdout, never secret-bearing argv or a new HTTP
endpoint. No import performs IO. Installation and actual host credential/role
admission remain separately required; source tests do not establish them.

Email reselects the exact canonical row/event/principal/full payload and proves
committed publication after disarm. It rechecks current account/category through
the private policy CLI. The existing drain continues to own current recipient,
entitlement, suppression, quiet hours and the mailer's unique ledger/SMTP unknown
boundary. Row JSON grant fields and a formerly armed runtime are not delivery
permission. Unknown evidence withholds rather than receiving delivery credit.

Webhook delivery independently reselects the canonical delivery, current endpoint,
team membership, channel opt-in and event filter, then checks the complete SQL
projection against the committed canonical event. The signing secret is read
only by the incumbent privileged webhook worker, never returned by the private
policy CLI. Exact status/attempt/claim CAS and returned snapshot equality precede
signing; policy is checked again after DNS. Existing URL validation, public-IP
pinning and HMAC functions own transport. A selected `delivering` frozen row is
never reclaimed merely because its lease is old. An unreturned claim or uncertain
POST remains held for explicit reconciliation, not an automatic new POST or a
claim of downstream exactly-once delivery. Legacy webhook retry behavior is
unchanged. Current policy is observed before send; no cross-service transaction
locks account revocation throughout an external delivery.

The fixture and paired tests are explicitly synthetic: private PostgreSQL,
actual private subprocesses/native account policy, blocked source fetch and an
injected no-network SMTP/POST boundary. No live DB, email, webhook, provider,
service installation or enrollment is performed by them.
