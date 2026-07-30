-- Migration 022: Real Login + Session Presence
-- Adds heartbeat tracking so the Users admin page can show real Online/Offline
-- status instead of a fabricated value. The frontend pings a heartbeat endpoint
-- periodically while a tab is open; a user is "online" if that timestamp is
-- recent.
-- Date: 2026-07-30

ALTER TABLE dms_users
ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP;
