-- Migration 023: User Groups
-- Adds a simple named-group concept for organizing users (distinct from
-- per-folder permission roles) — a group has a name/description and a set
-- of member users, managed from the Groups admin page.
-- Date: 2026-07-30

CREATE TABLE IF NOT EXISTS dms_groups (
    group_id UUID PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dms_group_members (
    group_member_id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES dms_groups(group_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE CASCADE,
    added_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dms_group_members_group_id ON dms_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_dms_group_members_user_id ON dms_group_members(user_id);
