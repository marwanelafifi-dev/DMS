-- =============================================================================
-- Phase 0 placeholder — WORM enforcement roles & audit ledger constraints.
-- Runs automatically on first Postgres container start (empty data volume only).
--
-- Phase 1 will expand this into the full compliance schema. For now it:
--   1. Enables required extensions.
--   2. Creates the append-only audit ledger.
--   3. Creates a trigger that rejects UPDATE/DELETE on the ledger (WORM at the DB).
--
-- Full DDL (users, folders, permissions, documents, versions, tasks, workflows,
-- metadata, retention, plus the PRD §7 add-on tables) lands in Phase 1.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- Immutable audit log ledger (WORM protection enforced) — from PRD §7.
CREATE TABLE IF NOT EXISTS dms_audit_trails (
    log_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    action      VARCHAR(255) NOT NULL, -- e.g. DOWNLOAD_VIEW, DOWNLOAD_EDIT, FORCE_UNLOCK
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WORM guard: block any UPDATE or DELETE against the ledger at the database layer.
-- (Phase 1 will additionally run the app under a role whose grants exclude UPDATE/DELETE
--  on log tables, and pair this with MinIO object-lock on stored binaries.)
CREATE OR REPLACE FUNCTION dms_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'WORM violation: % on % is not permitted', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_worm_audit_trails ON dms_audit_trails;
CREATE TRIGGER trg_worm_audit_trails
    BEFORE UPDATE OR DELETE ON dms_audit_trails
    FOR EACH ROW EXECUTE FUNCTION dms_reject_mutation();
