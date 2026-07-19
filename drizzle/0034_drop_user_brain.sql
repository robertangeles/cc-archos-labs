-- safety: verified against origin/main on 2026-07-19 by pr-reviewer
-- Drop the legacy GBrain per-user OAuth table.
--
-- The external GBrain service is decommissioned; per-user chat memory now lives
-- in `user_memory` (in-app pgvector, migrations 0032/0033). `user_brain` only
-- ever held GBrain OAuth client credentials and has been unreferenced by any
-- code path since the MEMORY_BACKEND=pgvector cutover. Safe + idempotent:
-- nothing reads or writes this table after the GBrain code removal.
DROP TABLE IF EXISTS "user_brain";
