# Official DBN codec fixtures

Unmodified assets from Databento's Apache-2.0 DBN repository, pinned to
`d368005a636bae84bff443cd6ddae6430a0ffd00`. Original license is retained in
`LICENSE`; upstream root contained no NOTICE file at that revision. Exact byte
sizes and SHA-256 digests are in `SOURCE.json`.

Source: https://github.com/databento/dbn/tree/d368005a636bae84bff443cd6ddae6430a0ffd00/tests/data

The two MBO assets (465 and 472 bytes) decode to the SAME two ESH1 ask
cancellations on 2020-12-28. They have NO initial snapshot and NO executions.
Passing the source canary therefore MUST leave depth unavailable with
`snapshot_required`; these are decoder conformance inputs, not a usable market
session. The status fixture supplies two venue state records. The MSFT/XNAS
definition fixture is deliberately a negative case for the CME-only decoder.

Apache licensing of these repository examples is not CME commercial display,
redistribution, retention or full-depth sample entitlement. Generated native
SDK DBN records in the tests are separately SYNTHETIC and never reported as
vendor market observations. No files here are served to Terminal users.
