-- Migration 024: Nested Groups (Subgroups)
-- A group can now contain other groups as members, not just users — mirrors
-- the nested-group concept in the reference AD/LDAP admin UI. Cycle
-- prevention (a group can't contain an ancestor of itself) is enforced in
-- application code, not at the DB level.
-- Date: 2026-07-30

CREATE TABLE IF NOT EXISTS dms_group_subgroups (
    group_subgroup_id UUID PRIMARY KEY,
    parent_group_id UUID NOT NULL REFERENCES dms_groups(group_id) ON DELETE CASCADE,
    child_group_id UUID NOT NULL REFERENCES dms_groups(group_id) ON DELETE CASCADE,
    added_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (parent_group_id, child_group_id),
    CHECK (parent_group_id != child_group_id)
);

CREATE INDEX IF NOT EXISTS idx_dms_group_subgroups_parent ON dms_group_subgroups(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_dms_group_subgroups_child ON dms_group_subgroups(child_group_id);
