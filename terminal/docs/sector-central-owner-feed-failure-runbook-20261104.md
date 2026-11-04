# Sector Central owner-feed failure runbook (2026-11-04)

Operation `terminal-sector-heatmap-label-legibility-20261103-c2` (run
`heatmap-1262-serving-path-fabric-20261104-01`). This is the read-only operator
path for the Discover → Sector Central → Company Heatmap tile population. It
contains **no privileged host action**: no SSH, no service restart, no deploy, no
credential change, no entitlement or paywall bypass.

## 1. What is served, and who serves it

`/api/sector-intelligence?source=<feed>` on the Terminal is a transport of owner
files that Macro publishes. The Terminal never composes them.

| feed | owner path |
|---|---|
| `sector` | `/sectordata/sector_central.json` |
| `confluence` | `/marketdata/subsector_confluence.json` |
| `themes` | `/neuralwebdata/theme_state.json` |
| `heatmap` | `/marketdata/sp500_heatmap.json` |
| `risk` | `/riskdata/risk_envelope.json` |

Macro serves those files behind two independent fail-closed checks (registration
wall, then entitlement wall) before any file is selected. A gated path that
answers `401` with `x-regwall: deny` therefore **proves the owner API answered**
— that is the cheapest available liveness probe, and it needs no credentials.

The heatmap path is special-cased in Macro's Caddy (`app/deploy/Caddyfile`,
`@vps_external`): it is served from the VPS live overlay
`/var/lib/macro-live/public/marketdata/` when that file exists, and otherwise
falls back to the committed `site.served` copy. Both are the same producer
output.

## 2. Read-only probes

All of these are public `GET`s. None of them changes state.

### 2.1 Is the owner origin reachable?

```bash
curl -sS -o /dev/null -D - https://www.mastermind-x.com/marketdata/sp500_heatmap.json
```

| answer | meaning |
|---|---|
| `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL`, `http_code` `000` | **the edge closed the TLS handshake.** No certificate was presented, so no request reached the origin at all. This is a CDN/edge-zone failure, not a feed failure — see §2.0. |
| `HTTP/2 401` + `x-regwall: deny` | owner API answered; the gate refused an anonymous request. **Healthy.** |
| `HTTP/2 502` + body `upstream connect error or disconnect/reset before headers` | the edge reached the origin, but the owner API did **not** answer; Caddy could not reach it. |
| `HTTP/2 503` + `x-regwall: deny` | the gate failed closed because a check service was unavailable. |

Run it for each feed path in the table above. All of them take the same owner
check, so a 401 on some paths and a 502 on others in the same minute means the
owner API is flapping, not that one feed is broken.

### 2.0 Live incident, 2026-11-04 09:41–09:44 UTC: the `www` edge zone fails TLS

Measured from outside the estate, read-only:

```
openssl s_client -connect www.mastermind-x.com:443 -servername www.mastermind-x.com
→ error:0A000126:SSL routines:ssl3_read_n:unexpected eof while reading
   (the peer closes during the handshake; no certificate is presented)

openssl s_client -connect beta.mastermind-x.com:443 -servername beta.mastermind-x.com
→ CONNECTION ESTABLISHED, TLSv1.3, CN = beta.mastermind-x.com, Verification: OK
```

`www.mastermind-x.com` and the apex fail on **both** edge IPs the zone resolves
to; `beta`, `app` and `admin` are healthy on the same network. Eight consecutive
probes over 90 s all returned `000`.

**Why this matters.** Every Sector Central feed is transported from the Terminal
by a server-side fetch to `https://www.mastermind-x.com/…`. If that host cannot
complete a TLS handshake, the fetch never reaches the origin, so **all ten feeds
fail together** and the Company Heatmap has no names to draw. That is the
2026-11-04 symptom. The Terminal route, Macro's producer, Macro's Caddy
`@vps_external` branch and the owner-envelope gate are all sound and were
verified individually; the failure is upstream of all of them, in the CDN zone.

**Check the zone, not the feeds.** `curl -sS -o /dev/null -w '%{http_code}\n'
https://www.mastermind-x.com/api/status` returning `000` while
`https://beta.mastermind-x.com/api/status` returns `404`/`401` means the zone,
not the data.

**Owner.** CDN/edge operator for the `www` and apex zones (certificate
provisioning or origin-pull TLS on the edge nodes serving those zones). The
Terminal gate and Macro's producer need no change for this symptom.

### 2.2 How fresh is the live plane?

```bash
curl -sS https://www.mastermind-x.com/api/status | jq '.checks | {overlay, orchestrator: .orchestrator.lanes}'
```

Read these two against the schedule, not against "now":

* `checks.overlay.age_min` — the live overlay artifact.
* `checks.orchestrator.lanes.bars.age_min` — the hourly-bars lane.

**Known schedules (source: `app/deploy/*.timer`, `scripts/vps_live_orchestrator.py`):**

| lane | window |
|---|---|
| `macro-live-bars` | `Mon..Fri 13..21:37 UTC` |
| `macro-live-fast` | continuous; the heatmap is rebuilt by this lane **only** on weekdays `13 <= hour <= 21` at `minute % 10 == 7` |
| `macro-live-snapshot` | every 5 min, all week |
| `macro-live-closepass` | `Mon..Fri 20..23:02/5:00 UTC` |

