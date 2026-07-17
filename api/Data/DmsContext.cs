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
    public DbSet<DmsDocument> Documents => Set<DmsDocument>();
    public DbSet<DmsDocumentVersion> DocumentVersions => Set<DmsDocumentVersion>();
    public DbSet<DmsDocumentMetadata> DocumentMetadata => Set<DmsDocumentMetadata>();
    public DbSet<DmsAuditTrail> AuditTrails => Set<DmsAuditTrail>();
    public DbSet<DmsOcrIndex> OcrIndexes => Set<DmsOcrIndex>();
    public DbSet<DmsEsignature> Esignatures => Set<DmsEsignature>();
    public DbSet<DmsTask> Tasks => Set<DmsTask>();
    public DbSet<DmsWorkflowTemplate> WorkflowTemplates => Set<DmsWorkflowTemplate>();
    public DbSet<DmsWorkflow> Workflows => Set<DmsWorkflow>();
    public DbSet<DmsWorkflowStep> WorkflowSteps => Set<DmsWorkflowStep>();
    public DbSet<DmsReminder> Reminders => Set<DmsReminder>();

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

        // === PRIMARY KEYS & TABLE NAMES (explicit configuration) ===
        modelBuilder.Entity<DmsUser>().ToTable("dms_users").HasKey(u => u.UserId);
        modelBuilder.Entity<DmsFolder>().ToTable("dms_folders").HasKey(f => f.FolderId);
        modelBuilder.Entity<DmsFolderPermission>().ToTable("dms_folder_permissions").HasKey(fp => fp.PermissionId);
        modelBuilder.Entity<DmsDocument>().ToTable("dms_documents").HasKey(d => d.DocumentId);
        modelBuilder.Entity<DmsDocumentVersion>().ToTable("dms_document_versions").HasKey(dv => dv.VersionId);
        modelBuilder.Entity<DmsDocumentMetadata>().ToTable("dms_document_metadata").HasKey(dm => dm.MetadataId);
        modelBuilder.Entity<DmsWorkflowTemplate>().ToTable("dms_workflow_templates").HasKey(wt => wt.TemplateId);
        modelBuilder.Entity<DmsWorkflow>().ToTable("dms_workflows").HasKey(w => w.WorkflowId);
        modelBuilder.Entity<DmsWorkflowStep>().ToTable("dms_workflow_steps").HasKey(ws => ws.StepId);
        modelBuilder.Entity<DmsTask>().ToTable("dms_tasks").HasKey(t => t.TaskId);
        modelBuilder.Entity<DmsReminder>().ToTable("dms_reminders").HasKey(r => r.ReminderId);
        modelBuilder.Entity<DmsAuditTrail>().ToTable("dms_audit_trails").HasKey(a => a.LogId);
        modelBuilder.Entity<DmsOcrIndex>().ToTable("dms_ocr_indexes").HasKey(o => o.OcrId);
        modelBuilder.Entity<DmsEsignature>().ToTable("dms_esignatures").HasKey(e => e.SignatureId);

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

        // Documents: folder (RESTRICT) + owner (RESTRICT) + current version (SET NULL)
        modelBuilder.Entity<DmsDocument>()
            .HasOne<DmsFolder>()
            .WithMany()
            .HasForeignKey(d => d.FolderId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsDocument>()
            .HasOne<DmsUser>()
            .WithMany()
            .HasForeignKey(d => d.OwnerId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DmsDocument>()
            .HasOne<DmsDocumentVersion>()
            .WithMany()
            .HasForeignKey(d => d.CurrentVersionId)
            .OnDelete(DeleteBehavior.SetNull);

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

        // === INDEXES ===
        modelBuilder.Entity<DmsUser>(e => e.HasIndex(u => u.Email).IsUnique());
        modelBuilder.Entity<DmsUser>(e => e.HasIndex(u => u.SsoSubject));

        modelBuilder.Entity<DmsFolder>(e => e.HasIndex(f => new { f.ParentFolderId, f.Name }).IsUnique());
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
    }

    private static string ToSnakeCase(string input)
    {
        var result = System.Text.RegularExpressions.Regex.Replace(input, "([A-Z])", "_$1").TrimStart('_').ToLower();
        return result;
    }
}
