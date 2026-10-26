-- Group membership for current and future users. Existing groups remain manual
-- until an administrator enables the option in Groups.
ALTER TABLE dms_groups
    ADD COLUMN IF NOT EXISTS auto_add_new_users BOOLEAN NOT NULL DEFAULT FALSE;

-- This trigger also fills any pre-existing users when an automatic group is
-- created or when an existing group is switched to automatic membership.
CREATE OR REPLACE FUNCTION dms_fill_auto_group_members() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT NEW.auto_add_new_users THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.auto_add_new_users THEN
            RETURN NEW;
        END IF;
    END IF;
    INSERT INTO dms_group_members (group_member_id, group_id, user_id, added_at)
    SELECT gen_random_uuid(), NEW.group_id, u.user_id, now()
    FROM dms_users u
    ON CONFLICT (group_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dms_fill_auto_group_members ON dms_groups;
CREATE TRIGGER trg_dms_fill_auto_group_members
AFTER INSERT OR UPDATE OF auto_add_new_users ON dms_groups
FOR EACH ROW EXECUTE FUNCTION dms_fill_auto_group_members();

-- Account creation can happen through Admin Users, CSV import, Google SSO,
-- or future integrations. The database trigger covers all of those paths.
CREATE OR REPLACE FUNCTION dms_enroll_new_user_in_auto_groups() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO dms_group_members (group_member_id, group_id, user_id, added_at)
    SELECT gen_random_uuid(), g.group_id, NEW.user_id, now()
    FROM dms_groups g
    WHERE g.auto_add_new_users
    ON CONFLICT (group_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dms_enroll_new_user_in_auto_groups ON dms_users;
CREATE TRIGGER trg_dms_enroll_new_user_in_auto_groups
AFTER INSERT ON dms_users
FOR EACH ROW EXECUTE FUNCTION dms_enroll_new_user_in_auto_groups();

-- Safe if a previous run set the flag before installing the triggers.
INSERT INTO dms_group_members (group_member_id, group_id, user_id, added_at)
SELECT gen_random_uuid(), g.group_id, u.user_id, now()
FROM dms_groups g CROSS JOIN dms_users u
WHERE g.auto_add_new_users
ON CONFLICT (group_id, user_id) DO NOTHING;
