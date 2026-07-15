using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

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
    public DbSet<DmsReminder> Reminders => Set<DmsReminder>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Simplified configuration — no navigation properties, just scalar indexes
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
}
