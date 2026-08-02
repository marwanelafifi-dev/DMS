-- Real per-user notifications, replacing the dead bell icon (hardcoded "3"
-- badge, no dropdown, no backing data) in the Navbar.
CREATE TABLE IF NOT EXISTS dms_notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    document_id UUID REFERENCES dms_documents(document_id) ON DELETE SET NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON dms_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON dms_notifications(user_id) WHERE is_read = false;
