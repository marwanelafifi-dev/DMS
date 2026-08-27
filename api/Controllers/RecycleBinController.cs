using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/recycle-bin")]
public class RecycleBinController(DmsContext context, AuditService auditService, MinioService minioService) : BaseController
{
    private async Task<bool> IsFullAccessAsync(Guid userId) =>
        (await GetPageAccessRoleAsync(context, userId))?.BypassFolderPermissions == true;

    [HttpGet]
    public async Task<ActionResult<object>> ListDeletedItems()
    {
        var userId = GetCurrentUserId();
        if (!await IsFullAccessAsync(userId)) return StatusCode(403, new { success = false, error = "Full Access is required" });
        var allDeletedFolders = await context.Folders.IgnoreQueryFilters().AsNoTracking().Where(f => f.DeletedAt != null)
            .Select(f => new RecycleBinItem(f.FolderId, "folder", f.Name, f.DeletedAt!.Value, f.DeletedById, f.DeletionBatchId, f.ParentFolderId)).ToListAsync();
        var deletedFolderIds = allDeletedFolders.Select(f => f.Id).ToHashSet();
        var folders = allDeletedFolders.Where(f => !f.ParentFolderId.HasValue || !deletedFolderIds.Contains(f.ParentFolderId.Value)).ToList();
        var documents = await context.Documents.IgnoreQueryFilters().AsNoTracking().Where(d => d.DeletedAt != null)
            .Select(d => new RecycleBinItem(d.DocumentId, "file", d.Title, d.DeletedAt!.Value, d.DeletedById, d.DeletionBatchId, d.FolderId)).ToListAsync();
        documents = documents.Where(d => !d.ParentFolderId.HasValue || !deletedFolderIds.Contains(d.ParentFolderId.Value)).ToList();
        var items = folders.Concat(documents).OrderByDescending(i => i.DeletedAt).ToList();
        var deletedByIds = items.Where(i => i.DeletedById.HasValue).Select(i => i.DeletedById!.Value).Distinct().ToList();
        var names = await context.Users.AsNoTracking().Where(u => deletedByIds.Contains(u.UserId)).ToDictionaryAsync(u => u.UserId, u => u.FullName);
        var data = items.Select(i => new { i.Id, i.Type, i.Name, i.DeletedAt, deletedBy = i.DeletedById.HasValue ? names.GetValueOrDefault(i.DeletedById.Value) : null, i.DeletionBatchId, i.ParentFolderId });
        return Ok(new { success = true, data });
    }

    [HttpPost("folders/{id}/restore")]
    public async Task<ActionResult<object>> RestoreFolder(Guid id)
    {
        var userId = GetCurrentUserId();
        if (!await IsFullAccessAsync(userId)) return StatusCode(403, new { success = false, error = "Full Access is required" });
        var folder = await context.Folders.IgnoreQueryFilters().FirstOrDefaultAsync(f => f.FolderId == id && f.DeletedAt != null);
        if (folder == null) return NotFound(new { success = false, error = "Deleted folder not found" });
        if (folder.ParentFolderId.HasValue && !await context.Folders.AnyAsync(f => f.FolderId == folder.ParentFolderId.Value))
            return BadRequest(new { success = false, error = "Restore the parent folder first" });
        if (await context.Folders.AnyAsync(f => f.ParentFolderId == folder.ParentFolderId && f.Name.ToLower() == folder.Name.ToLower()))
            return Conflict(new { success = false, error = "An active folder with the same name already exists in this location" });
        var batchId = folder.DeletionBatchId;
        var folders = await context.Folders.IgnoreQueryFilters().Where(f => f.DeletionBatchId == batchId && f.DeletedAt != null).ToListAsync();
        var documents = await context.Documents.IgnoreQueryFilters().Where(d => d.DeletionBatchId == batchId && d.DeletedAt != null).ToListAsync();
        foreach (var item in folders) { item.DeletedAt = null; item.DeletedById = null; item.DeletionBatchId = null; }
        foreach (var item in documents) { item.DeletedAt = null; item.DeletedById = null; item.DeletionBatchId = null; }
        await context.SaveChangesAsync();
        await auditService.LogAsync(userId, AuditActions.FOLDER_RESTORED, new { folder.FolderId, folder.Name, RestoredFolders = folders.Count, RestoredDocuments = documents.Count });
        return Ok(new { success = true, message = "Folder tree restored" });
    }

