# Explicit brief-language availability — consumer-first delivery

## Source contract

Source under browser capture: **`e2ddccbfe0a1904cec60ba31ccb29d58f45dc1d7`**.
Protected base: `24fd0ce6ff640fab13cb41c4aa0046e39d03c638`.

A partially translated market read must retain usable English, the target, monitors and source clocks. Chinese language availability is independent of the existing `ready` / `degraded` delivery state. No translation model, confidence field, database migration or producer write is introduced.

| Chinese value | Translation status | Admission |
| --- | --- | --- |
| Nonempty string | Absent | Preserve the valid historical row |
| Nonempty string | `available` | Preserve the explicit row and status |
| `null` | `unavailable` | Preserve the explicit unknown language value |
| Missing, empty, unknown status, or contradictory pair | Any | Reject the body under the existing guard |

The recursive forbidden-field guard remains authoritative. Availability means a Chinese source sentence exists, not that it has passed an independent language-quality evaluation.

Chinese presentation uses actual Chinese when present. Otherwise it labels the English original. The language notice counts the entire `market_read`, including rows beyond the first two preview passages. An exact historical English-plus-`（翻译待补）` value is adapted for display without changing stored bytes or guessing a cause/retry time.

## Existing API and client ownership

The capability is local to the existing route:

`/api/briefs/deliveries?limit=40&contract=briefs.explicit-language.v1`

- Legacy request and representable body: existing 200 response.
- Explicit supported request: 200 acknowledgement and preserved legacy/new valid body.
- Legacy request selecting a valid nullable body: typed 409 `UPGRADE_REQUIRED`, before body normalization; no empty-body substitution, delivery omission or fabricated Chinese.
- Unsupported token: explicit 400. Authentication and user ownership filtering remain in force.
- Malformed or forbidden content remains invalid; it is not misreported as an upgrade requirement.
- The new inbox accepts valid unacknowledged legacy responses during deployment overlap. It requires explicit acknowledgement for nullable publication and rejects unknown contracts.
- A typed upgrade response displays localized **Refresh Terminal** and performs an ordinary page reload. Existing delivery miss and last-good pinning semantics are unchanged.

## Verification

- **53/53 focused tests**: body 23, API route 18, inbox 12; TypeScript and diff checks passed.
- Cross-version cases preserve a nullable watch item beyond the two displayed sentences, exact target/monitor/source-clock fields and ready state. Another user's nullable body is filtered before compatibility decisions.
- **21/21 actual Alerts inbox browser tests** on desktop, tablet and mobile, one worker, zero retries. Nine existing empty/legacy/responsive cases plus twelve EN/ZH language and real page-reload cases; 38.7 seconds including process overhead.
- Twelve PNG/JSON receipt pairs bind the source SHA, six source-file SHA-256 values, locale, viewport, scenario and image hash. All receipts were checked against unchanged captured source.
- Root visually inspected mobile ZH partial-language and desktop EN upgrade crops. The partial notice wraps within the inbox and the original English remains readable.

These browser responses are controlled fixtures at the real `/alerts` mount in AlertsCockpit. API ownership/normalization is tested separately through the existing mocked database boundary. This is not proof of production database contents, live serving instances or a deployed client bundle.

## Producer activation and rollback gates

This source-only phase **does not activate nullable producer output**. Macro's existing master-brief/recurring-brief owners remain responsible for publication, including the native CI failure exposed while releasing Macro #9423.

Before publication of nullable bodies:

1. Record exact deployed BFF and client receipts. The serving route must acknowledge the capability and the serving inbox must render mixed-language content.
2. Verify all serving API instances implement the compatibility guard; a merged PR/build SHA alone is insufficient.
3. Preserve the cross-version acceptance matrix, including a nullable passage outside the preview.
4. Prove the relevant old clients have refreshed, or explicitly accept their temporary inbox unavailability. Old bundles only display their generic unavailable/Retry state; the new response cannot make that old code explain an upgrade. The existing Next deployment ID does not prove refresh.
5. Once nullable rows exist, retain this decoder and API guard even if new producer emissions are rolled back. Stopping new writes does not make existing rows readable by an old server.

`productionAcceptance=false`; `producerActivation=false`.
The GMI program remains open: this resolves a real downstream compatibility prerequisite and does not qualify business activities, relationships, global universe coverage or allocation decisions.
