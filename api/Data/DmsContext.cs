using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace DMS.Api.Data;

public class DmsContext : DbContext
{
    public DmsContext(DbContextOptions<DmsContext> options) : base(options) { }

    public DbSet<DmsUser> Users => Set<DmsUser>();
    public DbSet<DmsFolder> Folders => Set<DmsFolder>();
    public DbSet<DmsFolderPermission> FolderPermissions => Set<DmsFolderPermission>();
    public DbSet<DmsFolderManager> FolderManagers => Set<DmsFolderManager>();
    public DbSet<DmsDocument> Documents => Set<DmsDocument>();
    public DbSet<DmsLibraryShortcut> LibraryShortcuts => Set<DmsLibraryShortcut>();
    public DbSet<DmsDocumentVersion> DocumentVersions => Set<DmsDocumentVersion>();
    public DbSet<DmsDocumentMetadata> DocumentMetadata => Set<DmsDocumentMetadata>();
    public DbSet<DmsAuditTrail> AuditTrails => Set<DmsAuditTrail>();
    public DbSet<DmsOcrIndex> OcrIndexes => Set<DmsOcrIndex>();
    public DbSet<DmsEsignature> Esignatures => Set<DmsEsignature>();
    public DbSet<DmsTask> Tasks => Set<DmsTask>();
    public DbSet<DmsTaskEscalation> TaskEscalations => Set<DmsTaskEscalation>();
    public DbSet<DmsTaskDocumentLink> TaskDocumentLinks => Set<DmsTaskDocumentLink>();
    public DbSet<DmsTaskFolderLink> TaskFolderLinks => Set<DmsTaskFolderLink>();
    public DbSet<DmsHistoricalPcar> HistoricalPcars => Set<DmsHistoricalPcar>();
    public DbSet<DmsWorkflowTemplate> WorkflowTemplates => Set<DmsWorkflowTemplate>();
    public DbSet<DmsWorkflow> Workflows => Set<DmsWorkflow>();
    public DbSet<DmsWorkflowStep> WorkflowSteps => Set<DmsWorkflowStep>();
    public DbSet<DmsReminder> Reminders => Set<DmsReminder>();
    public DbSet<DmsAuditCalendarEvent> AuditCalendarEvents => Set<DmsAuditCalendarEvent>();
    public DbSet<DmsAuditCycle> AuditCycles => Set<DmsAuditCycle>();
    public DbSet<DmsAuditRecord> AuditRecords => Set<DmsAuditRecord>();
    public DbSet<DmsAuditChecklistItem> AuditChecklistItems => Set<DmsAuditChecklistItem>();
    public DbSet<DmsEvidenceRequirement> EvidenceRequirements => Set<DmsEvidenceRequirement>();
    public DbSet<DmsManagementReviewEntry> ManagementReviewEntries => Set<DmsManagementReviewEntry>();
    public DbSet<DmsUserCalendarConnection> UserCalendarConnections => Set<DmsUserCalendarConnection>();
    public DbSet<DmsUserCalendarEventSync> UserCalendarEventSyncs => Set<DmsUserCalendarEventSync>();
    public DbSet<DmsApproval> Approvals => Set<DmsApproval>();
    public DbSet<DmsApprovalDocument> ApprovalDocuments => Set<DmsApprovalDocument>();
    public DbSet<DmsGroup> Groups => Set<DmsGroup>();
    public DbSet<DmsGroupMember> GroupMembers => Set<DmsGroupMember>();
    public DbSet<DmsGroupSubgroup> GroupSubgroups => Set<DmsGroupSubgroup>();
    public DbSet<DmsRolePermission> RolePermissions => Set<DmsRolePermission>();
    public DbSet<DmsAccessOverride> AccessOverrides => Set<DmsAccessOverride>();
    public DbSet<DmsPageAccessRole> PageAccessRoles => Set<DmsPageAccessRole>();
    public DbSet<DmsDropdownItem> DropdownItems => Set<DmsDropdownItem>();
    public DbSet<DmsNotification> Notifications => Set<DmsNotification>();
    public DbSet<DmsTaskAttachment> TaskAttachments => Set<DmsTaskAttachment>();
    public DbSet<DmsEvidenceLink> EvidenceLinks => Set<DmsEvidenceLink>();
    public DbSet<DmsEvidenceCycleAssignment> EvidenceCycleAssignments => Set<DmsEvidenceCycleAssignment>();
    public DbSet<DmsAppSetting> AppSettings => Set<DmsAppSetting>();
    public DbSet<DmsGoogleMeetingReminder> GoogleMeetingReminders => Set<DmsGoogleMeetingReminder>();
    public DbSet<DmsAnnouncement> Announcements => Set<DmsAnnouncement>();
    public DbSet<DmsLegacyDocumentMapping> LegacyDocumentMappings => Set<DmsLegacyDocumentMapping>();
    public DbSet<DmsLegacyMetadataSnapshot> LegacyMetadataSnapshots => Set<DmsLegacyMetadataSnapshot>();
    public DbSet<DmsLegacyContentVersion> LegacyContentVersions => Set<DmsLegacyContentVersion>();
    public DbSet<DmsLegacyContentFileDetail> LegacyContentFileDetails => Set<DmsLegacyContentFileDetail>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Convert PascalCase properties to snake_case columns for Postgres convention
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties())
            {
                property.SetColumnName(ToSnakeCase(property.Name));
            }
        }

        // Override: DmsDocumentVersion.CheckedOutById maps to the "checked_out_by" column
        // (the actual DB column, per 002_core_schema.sql, has no "_id" suffix) — the generic
        // ToSnakeCase pass above would otherwise produce "checked_out_by_id", which doesn't exist.
        modelBuilder.Entity<DmsDocumentVersion>()
            .Property(dv => dv.CheckedOutById)
            .HasColumnName("checked_out_by");

        // Configure JSONB columns (PostgreSQL-specific)
        modelBuilder.Entity<DmsFolder>()
            .Property(f => f.MetadataSchema)
            .HasColumnType("jsonb");

        modelBuilder.Entity<DmsAuditTrail>()
            .Property(at => at.Metadata)
            .HasColumnType("jsonb");

        // The database stores task due dates as PostgreSQL `date` values. Without
        // this explicit mapping, Npgsql treats DateTime as timestamptz, rejects
        // date-only values from the web form (Kind=Unspecified), and generates
        // invalid date/timestamp comparisons when listing tasks.
        modelBuilder.Entity<DmsTask>()
            .Property(t => t.DueDate)
            .HasColumnType("date");
        modelBuilder.Entity<DmsTask>()
            .Property(t => t.AuditDate)
            .HasColumnType("date");

        // === PRIMARY KEYS & TABLE NAMES (explicit configuration) ===
        modelBuilder.Entity<DmsUser>().ToTable("dms_users").HasKey(u => u.UserId);
        modelBuilder.Entity<DmsFolder>().ToTable("dms_folders").HasKey(f => f.FolderId);
        modelBuilder.Entity<DmsFolderPermission>().ToTable("dms_folder_permissions").HasKey(fp => fp.PermissionId);
        modelBuilder.Entity<DmsFolderManager>().ToTable("dms_folder_managers").HasKey(fm => new { fm.FolderId, fm.UserId });
        modelBuilder.Entity<DmsDocument>().ToTable("dms_documents").HasKey(d => d.DocumentId);
        modelBuilder.Entity<DmsLibraryShortcut>().ToTable("dms_library_shortcuts").HasKey(s => s.ShortcutId);
        modelBuilder.Entity<DmsFolder>().HasQueryFilter(f => f.DeletedAt == null);
        modelBuilder.Entity<DmsDocument>().HasQueryFilter(d => d.DeletedAt == null);
        modelBuilder.Entity<DmsDocumentVersion>().ToTable("dms_document_versions").HasKey(dv => dv.VersionId);
        modelBuilder.Entity<DmsDocumentVersion>().HasQueryFilter(dv => dv.DeletedAt == null);
        modelBuilder.Entity<DmsDocumentMetadata>().ToTable("dms_document_metadata").HasKey(dm => dm.MetadataId);
        modelBuilder.Entity<DmsWorkflowTemplate>().ToTable("dms_workflow_templates").HasKey(wt => wt.TemplateId);
        modelBuilder.Entity<DmsWorkflow>().ToTable("dms_workflows").HasKey(w => w.WorkflowId);
        modelBuilder.Entity<DmsWorkflowStep>().ToTable("dms_workflow_steps").HasKey(ws => ws.StepId);
        modelBuilder.Entity<DmsTask>().ToTable("dms_tasks").HasKey(t => t.TaskId);
        modelBuilder.Entity<DmsTaskEscalation>().ToTable("dms_task_escalations").HasKey(e => new { e.TaskId, e.Stage });
        modelBuilder.Entity<DmsTaskDocumentLink>().ToTable("dms_task_document_links").HasKey(l => new { l.TaskId, l.DocumentId });
        modelBuilder.Entity<DmsTaskFolderLink>().ToTable("dms_task_folder_links").HasKey(l => new { l.TaskId, l.FolderId });
        modelBuilder.Entity<DmsHistoricalPcar>().ToTable("dms_historical_pcars").HasKey(p => p.HistoricalPcarId);
        modelBuilder.Entity<DmsHistoricalPcar>().HasIndex(p => new { p.SourceSystem, p.LegacyRequestId }).IsUnique();
        modelBuilder.Entity<DmsReminder>().ToTable("dms_reminders").HasKey(r => r.ReminderId);
        modelBuilder.Entity<DmsAuditCalendarEvent>().ToTable("dms_audit_calendar_events").HasKey(e => e.EventId);
        modelBuilder.Entity<DmsAuditCycle>().ToTable("dms_audit_cycles").HasKey(c => c.AuditCycleId);
        modelBuilder.Entity<DmsAuditCycle>().Property(c => c.StartDate).HasColumnType("date");
        modelBuilder.Entity<DmsAuditCycle>().Property(c => c.EndDate).HasColumnType("date");
        modelBuilder.Entity<DmsAuditRecord>().ToTable("dms_audit_records").HasKey(a => a.AuditRecordId);
        modelBuilder.Entity<DmsAuditRecord>().Property(a => a.AuditDate).HasColumnType("date");
        modelBuilder.Entity<DmsEvidenceRequirement>().ToTable("dms_evidence_requirements").HasKey(e => e.EvidenceRequirementId);
        modelBuilder.Entity<DmsManagementReviewEntry>().ToTable("dms_management_review_entries").HasKey(e => e.ManagementReviewEntryId);
        modelBuilder.Entity<DmsManagementReviewEntry>().Property(e => e.DueDate).HasColumnType("date");
        modelBuilder.Entity<DmsUserCalendarConnection>().ToTable("dms_user_calendar_connections").HasKey(c => c.ConnectionId);
        modelBuilder.Entity<DmsUserCalendarEventSync>().ToTable("dms_user_calendar_event_syncs").HasKey(s => s.SyncId);
        modelBuilder.Entity<DmsAuditTrail>().ToTable("dms_audit_trails").HasKey(a => a.LogId);
        modelBuilder.Entity<DmsOcrIndex>().ToTable("dms_ocr_indexes").HasKey(o => o.OcrId);
        modelBuilder.Entity<DmsEsignature>().ToTable("dms_esignatures").HasKey(e => e.SignatureId);
        modelBuilder.Entity<DmsGroup>().ToTable("dms_groups").HasKey(g => g.GroupId);
        modelBuilder.Entity<DmsGroupMember>().ToTable("dms_group_members").HasKey(gm => gm.GroupMemberId);
        modelBuilder.Entity<DmsGroupSubgroup>().ToTable("dms_group_subgroups").HasKey(gs => gs.GroupSubgroupId);
        modelBuilder.Entity<DmsRolePermission>().ToTable("dms_role_permissions").HasKey(rp => rp.Role);
        modelBuilder.Entity<DmsAccessOverride>().ToTable("dms_access_overrides").HasKey(o => o.OverrideId);
        modelBuilder.Entity<DmsPageAccessRole>().ToTable("dms_page_access_roles").HasKey(r => r.Role);
        modelBuilder.Entity<DmsDropdownItem>().ToTable("dms_dropdown_items").HasKey(i => i.ItemId);
        modelBuilder.Entity<DmsNotification>().ToTable("dms_notifications").HasKey(n => n.NotificationId);
        modelBuilder.Entity<DmsTaskAttachment>().ToTable("dms_task_attachments").HasKey(a => a.AttachmentId);
        modelBuilder.Entity<DmsEvidenceLink>().ToTable("dms_evidence_links").HasKey(l => l.EvidenceLinkId);
        modelBuilder.Entity<DmsEvidenceCycleAssignment>().ToTable("dms_evidence_cycle_assignments").HasKey(a => a.DocumentId);
        modelBuilder.Entity<DmsAppSetting>().ToTable("dms_app_settings").HasKey(s => s.Key);
        modelBuilder.Entity<DmsGoogleMeetingReminder>().ToTable("dms_google_meeting_reminders").HasKey(r => r.ReminderId);
        modelBuilder.Entity<DmsAnnouncement>().ToTable("dms_announcements").HasKey(a => a.AnnouncementId);
        modelBuilder.Entity<DmsLegacyDocumentMapping>()
            .ToTable("dms_legacy_document_mappings")
            .HasKey(m => new { m.SourceSystem, m.LegacyDocumentId });
        modelBuilder.Entity<DmsLegacyMetadataSnapshot>()
            .ToTable("dms_legacy_metadata_snapshots")
            .HasKey(s => new { s.SourceSystem, s.LegacyMetadataVersionId });
        modelBuilder.Entity<DmsLegacyMetadataSnapshot>()
            .Property(s => s.RawMetadata)
            .HasColumnType("jsonb");
        modelBuilder.Entity<DmsLegacyContentVersion>()
            .ToTable("dms_legacy_content_versions")
            .HasKey(v => new { v.SourceSystem, v.LegacyContentVersionId });
        modelBuilder.Entity<DmsLegacyContentFileDetail>()
            .ToTable("dms_legacy_content_file_details")
            .HasKey(v => new { v.SourceSystem, v.LegacyContentVersionId });
        modelBuilder.Entity<DmsTaskAttachment>().HasOne(a => a.UploadedByUser).WithMany().HasForeignKey(a => a.UploadedBy);
        modelBuilder.Entity<DmsApproval>().ToTable("dms_approvals").HasKey(a => a.ApprovalId);
        modelBuilder.Entity<DmsApprovalDocument>().ToTable("dms_approval_documents").HasKey(ad => ad.ApprovalDocumentId);

        modelBuilder.Entity<DmsApproval>()
            .HasOne(a => a.CreatedByUser)
            .WithMany()
            .HasForeignKey(a => a.CreatedBy)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsApprovalDocument>()
            .HasOne(ad => ad.Approval)
            .WithMany(a => a.Documents)
            .HasForeignKey(ad => ad.ApprovalId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsApprovalDocument>()
            .HasOne(ad => ad.Document)
            .WithMany()
            .HasForeignKey(ad => ad.DocumentId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsApprovalDocument>()
            .HasOne(ad => ad.Version)
            .WithMany()
            .HasForeignKey(ad => ad.VersionId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsGroupMember>()
            .HasOne(gm => gm.Group)
            .WithMany()
            .HasForeignKey(gm => gm.GroupId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsGroupMember>()
            .HasOne(gm => gm.User)
            .WithMany()
            .HasForeignKey(gm => gm.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsGroupSubgroup>()
            .HasOne(gs => gs.ParentGroup)
            .WithMany()
            .HasForeignKey(gs => gs.ParentGroupId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsGroupSubgroup>()
            .HasOne(gs => gs.ChildGroup)
            .WithMany()
            .HasForeignKey(gs => gs.ChildGroupId)
            .OnDelete(DeleteBehavior.Restrict);

        // === FOREIGN KEY RELATIONSHIPS (Fluent API) ===
        // Folders: parent folder (self-ref, CASCADE) + owner (RESTRICT)
        modelBuilder.Entity<DmsFolder>()
            .HasOne<DmsFolder>()
            .WithMany()
            .HasForeignKey(f => f.ParentFolderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsFolder>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(f => f.OwnerId)
            .OnDelete(DeleteBehavior.Restrict);

        // Folder Permissions: folder (CASCADE) + user (CASCADE) + granter (SET NULL)
        modelBuilder.Entity<DmsFolderPermission>()
            .HasOne(fp => fp.Folder)
            .WithMany()
            .HasForeignKey(fp => fp.FolderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsFolderPermission>()
            .HasOne(fp => fp.User)
            .WithMany()
            .HasForeignKey(fp => fp.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsFolderPermission>()
            .HasOne(fp => fp.GrantedBy)
            .WithMany()
            .HasForeignKey(fp => fp.GrantedById)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsFolderManager>()
            .HasOne<DmsFolder>()
            .WithMany()
            .HasForeignKey(fm => fm.FolderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsFolderManager>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(fm => fm.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Documents: folder (RESTRICT) + owner (RESTRICT) + current version (SET NULL)
        modelBuilder.Entity<DmsDocument>()
            .HasOne<DmsFolder>()
            .WithMany()
            .HasForeignKey(d => d.FolderId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsDocument>()
            .HasOne(d => d.Owner)
            .WithMany()
            .HasForeignKey(d => d.OwnerId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsDocument>()
            .HasOne<DmsDocumentVersion>()
            .WithMany()
            .HasForeignKey(d => d.CurrentVersionId)
            .OnDelete(DeleteBehavior.SetNull);

        // A shortcut is an alias only. Removing either the destination folder
        // or the original target removes the alias; it never touches the
        // original document data, versions, or object-storage content.
        modelBuilder.Entity<DmsLibraryShortcut>()
            .HasOne<DmsFolder>()
            .WithMany()
            .HasForeignKey(s => s.ParentFolderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsLibraryShortcut>()
            .HasOne<DmsFolder>()
            .WithMany()
            .HasForeignKey(s => s.TargetFolderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsLibraryShortcut>()
            .HasOne<DmsDocument>()
            .WithMany()
            .HasForeignKey(s => s.TargetDocumentId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsLibraryShortcut>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(s => s.CreatedById)
            .OnDelete(DeleteBehavior.Restrict);

        // Document Versions: document (CASCADE) + checkout user (SET NULL) + submitted user (SET NULL) + approved user (SET NULL)
        modelBuilder.Entity<DmsDocumentVersion>()
            .HasOne(dv => dv.Document)
            .WithMany()
            .HasForeignKey(dv => dv.DocumentId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsDocumentVersion>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(dv => dv.CheckedOutById)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsDocumentVersion>()
            .HasOne(dv => dv.SubmittedBy)
            .WithMany()
            .HasForeignKey(dv => dv.SubmittedById)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsDocumentVersion>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(dv => dv.ApprovedById)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsDocumentVersion>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(dv => dv.DeletedById)
            .OnDelete(DeleteBehavior.SetNull);

        // Document Metadata: version (CASCADE)
        modelBuilder.Entity<DmsDocumentMetadata>()
            .HasOne<DmsDocumentVersion>()
            .WithMany()
            .HasForeignKey(dm => dm.VersionId)
            .OnDelete(DeleteBehavior.Cascade);

        // Audit Trail: user (SET NULL)
        modelBuilder.Entity<DmsAuditTrail>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(at => at.UserId)
            .OnDelete(DeleteBehavior.SetNull);

        // OCR Indexes: version (CASCADE)
        modelBuilder.Entity<DmsOcrIndex>()
            .HasOne<DmsDocumentVersion>()
            .WithMany()
            .HasForeignKey(oi => oi.VersionId)
            .OnDelete(DeleteBehavior.Cascade);

        // E-signatures: version (CASCADE) + user (RESTRICT)
        modelBuilder.Entity<DmsEsignature>()
            .HasOne<DmsDocumentVersion>()
            .WithMany()
            .HasForeignKey(es => es.VersionId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsEsignature>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(es => es.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        // Workflow Templates: folder (SET NULL)
        modelBuilder.Entity<DmsWorkflowTemplate>()
            .HasOne<DmsFolder>()
            .WithMany()
            .HasForeignKey(wt => wt.FolderId)
            .OnDelete(DeleteBehavior.SetNull);

        // Workflows: document (SET NULL) + template (RESTRICT)
        modelBuilder.Entity<DmsWorkflow>()
            .HasOne<DmsDocument>()
            .WithMany()
            .HasForeignKey(w => w.DocumentId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsWorkflow>()
            .HasOne<DmsWorkflowTemplate>()
            .WithMany()
            .HasForeignKey(w => w.TemplateId)
            .OnDelete(DeleteBehavior.Restrict);

        // Workflow Steps: workflow (CASCADE) + assigned user (SET NULL) + completed user (SET NULL)
        modelBuilder.Entity<DmsWorkflowStep>()
            .HasOne<DmsWorkflow>()
            .WithMany()
            .HasForeignKey(ws => ws.WorkflowId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsWorkflowStep>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(ws => ws.AssignedToId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsWorkflowStep>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(ws => ws.CompletedById)
            .OnDelete(DeleteBehavior.SetNull);

        // Tasks: assigned user (RESTRICT) + manager (SET NULL) + completed user (SET NULL) + document (SET NULL) + workflow step (SET NULL)
        modelBuilder.Entity<DmsTask>()
            .HasOne<DmsWorkflowStep>()
            .WithMany()
            .HasForeignKey(t => t.WorkflowStepId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsTask>()
            .HasOne(t => t.AssignedTo)
            .WithMany()
            .HasForeignKey(t => t.AssignedToId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsHistoricalPcar>()
            .HasOne(p => p.LinkedUser)
            .WithMany()
            .HasForeignKey(p => p.LinkedUserId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsHistoricalPcar>()
            .HasOne(p => p.MigratedTask)
            .WithMany()
            .HasForeignKey(p => p.MigratedTaskId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsTask>()
            .HasOne(t => t.AssignedToGroup)
            .WithMany()
            .HasForeignKey(t => t.AssignedToGroupId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsTask>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(t => t.ManagerId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsTask>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(t => t.CompletedById)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<DmsTask>()
            .HasOne(t => t.Document)
            .WithMany()
            .HasForeignKey(t => t.DocumentId)
            .OnDelete(DeleteBehavior.SetNull);

        // A task's extra file/folder links have database foreign keys. Map the
        // same relationships in EF so SaveChanges inserts the parent task
        // before its link rows (important when a new PCAR has several links).
        modelBuilder.Entity<DmsTaskDocumentLink>()
            .HasOne<DmsTask>()
            .WithMany()
            .HasForeignKey(link => link.TaskId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsTaskDocumentLink>()
            .HasOne<DmsDocument>()
            .WithMany()
            .HasForeignKey(link => link.DocumentId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsTaskFolderLink>()
            .HasOne<DmsTask>()
            .WithMany()
            .HasForeignKey(link => link.TaskId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsTaskFolderLink>()
            .HasOne<DmsFolder>()
            .WithMany()
            .HasForeignKey(link => link.FolderId)
            .OnDelete(DeleteBehavior.Cascade);

        // Reminders: task (CASCADE) + recipient (RESTRICT)
        modelBuilder.Entity<DmsReminder>()
            .HasOne(r => r.Task)
            .WithMany()
            .HasForeignKey(r => r.TaskId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsReminder>()
            .HasOne(r => r.Recipient)
            .WithMany()
            .HasForeignKey(r => r.RecipientId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsAuditCalendarEvent>()
            .HasOne(e => e.PostedByUser)
            .WithMany()
            .HasForeignKey(e => e.PostedBy)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsAnnouncement>()
            .HasOne(a => a.PostedByUser)
            .WithMany()
            .HasForeignKey(a => a.PostedById)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsUserCalendarConnection>()
            .HasOne(c => c.User)
            .WithMany()
            .HasForeignKey(c => c.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsUserCalendarEventSync>()
            .HasOne(s => s.User)
            .WithMany()
            .HasForeignKey(s => s.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<DmsUserCalendarEventSync>()
            .HasOne(s => s.Event)
            .WithMany()
            .HasForeignKey(s => s.EventId)
            .OnDelete(DeleteBehavior.Cascade);

        // === APPROVAL WORKFLOW (C-Doc) === [COMMENTED OUT - MODELS NOT YET CREATED]
        // Approvals: Created by (user), QA review (SET NULL), Manager review (SET NULL), Released by (SET NULL), Correction task (SET NULL)
        // modelBuilder.Entity<DmsApproval>().ToTable("dms_approvals").HasKey(a => a.ApprovalId);

        // Tracking Code Sequences (no FK, just for document numbering)
        // modelBuilder.Entity<DmsTrackingCodeSequence>().ToTable("dms_tracking_code_sequences").HasKey(tcs => tcs.SequenceId);

        // Document ID Sequences (system auto-generation at QA Triage)
        // modelBuilder.Entity<DmsDocIdSequence>().ToTable("dms_docid_sequences").HasKey(s => s.SequenceDate);

        // modelBuilder.Entity<DmsApproval>()
        //     .HasOne(a => a.CreatedByUser)
        //     .WithMany()
        //     .HasForeignKey(a => a.CreatedBy)
        //     .OnDelete(DeleteBehavior.Restrict);

        // modelBuilder.Entity<DmsApproval>()
        //     .HasOne(a => a.QaReviewedByUser)
        //     .WithMany()
        //     .HasForeignKey(a => a.QaReviewedBy)
        //     .OnDelete(DeleteBehavior.SetNull);

        // modelBuilder.Entity<DmsApproval>()
        //     .HasOne(a => a.ManagerReviewedByUser)
        //     .WithMany()
        //     .HasForeignKey(a => a.ManagerReviewedBy)
        //     .OnDelete(DeleteBehavior.SetNull);

        // modelBuilder.Entity<DmsApproval>()
        //     .HasOne(a => a.ReleasedByUser)
        //     .WithMany()
        //     .HasForeignKey(a => a.ReleasedBy)
        //     .OnDelete(DeleteBehavior.SetNull);

        // modelBuilder.Entity<DmsApproval>()
        //     .HasOne(a => a.CorrectionTask)
        //     .WithMany()
        //     .HasForeignKey(a => a.CorrectionTaskId)
        //     .OnDelete(DeleteBehavior.SetNull);

        // Approval Documents: approval (CASCADE) + document (CASCADE) + version (CASCADE)
        // modelBuilder.Entity<DmsApprovalDocument>().ToTable("dms_approval_documents").HasKey(ad => ad.ApprovalDocumentId);

        // modelBuilder.Entity<DmsApprovalDocument>()
        //     .HasOne(ad => ad.Approval)
        //     .WithMany(a => a.ApprovalDocuments)
        //     .HasForeignKey(ad => ad.ApprovalId)
        //     .OnDelete(DeleteBehavior.Cascade);

        // modelBuilder.Entity<DmsApprovalDocument>()
        //     .HasOne(ad => ad.Document)
        //     .WithMany()
        //     .HasForeignKey(ad => ad.DocumentId)
        //     .OnDelete(DeleteBehavior.Cascade);

        // modelBuilder.Entity<DmsApprovalDocument>()
        //     .HasOne(ad => ad.Version)
        //     .WithMany()
        //     .HasForeignKey(ad => ad.VersionId)
        //     .OnDelete(DeleteBehavior.Cascade);

        // === INDEXES ===
        modelBuilder.Entity<DmsUser>(e => e.HasIndex(u => u.Email).IsUnique());
        modelBuilder.Entity<DmsUser>(e => e.HasIndex(u => u.SsoSubject));

        modelBuilder.Entity<DmsFolder>(e => e.HasIndex(f => new { f.ParentFolderId, f.Name }).IsUnique().HasFilter("deleted_at IS NULL"));
        modelBuilder.Entity<DmsFolderPermission>(e => e.HasIndex(fp => new { fp.FolderId, fp.UserId }).IsUnique());
        modelBuilder.Entity<DmsDocument>(e => e.HasIndex(d => d.TrackingCode).IsUnique());
        modelBuilder.Entity<DmsDocumentVersion>(e => e.HasIndex(dv => new { dv.DocumentId, dv.VersionNumber }).IsUnique());
        modelBuilder.Entity<DmsDocumentVersion>(e => e.HasIndex(dv => dv.S3ObjectKey).IsUnique());
        modelBuilder.Entity<DmsDocumentVersion>(e => e.HasIndex(dv => new { dv.IsCheckedOut, dv.CheckedOutById }));

        modelBuilder.Entity<DmsAuditTrail>(e => e.HasIndex(at => at.UserId));
        modelBuilder.Entity<DmsAuditTrail>(e => e.HasIndex(at => at.Action));
        modelBuilder.Entity<DmsAuditTrail>(e => e.HasIndex(at => at.CreatedAt));

        modelBuilder.Entity<DmsTask>(e => e.HasIndex(t => t.AssignedToId));
        modelBuilder.Entity<DmsTask>(e => e.HasIndex(t => t.Status));
        modelBuilder.Entity<DmsTask>(e => e.HasIndex(t => t.DueDate));

        modelBuilder.Entity<DmsReminder>(e => e.HasIndex(r => r.RecipientId));
        modelBuilder.Entity<DmsReminder>(e => e.HasIndex(r => r.DueDate));
        modelBuilder.Entity<DmsReminder>(e => e.HasIndex(r => r.IsSent));

        modelBuilder.Entity<DmsAuditCalendarEvent>(e => e.HasIndex(a => a.EventDate));

        modelBuilder.Entity<DmsUserCalendarConnection>(e => e.HasIndex(c => c.UserId).IsUnique());
        modelBuilder.Entity<DmsUserCalendarConnection>(e => e.HasIndex(c => c.IsActive));
        modelBuilder.Entity<DmsUserCalendarEventSync>(e => e.HasIndex(s => new { s.UserId, s.EventId }).IsUnique());
    }

    private static string ToSnakeCase(string input)
    {
        var result = System.Text.RegularExpressions.Regex.Replace(input, "([A-Z])", "_$1").TrimStart('_').ToLower();
        return result;
    }
}
