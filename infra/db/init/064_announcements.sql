-- Migration 064: free-text announcements (Admin/Quality post, visible to
-- everyone on the Dashboard's ISO calendar card) with optional targeted
-- notification fan-out (email + in-app) to selected users at post time.
-- Individual send results aren't tracked per-recipient — this table is the
-- announcement itself; delivery is fire-and-forget through NotificationService
-- / EmailService at creation time, same as every other notification in the app.
CREATE TABLE IF NOT EXISTS dms_announcements (
    announcement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    posted_by_id UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE CASCADE,
    notified_email BOOLEAN NOT NULL DEFAULT false,
    notified_app BOOLEAN NOT NULL DEFAULT false,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON dms_announcements(created_at DESC);
