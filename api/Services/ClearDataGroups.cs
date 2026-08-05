namespace DMS.Api.Services;

// The named groups the Admin Panel's Database page can clear individually.
// Deliberately excludes dms_users, dms_page_access_roles, and
// dms_role_permissions from every group (and from "Clear All") — user
// accounts are never affected by any clear operation, and dms_users.role
// has a foreign key INTO dms_page_access_roles, so truncating roles would
// cascade-wipe every user account too.
public static class ClearDataGroups
{
    public record Group(string Key, string Label, string Description, string[] Tables);

    public static readonly Group[] All =
    [
        new("document_library", "Document Library", "Folders, documents, versions, permissions, and overrides",
            ["dms_documents", "dms_document_versions", "dms_document_metadata", "dms_folders", "dms_folder_permissions",
             "dms_access_overrides", "dms_ocr_indexes", "dms_retention_policies", "dms_esignatures",
             "dms_workflows", "dms_workflow_steps", "dms_workflow_templates"]),
        new("approvals", "C-Doc Workflow", "Approval batches and per-document stage history",
            ["dms_approval_documents", "dms_approvals"]),
        new("tasks", "PCAR / Tasks", "Task records and attachments",
            ["dms_task_attachments", "dms_tasks"]),
        new("reminders", "Reminders", "Scheduled reminders",
            ["dms_reminders"]),
        new("notifications", "Notifications", "In-app notification log",
            ["dms_notifications"]),
        new("announcements", "Announcements", "Sent announcements and read status",
            ["dms_announcements"]),
        new("groups", "Groups", "Groups, members, and subgroup nesting",
            ["dms_group_members", "dms_group_subgroups", "dms_groups"]),
        new("company_data", "Company Data", "Department, Category, and Tag dropdown lists",
            ["dms_dropdown_items"]),
        new("audit_trail", "Audit Trail", "Full activity log",
            ["dms_audit_trails"]),
        new("platform_settings", "Platform Settings", "Branding, login page, header, security, and notification config",
            ["dms_app_settings"]),
        new("google_calendar", "Google Calendar Sync", "Per-user calendar connections and synced events",
            ["dms_user_calendar_event_syncs", "dms_user_calendar_connections", "dms_audit_calendar_events", "dms_google_meeting_reminders"]),
    ];
}
