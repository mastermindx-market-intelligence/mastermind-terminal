# Drawing snapshot and replacement fixture

Run the installed PostgreSQL 17 runtime in a private Unix socket with no TCP listener:

```sh
python3 tests/sql/audit04/run_native_fixture.py --out-dir /absolute/external/evidence --pg-bin /absolute/postgresql/bin
```

The fixture loads `supabase/migrations/0031_drawings_atomic_replace.sql` into its disposable database. It runs 33 direct input guards, 11 transaction/replay/rollback cases, 15 legacy bootstrap cases and four actual concurrent cases, then stops the owned server and checks cleanup. Logs and receipts stay outside repository source. UTF-8 is required by the ECMAScript whitespace contract. Production PostgreSQL version, authenticated HTTP behavior and migration application require separate receipts; a local fixture does not prove production delivery.