    [HttpPost("documents/{id}/restore")]
    public async Task<ActionResult<object>> RestoreDocument(Guid id)
    {
        var userId = GetCurrentUserId();
        if (!await IsFullAccessAsync(userId)) return StatusCode(403, new { success = false, error = "Full Access is required" });
        var document = await context.Documents.IgnoreQueryFilters().FirstOrDefaultAsync(d => d.DocumentId == id && d.DeletedAt != null);
        if (document == null) return NotFound(new { success = false, error = "Deleted document not found" });
        if (!await context.Folders.AnyAsync(f => f.FolderId == document.FolderId))
            return BadRequest(new { success = false, error = "Restore the document's folder first" });
        document.DeletedAt = null; document.DeletedById = null; document.DeletionBatchId = null;
        await context.SaveChangesAsync();
        await auditService.LogAsync(userId, AuditActions.DOCUMENT_RESTORED, new { document.DocumentId, document.Title, document.FolderId });
        return Ok(new { success = true, message = "Document restored" });
    }

    [HttpPost("purge")]
    public async Task<ActionResult<object>> Purge([FromBody] PurgeRecycleBinRequest request)
    {
        var userId = GetCurrentUserId();
        if (!await IsFullAccessAsync(userId)) return StatusCode(403, new { success = false, error = "Full Access is required" });
        if (!request.EmptyAll && request.Items.Count == 0) return BadRequest(new { success = false, error = "Select at least one item" });

        var deletedFolders = await context.Folders.IgnoreQueryFilters().Where(f => f.DeletedAt != null).ToListAsync();
        var deletedDocuments = await context.Documents.IgnoreQueryFilters().Where(d => d.DeletedAt != null).ToListAsync();
        var selectedFolderIds = request.EmptyAll
            ? deletedFolders.Select(f => f.FolderId).ToHashSet()
            : request.Items.Where(i => i.Type == "folder").Select(i => i.Id).ToHashSet();
        var selectedBatchIds = deletedFolders.Where(f => selectedFolderIds.Contains(f.FolderId) && f.DeletionBatchId.HasValue)
            .Select(f => f.DeletionBatchId!.Value).ToHashSet();
        var foldersToDelete = request.EmptyAll
            ? deletedFolders
            : deletedFolders.Where(f => selectedFolderIds.Contains(f.FolderId) || (f.DeletionBatchId.HasValue && selectedBatchIds.Contains(f.DeletionBatchId.Value))).ToList();
        var folderIdsToDelete = foldersToDelete.Select(f => f.FolderId).ToHashSet();
        var selectedDocumentIds = request.EmptyAll
            ? deletedDocuments.Select(d => d.DocumentId).ToHashSet()
            : request.Items.Where(i => i.Type == "file").Select(i => i.Id).ToHashSet();
        var documentsToDelete = deletedDocuments.Where(d => selectedDocumentIds.Contains(d.DocumentId) || folderIdsToDelete.Contains(d.FolderId)).ToList();
        if (foldersToDelete.Count == 0 && documentsToDelete.Count == 0) return NotFound(new { success = false, error = "No deleted items were found" });

        var documentIds = documentsToDelete.Select(d => d.DocumentId).ToHashSet();
        var versions = await context.DocumentVersions.Where(v => documentIds.Contains(v.DocumentId)).ToListAsync();
        var storageKeys = versions.Where(v => !string.IsNullOrWhiteSpace(v.S3ObjectKey)).Select(v => v.S3ObjectKey).Distinct().ToList();
        await using (var transaction = await context.Database.BeginTransactionAsync())
        {
            foreach (var document in documentsToDelete) document.CurrentVersionId = null;
            await context.SaveChangesAsync();
            var approvals = await context.Approvals
                .Where(a => a.Documents.Any() && a.Documents.All(ad => documentIds.Contains(ad.DocumentId)))
                .ToListAsync();
            context.Approvals.RemoveRange(approvals);
            context.DocumentVersions.RemoveRange(versions);
            context.Documents.RemoveRange(documentsToDelete);
            await context.SaveChangesAsync();
            context.Folders.RemoveRange(foldersToDelete.OrderByDescending(f => f.ParentFolderId.HasValue));
            await context.SaveChangesAsync();
            await transaction.CommitAsync();
        }

        foreach (var key in storageKeys)
        {
            try { await minioService.DeleteAsync(key); }
            catch { /* Database purge is authoritative; storage cleanup is best-effort. */ }
        }
        await auditService.LogAsync(userId, AuditActions.RECYCLE_BIN_PURGED, new { request.EmptyAll, FoldersDeleted = foldersToDelete.Count, DocumentsDeleted = documentsToDelete.Count, FilesDeleted = storageKeys.Count });
        return Ok(new { success = true, message = request.EmptyAll ? "Recycle Bin emptied permanently" : "Selected items deleted permanently" });
    }

    private sealed record RecycleBinItem(Guid Id, string Type, string Name, DateTime DeletedAt, Guid? DeletedById, Guid? DeletionBatchId, Guid? ParentFolderId);
}

public sealed record PurgeRecycleBinItem(Guid Id, string Type);
public sealed record PurgeRecycleBinRequest(List<PurgeRecycleBinItem> Items, bool EmptyAll = false);
