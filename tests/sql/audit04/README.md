# Drawing snapshot and replacement fixture

Run the installed PostgreSQL 17 runtime in a private Unix socket with no TCP listener:

```sh
python3 tests/sql/audit04/run_native_fixture.py --out-dir /absolute/external/evidence --pg-bin /absolute/postgresql/bin
```

The fixture loads `supabase/migrations/0031_drawings_atomic_replace.sql` into its disposable database. It runs 33 direct input guards, 11 transaction/replay/rollback cases, 15 legacy bootstrap cases and four actual concurrent cases, then stops the owned server and checks cleanup. Logs and receipts stay outside repository source. UTF-8 is required by the ECMAScript whitespace contract. Production PostgreSQL version, authenticated HTTP behavior and migration application require separate receipts; a local fixture does not prove production delivery.

Two prerequisite cases revoke UPDATE or disable RLS in the disposable table, require the migration to fail before publishing any RPC, then restore only that owned fixture. Production catalog qualification must separately prove the existing authenticated UPDATE grant needed for the table-write fence and enabled RLS. The migration adds neither a table grant nor an RLS bypass.

Operation replay is bounded to the last 32 retained receipts. An HTTP retry keeps its original expected revision; a direct RPC caller supplying a new current revision after receipt eviction is outside that retry guarantee. HTTP JSON parsing/stringifying also canonicalizes ordinary JavaScript number representations before payload hashing; direct SQL JSON numeric scales are not claimed interchangeable replay inputs.
