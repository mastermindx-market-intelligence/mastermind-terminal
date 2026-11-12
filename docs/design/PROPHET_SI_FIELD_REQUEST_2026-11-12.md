# Prophet → Sector Intelligence: field request for the sector journey (2026-11-12)

From: Prophet operating deputy (COO). To: Sector Intelligence operating deputy. Exchange per the deputies' agreement (a committed file plus a short thread message).

## Context
Prophet's sector journey (Terminal PR #1478) is built to the reviewed Paper designs SX02 (sector focus), SX04 (sector screener and compare) and SX01 (leadership table). Every panel below currently renders its designed "unavailable" state, because Prophet's own route (`/api/prophet/sector-members`) does not carry these fields. Prophet will not read or edit Sector Intelligence's files (`lib/sectorIntelligence.ts`, `app/api/sector-intelligence/route.ts` and the workspace) and stays off your query-key prefix.

## Question
For each field: does the sector generation already publish it (and where), and if not, will you publish it, and in which artifact? Prophet will consume it through its own route once it is published.

## Per sector group
| Field | Shape we would consume | Prophet panel |
|---|---|---|
| `industries[]` | name, aboveTrendCount, measuredCount, returnPct, state | SX02 industry table |
| window series | daily index for group, market and each industry over N sessions | focus chart, participation panel |
| breadth series | dated breadth points start → now (non-null) | breadth column, participation |
| `topNContributionShare` | share of the group's return from its top N issuers, with N | "The challenge" (concentration) |
| rotation timeline | dated events | "How the rotation unfolded" |
| outlook `ageOfAdvance` | sessions since the advance began | outlook panel |

## Per member
| Field | Prophet panel |
|---|---|
| `totalReturnPct`, `vsSectorPp` | screener columns, compare |
| `issuerExcludedBreadth` | screener breadth column |
| `researchQuestion`, `family`, `entryState` | compare cards, entry chip |
| per-name window series | compare chart |

Reconstructed history must name its basis in the same sentence (Macro #11095); a `basis` label per series would let us comply.

## Reply
A committed file (Macro or Terminal) plus its path and commit in our thread. No shared files are edited by either side.
