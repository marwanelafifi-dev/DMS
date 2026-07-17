using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class ApprovalService(DmsContext context, AuditService auditService, ILogger<ApprovalService> logger)
{
    public async Task<ApprovalResult> SubmitForApprovalAsync(Guid documentId, Guid versionId, Guid userId, string? comment = null)
    {
        try
        {
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == documentId);

            if (document == null)
                return ApprovalResult.NotFound("Document not found");

            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(v => v.VersionId == versionId && v.DocumentId == documentId);

            if (version == null)
                return ApprovalResult.NotFound("Version not found");

            // Can only submit draft or rejected versions
            if (version.Status != "draft" && version.Status != "rejected")
                return ApprovalResult.Invalid($"Cannot submit {version.Status} document for approval");

            // Must not be checked out
            if (version.IsCheckedOut)
                return ApprovalResult.Invalid("Cannot submit checked out document");

            version.Status = "pending_approval";
            version.SubmittedById = userId;
            version.SubmittedAt = DateTime.UtcNow;
            version.UpdatedAt = DateTime.UtcNow;

            document.Status = "pending_approval";
            document.UpdatedAt = DateTime.UtcNow;

            context.DocumentVersions.Update(version);
            context.Documents.Update(document);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, AuditActions.DOCUMENT_SUBMITTED, new
            {
                document.DocumentId,
                version.VersionId,
                document.Title,
                version.VersionNumber,
                SubmittedAt = version.SubmittedAt,
                Comment = comment
            });

            logger.LogInformation("Document {DocumentId} submitted for approval by user {UserId}", documentId, userId);

            return ApprovalResult.Ok(new
            {
                document.DocumentId,
                version.VersionId,
                version.Status,
                version.SubmittedAt,
                Message = "Document submitted for approval"
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error submitting document {DocumentId} for approval", documentId);
            return ApprovalResult.Fail(ex.Message);
        }
    }

    public async Task<ApprovalResult> ApproveAsync(Guid documentId, Guid versionId, Guid managerId, string? comment = null)
    {
        try
        {
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == documentId);

            if (document == null)
                return ApprovalResult.NotFound("Document not found");

            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(v => v.VersionId == versionId && v.DocumentId == documentId);

            if (version == null)
                return ApprovalResult.NotFound("Version not found");

            if (version.Status != "pending_approval")
                return ApprovalResult.Invalid($"Cannot approve {version.Status} document");

            version.Status = "released";
            version.ApprovedById = managerId;
            version.ApprovedAt = DateTime.UtcNow;
            version.ApprovalComment = comment?.Trim();
            version.UpdatedAt = DateTime.UtcNow;

            document.Status = "released";
            document.CurrentVersionId = versionId;
            document.UpdatedAt = DateTime.UtcNow;

            context.DocumentVersions.Update(version);
            context.Documents.Update(document);
            await context.SaveChangesAsync();

            await auditService.LogAsync(managerId, AuditActions.DOCUMENT_APPROVED, new
            {
                document.DocumentId,
                version.VersionId,
                document.Title,
                version.VersionNumber,
                ApprovedAt = version.ApprovedAt,
                ApprovalComment = comment,
                ApprovedBy = managerId
            });

            logger.LogInformation("Document {DocumentId} approved by manager {ManagerId}", documentId, managerId);

            return ApprovalResult.Ok(new
            {
                document.DocumentId,
                version.VersionId,
                version.Status,
                version.ApprovedAt,
                Message = "Document approved and released"
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error approving document {DocumentId}", documentId);
            return ApprovalResult.Fail(ex.Message);
        }
    }

    public async Task<ApprovalResult> RejectAsync(Guid documentId, Guid versionId, Guid managerId, string reason)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(reason))
                return ApprovalResult.Invalid("Rejection reason is required");

            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == documentId);

            if (document == null)
                return ApprovalResult.NotFound("Document not found");

            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(v => v.VersionId == versionId && v.DocumentId == documentId);

            if (version == null)
                return ApprovalResult.NotFound("Version not found");

            if (version.Status != "pending_approval")
                return ApprovalResult.Invalid($"Cannot reject {version.Status} document");

            version.Status = "rejected";
            version.ApprovedById = managerId;
            version.ApprovedAt = DateTime.UtcNow;
            version.ApprovalComment = $"REJECTED: {reason.Trim()}";
            version.UpdatedAt = DateTime.UtcNow;

            document.Status = "rejected";
            document.UpdatedAt = DateTime.UtcNow;

            context.DocumentVersions.Update(version);
            context.Documents.Update(document);
            await context.SaveChangesAsync();

            await auditService.LogAsync(managerId, AuditActions.DOCUMENT_REJECTED, new
            {
                document.DocumentId,
                version.VersionId,
                document.Title,
                version.VersionNumber,
                RejectedAt = version.ApprovedAt,
                RejectionReason = reason,
                RejectedBy = managerId
            });

            logger.LogInformation("Document {DocumentId} rejected by manager {ManagerId}", documentId, managerId);

            return ApprovalResult.Ok(new
            {
                document.DocumentId,
                version.VersionId,
                version.Status,
                version.ApprovedAt,
                RejectionReason = reason,
                Message = "Document rejected"
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error rejecting document {DocumentId}", documentId);
            return ApprovalResult.Fail(ex.Message);
        }
    }

    public async Task<object?> GetApprovalStatusAsync(Guid documentId, Guid versionId)
    {
        try
        {
            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(v => v.VersionId == versionId && v.DocumentId == documentId);

            if (version == null)
                return null;

            var submittedBy = version.SubmittedById.HasValue
                ? await context.Users.FirstOrDefaultAsync(u => u.UserId == version.SubmittedById)
                : null;

            var approvedBy = version.ApprovedById.HasValue
                ? await context.Users.FirstOrDefaultAsync(u => u.UserId == version.ApprovedById)
                : null;

            return new
            {
                version.VersionId,
                version.DocumentId,
                version.VersionNumber,
                Status = version.Status,
                SubmittedBy = submittedBy?.FullName,
                SubmittedAt = version.SubmittedAt,
                ApprovedBy = approvedBy?.FullName,
                ApprovedAt = version.ApprovedAt,
                ApprovalComment = version.ApprovalComment,
                IsPending = version.Status == "pending_approval",
                IsApproved = version.Status == "released",
                IsRejected = version.Status == "rejected"
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting approval status for version {VersionId}", versionId);
            return null;
        }
    }

    public async Task<List<object>> GetPendingApprovalsAsync(Guid? folderId = null, int limit = 100)
    {
        try
        {
            var query = context.DocumentVersions
                .Where(v => v.Status == "pending_approval");

            if (folderId.HasValue)
            {
                query = query.Where(v => v.Document.FolderId == folderId);
            }

            var pending = await query
                .OrderByDescending(v => v.SubmittedAt)
                .Take(limit)
                .Select(v => new
                {
                    v.VersionId,
                    v.DocumentId,
                    v.Document.Title,
                    v.VersionNumber,
                    v.Status,
                    SubmittedBy = v.SubmittedBy == null ? null : v.SubmittedBy.FullName,
                    v.SubmittedAt,
                    v.Document.FolderId
                })
                .ToListAsync();

            return pending.Cast<object>().ToList();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting pending approvals");
            return new List<object>();
        }
    }
}

public class ApprovalResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }

    public static ApprovalResult Ok(object data) => new() { Success = true, Data = data };
    public static ApprovalResult NotFound(string message) => new() { Success = false, Message = message, Error = "NotFound" };
    public static ApprovalResult Invalid(string message) => new() { Success = false, Message = message, Error = "Invalid" };
    public static ApprovalResult Fail(string message) => new() { Success = false, Message = message, Error = "InternalError" };
}