**=> Between 22:00 and 13:00 UTC the served heatmap overlay is, by design, the
last build of the previous session's window (roughly 11–12 h old). An
`overlay.age_min` near 700 and a `bars.age_min` near 700 outside those windows
is the schedule, not an outage. Do not chase it.**

### 2.3 Which failure class is it? (Terminal side)

With an authenticated operator session, capture the Terminal's own answer:

```bash
curl -sS -i -b "$SESSION_COOKIE" \
  'https://beta.mastermind-x.com/api/sector-intelligence?source=heatmap'
```

Before this change every owner failure answered `HTTP 503` with
`receipt.status = "error"` and no `Retry-After`, so a per-IP rate limit, an
owner 429, an owner 502 reset and an unreachable owner origin were
indistinguishable. The response now names the class:

| HTTP | `X-Sector-Failure` / `receipt.failure` | what it means | who acts |
|---|---|---|---|
| `429` | `rate_limited` | **this** Terminal's per-IP limiter (60 req/min per client IP). `Retry-After` is set. | the client; back off |
| `429` | `upstream_rate_limited` | the owner origin's own limiter. The origin's `Retry-After` is relayed verbatim; none is invented. | Macro operator |
| `502` | `upstream_reset` | the owner origin answered `502` — *its* upstream was reset or refused (Caddy's `upstream connect error or disconnect/reset before headers`). | Macro operator |
| `502` | `upstream_transport` | the Terminal could not reach the owner origin at all. | Macro/EdgeOne operator |
| `502` | `payload_invalid` | the body arrived but is not the owner envelope. | Macro producer |
| `503` | `upstream_unavailable` | the owner origin answered another non-ok status. | Macro operator |
| `504` | `upstream_timeout` | the 6 s owner fetch budget elapsed before the origin answered. | Terminal/Macro operator |
| `401`/`403` | `access_denied` | the local session/entitlement gate refused. | the account |
| `401`/`403` | `upstream_unauthorized` | the owner origin refused the forwarded session cookie. | Macro operator |
| `404` | `upstream_not_found` | the owner file is missing at the origin. | Macro operator |

`receipt.status` keeps its previous meaning and is **not** a transport class:
`ready` (owner payload admitted), `invalid` (payload rejected),
`access` (not authorized), `unavailable` (owner file absent), `error`
(transport). Read `X-Sector-Failure` for the cause.

## 3. Falsifiers

| observation | conclusion |
|---|---|
| `000` / `SSL_ERROR_SYSCALL` on `www` and the apex, while `beta`/`app`/`admin` are healthy | the `www` CDN zone is failing TLS. **All ten feeds fail together** because every one of them is fetched from that host. This is the 2026-11-04 symptom. |
| `401` + `x-regwall: deny` on every gated path | owner API is alive; a 502 seen earlier was a transient owner-API outage or restart, not a feed defect |
| `502` on some paths and `401` on others in the same minute | owner API flapping; the per-path difference is timing, not path |
| Terminal `429` + `rate_limited` | this Terminal's per-IP limiter. Note the Sector Central page requests **10 feeds per load**; repeated loads exhaust a 60/min budget. |
| Terminal `502` + `upstream_reset` | the owner origin lost *its* upstream. Correlate Macro's Caddy log for `/marketdata/sp500_heatmap.json`. |
| Terminal `504` + `upstream_timeout` | the origin did not answer inside 6 s. Check §2.1 latency from the same network before blaming the origin. |
| Terminal `502` + `payload_invalid` | the body arrived and was rejected. Check the payload's `size_basis` and `n_tiles` — see §4. |

## 4. Adjacent source finding, not fixed here

Macro's US heatmap producer overwrites the sizing basis that
`engine/market_heatmap.py:_float_sizes` computed authoritatively:

```python
# scripts/build_sp500_heatmap.py
payload["size_basis"] = "marketcap" if caps else "weight_proxy"
```

`_float_sizes` returns `marketcap` / `weight_proxy` / `equal`; the overwrite can
label an `equal` payload as `weight_proxy`, and it drops the `marketcap` basis
whenever the cap sources are empty. The Terminal's owner-envelope check requires
`size_basis === "marketcap"`, so a degraded build is rejected as
`payload_invalid`. Separately, `_load_caps_from_prev_payload` only recycles caps
from a previous payload whose own basis is `marketcap`, so one degraded build
removes the recovery path for the next one.

This is a real latent contract break, but it is **not** the cause of the
2026-11-04 outage (that failure was a transport class, not `payload_invalid`),
and changing published sizing semantics is a Macro-lane decision that needs live
verification of the nightly producer. It is recorded here for that lane.

## 5. Remaining gate for the tile-legibility acceptance

The 79-name tile population cannot be accepted until an authenticated browser
shows real names on Discover → Sector Central → Company Heatmap, inspected in
dark and light at 1440×900, 820×1180 and 390×844, including selection and the
company inspector. That acceptance needs a signed-in operator session, which no
automated run holds. The merged label CSS is not in question: the fix is
`c8ee19c8c8182770af9529bc3be7cd36a7fd446d` and beta already serves it.

Until the owner path returns qualified data, the acceptance is **NOT_ACCEPTED**.
Do not substitute a stale or fixture payload to make the panel look populated.

**As of 2026-11-04 09:41–09:44 UTC the blocking condition is the `www` edge zone
failing TLS (§2.0), not any source defect.** Restoring that zone is the
precondition for the acceptance, and it is owned by the CDN/edge operator.
