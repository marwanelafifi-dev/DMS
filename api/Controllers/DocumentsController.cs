using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DocumentsController(
    DmsContext context,
    MinioService minioService,
    AuditService auditService,
    CheckoutService checkoutService,
    ApprovalService approvalService,
    AccessOverrideService accessOverrideService,
    NotificationService notificationService,
    IHttpClientFactory httpClientFactory,
    ILogger<DocumentsController> logger) : BaseController
{
    private const string LegacyMigrationDeleteBlockedMessage =
        "This document has protected legacy migration history and cannot be permanently deleted.";

    private enum DocumentDeleteStatus
    {
        Deleted,
        NotFound,
        ProtectedLegacyDocument,
    }

    private static readonly HashSet<string> PdfPreviewExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".doc", ".docx", ".docm",
        ".ppt", ".pptx", ".pptm", ".pot", ".potx", ".potm", ".pps", ".ppsx", ".ppsm", ".ppam",
        ".xls", ".xlsm", ".xlsb", ".xlt", ".xltm",
    };

    // GET /api/documents — list of documents
    [HttpGet]
    public async Task<ActionResult<object>> GetDocuments(
        [FromQuery] Guid? folderId,
        [FromQuery] string? search = null)
    {
        try
        {
            var accessibleFolderIds = await GetAccessibleFolderIdsAsync(context, GetCurrentUserId(), accessOverrideService);

            var query = context.Documents.AsQueryable();
            if (accessibleFolderIds != null)
                query = query.Where(d => accessibleFolderIds.Contains(d.FolderId));

            if (folderId.HasValue)
                query = query.Where(d => d.FolderId == folderId);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var searchTerm = search.Trim();
                query = query.Where(d => EF.Functions.ILike(d.Title, $"%{searchTerm}%"));
            }

            var documents = await (
                from document in query
                join version in context.DocumentVersions
                    on document.CurrentVersionId equals (Guid?)version.VersionId into currentVersions
                from currentVersion in currentVersions.DefaultIfEmpty()
                join checkedOutUser in context.Users
                    on currentVersion.CheckedOutById equals (Guid?)checkedOutUser.UserId into checkedOutUsers
                from checkedOutUser in checkedOutUsers.DefaultIfEmpty()
                orderby document.Title
                select new
                {
                    document.DocumentId,
                    Name = document.Title,
                    document.Title,
                    document.Status,
                    document.Description,
                    document.Tags,
                    document.Department,
                    document.Category,
                    document.OriginalDocumentId,
                    HasDocId = !string.IsNullOrWhiteSpace(document.OriginalDocumentId),
                    document.TrackingCode,
                    document.OwnerId,
                    UploadedBy = document.OwnerId,
                    document.FolderId,
                    document.CurrentVersionId,
                    FileName = currentVersion == null ? string.Empty : currentVersion.FileName,
                    FileSize = currentVersion == null ? 0 : currentVersion.FileSizeBytes,
                    ContentType = currentVersion == null ? null : currentVersion.MimeType,
                    VersionLabel = currentVersion == null ? null : currentVersion.VersionLabel,
                    CheckoutStatus = currentVersion != null && currentVersion.IsCheckedOut ? "checked_out" : "checked_in",
                    CheckedOutBy = currentVersion == null ? null : currentVersion.CheckedOutById,
                    CheckedOutByName = checkedOutUser == null ? null : checkedOutUser.FullName,
                    CheckedOutAt = currentVersion == null ? null : currentVersion.CheckedOutAt,
                    UploadedAt = document.CreatedAt,
                    document.CreatedAt,
                    document.UpdatedAt
                })
                .ToListAsync();

            // Each dms_approval_documents row now carries its own stage/status directly (see
            // 058_approval_document_stage_tracking.sql) — no join to dms_approvals needed.
            // document.Status only ever says the generic "pending_approval", it never advances
            // stage-by-stage, which is why this exists at all. Fetched separately (not joined
            // above) because a document can have no approval at all, and EF's client-eval of
            // "latest per version" reads more clearly as a plain lookup than as a correlated
            // subquery inside the big projection.
            var currentVersionIds = documents.Where(d => d.CurrentVersionId.HasValue).Select(d => d.CurrentVersionId!.Value).ToList();
            var approvalsByVersionId = await context.ApprovalDocuments
                .Where(ad => currentVersionIds.Contains(ad.VersionId))
                .Select(ad => new { ad.VersionId, ad.CurrentStage, ad.Status, ad.CreatedAt })
                .ToListAsync();
            var latestApprovalByVersionId = approvalsByVersionId
                .GroupBy(a => a.VersionId)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(a => a.CreatedAt).First());

            var documentsWithStage = documents.Select(d => new
            {
                d.DocumentId, d.Name, d.Title, d.Status, d.Description, d.Tags, d.Department, d.Category,
                d.OriginalDocumentId, d.HasDocId, d.TrackingCode, d.OwnerId, d.UploadedBy, d.FolderId, d.CurrentVersionId,
                d.FileName, d.FileSize, d.ContentType, d.VersionLabel, d.CheckoutStatus, d.CheckedOutBy, d.CheckedOutByName,
                d.CheckedOutAt, d.UploadedAt, d.CreatedAt, d.UpdatedAt,
                ApprovalStage = d.CurrentVersionId.HasValue && latestApprovalByVersionId.TryGetValue(d.CurrentVersionId.Value, out var approval) ? approval.CurrentStage : null,
                ApprovalStatus = d.CurrentVersionId.HasValue && latestApprovalByVersionId.TryGetValue(d.CurrentVersionId.Value, out var approval2) ? approval2.Status : null,
            }).ToList();

            logger.LogInformation("Retrieved {Count} documents", documents.Count);
            return Ok(new { success = true, data = documentsWithStage, count = documentsWithStage.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving documents");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/{id} — document details
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetDocument(Guid id)
    {
        try
        {
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            var versions = await context.DocumentVersions
                .Where(v => v.DocumentId == id)
                .Select(v => new
                {
                    v.VersionId,
                    v.VersionNumber,
                    v.VersionLabel,
                    v.Status,
                    v.FileName,
                    v.FileSizeBytes,
                    v.MimeType,
                    v.IsCheckedOut,
                    v.CheckedOutById,
                    v.CheckedOutAt,
                    v.CreatedAt
                })
                .OrderByDescending(v => v.CreatedAt)
                .ToListAsync();

            var currentVersion = versions.FirstOrDefault(v => v.VersionId == document.CurrentVersionId)
                ?? versions.FirstOrDefault();

            string? checkedOutByName = null;
            if (currentVersion?.CheckedOutById != null)
            {
                checkedOutByName = await context.Users
                    .Where(u => u.UserId == currentVersion.CheckedOutById)
                    .Select(u => u.FullName)
                    .FirstOrDefaultAsync();
            }

            string? approvalStage = null;
            string? approvalStatus = null;
            if (currentVersion != null)
            {
                var latestApproval = await context.ApprovalDocuments
                    .Where(ad => ad.VersionId == currentVersion.VersionId)
                    .OrderByDescending(ad => ad.CreatedAt)
                    .FirstOrDefaultAsync();
                approvalStage = latestApproval?.CurrentStage;
                approvalStatus = latestApproval?.Status;
            }

            logger.LogInformation("Retrieved document {DocumentId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    document.DocumentId,
                    Name = document.Title,
                    document.Title,
                    document.Status,
                    document.Description,
                    document.Tags,
                    document.Department,
                    document.Category,
                    document.OriginalDocumentId,
                    HasDocId = !string.IsNullOrWhiteSpace(document.OriginalDocumentId),
                    document.TrackingCode,
                    document.OwnerId,
                    UploadedBy = document.OwnerId,
                    document.FolderId,
                    document.CurrentVersionId,
                    FileName = currentVersion?.FileName ?? string.Empty,
                    FileSize = currentVersion?.FileSizeBytes ?? 0,
                    ContentType = currentVersion?.MimeType,
                    VersionLabel = currentVersion?.VersionLabel,
                    CheckoutStatus = currentVersion?.IsCheckedOut == true ? "checked_out" : "checked_in",
                    CheckedOutBy = currentVersion?.CheckedOutById,
                    CheckedOutByName = checkedOutByName,
                    CheckedOutAt = currentVersion?.CheckedOutAt,
                    UploadedAt = document.CreatedAt,
                    Versions = versions,
                    VersionCount = versions.Count,
                    ApprovalStage = approvalStage,
                    ApprovalStatus = approvalStatus,
                    document.CreatedAt,
                    document.UpdatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/{id}/legacy-metadata-history — immutable metadata
    // evidence imported from KnowledgeTree. This stays deliberately separate
    // from the New-DMS Versions collection returned by GetDocument above.
    // RBACMiddleware treats this GET exactly like opening the document itself:
    // the caller must have the document's FileRead/ViewOnly permission.
    [HttpGet("{id}/legacy-metadata-history")]
    public async Task<ActionResult<object>> GetLegacyMetadataHistory(Guid id)
    {
        try
        {
            // Resolve from the New-DMS UUID supplied in the route. Never accept
            // a legacy document id from the caller, which could otherwise be
            // used to probe a different document's archive.
            var mapping = await context.LegacyDocumentMappings
                .AsNoTracking()
                .Where(item => item.NewDocumentId == id)
                .Select(item => new
                {
                    item.SourceSystem,
                    item.LegacyDocumentId,
                    item.ActiveLegacyContentVersionId,
                    item.ActiveNewVersionId,
                })
                .SingleOrDefaultAsync();

            if (mapping == null)
            {
                return Ok(new
                {
                    success = true,
                    data = new
                    {
                        HasLegacyMetadataHistory = false,
                        LegacyDocumentId = (long?)null,
                        SourceSystem = (string?)null,
                        Snapshots = Array.Empty<object>(),
                    }
                });
            }

            var archivedSnapshots = await context.LegacyMetadataSnapshots
                .AsNoTracking()
                .Where(snapshot =>
                    snapshot.SourceSystem == mapping.SourceSystem &&
                    snapshot.LegacyDocumentId == mapping.LegacyDocumentId)
                .OrderByDescending(snapshot => snapshot.MetadataSequence)
                .ThenByDescending(snapshot => snapshot.LegacyMetadataVersionId)
                .ToListAsync();

            // Join each metadata snapshot through its real KnowledgeTree
            // content_version_id. Do not derive a file from metadata sequence:
            // several snapshots can correctly point at the same content row.
            var linkedContentIds = archivedSnapshots
                .Where(snapshot => snapshot.LegacyContentVersionId.HasValue)
                .Select(snapshot => snapshot.LegacyContentVersionId!.Value)
                .Distinct()
                .ToList();
            var contentById = await context.LegacyContentVersions
                .AsNoTracking()
                .Where(content =>
                    content.SourceSystem == mapping.SourceSystem &&
                    content.LegacyDocumentId == mapping.LegacyDocumentId &&
                    linkedContentIds.Contains(content.LegacyContentVersionId))
                .ToDictionaryAsync(content => content.LegacyContentVersionId);
            var fileDateByContentId = await context.LegacyContentFileDetails
                .AsNoTracking()
                .Where(detail =>
                    detail.SourceSystem == mapping.SourceSystem &&
                    linkedContentIds.Contains(detail.LegacyContentVersionId))
                .ToDictionaryAsync(
                    detail => detail.LegacyContentVersionId,
                    detail => detail.SourceFileModifiedAt);
            var activeVersion = await context.DocumentVersions
                .AsNoTracking()
                .Where(version => version.VersionId == mapping.ActiveNewVersionId && version.DocumentId == id)
                .SingleOrDefaultAsync();

            var snapshots = archivedSnapshots.Select(snapshot => new
            {
                MetadataVersionId = snapshot.LegacyMetadataVersionId,
                MetadataVersion = snapshot.MetadataSequence,
                SnapshotDate = snapshot.SnapshotCreatedAt,
                LegacyContentVersionId = snapshot.LegacyContentVersionId,
                IsCurrentAtMigration = snapshot.IsCurrentSnapshot,
                snapshot.SourceSystem,
                AssociatedFile = snapshot.LegacyContentVersionId.HasValue &&
                    contentById.TryGetValue(snapshot.LegacyContentVersionId.Value, out var content)
                        ? BuildLegacyAssociatedFile(
                            id,
                            mapping.ActiveLegacyContentVersionId,
                            content,
                            fileDateByContentId.GetValueOrDefault(content.LegacyContentVersionId),
                            activeVersion)
                        : null,
                Fields = BuildLegacyMetadataFields(snapshot),
            }).ToList();

            logger.LogInformation(
                "Retrieved {Count} legacy metadata snapshots for document {DocumentId} (legacy {LegacyDocumentId})",
                snapshots.Count,
                id,
                mapping.LegacyDocumentId);

            return Ok(new
            {
                success = true,
                data = new
                {
                    HasLegacyMetadataHistory = snapshots.Count > 0,
                    mapping.LegacyDocumentId,
                    mapping.SourceSystem,
                    Snapshots = snapshots,
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving legacy metadata history for document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = "Failed to load legacy metadata history" });
        }
    }

    // GET /api/documents/{id}/legacy-content/{contentVersionId}/view
    // Historical bytes are read only from the Legacy Archive namespace. The
    // current-at-migration content is read from its normal current New-DMS
    // version. Neither route creates a New-DMS version/history row.
    [HttpGet("{id}/legacy-content/{contentVersionId:long}/view")]
    public async Task<ActionResult> ViewLegacyContent(Guid id, long contentVersionId)
    {
        var target = await ResolveLegacyContentTargetAsync(id, contentVersionId);
        if (target == null)
            return NotFound(new { success = false, error = "Legacy content file is not available for this document" });

        try
        {
            var stream = await minioService.DownloadAsync(target.ObjectKey);
            return new FileStreamResult(stream, LegacyContentType(target.FileName))
            {
                EnableRangeProcessing = true,
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to view legacy content {ContentVersionId} for document {DocumentId}", contentVersionId, id);
            return StatusCode(500, new { success = false, error = "Legacy archive file could not be read" });
        }
    }

    // GET /api/documents/{id}/legacy-content/{contentVersionId}/download
    [HttpGet("{id}/legacy-content/{contentVersionId:long}/download")]
    public async Task<ActionResult> DownloadLegacyContent(Guid id, long contentVersionId)
    {
        var target = await ResolveLegacyContentTargetAsync(id, contentVersionId);
        if (target == null)
            return NotFound(new { success = false, error = "Legacy content file is not available for this document" });

        try
        {
            var stream = await minioService.DownloadAsync(target.ObjectKey);
            return new FileStreamResult(stream, LegacyContentType(target.FileName))
            {
                FileDownloadName = target.FileName,
                EnableRangeProcessing = true,
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to download legacy content {ContentVersionId} for document {DocumentId}", contentVersionId, id);
            return StatusCode(500, new { success = false, error = "Legacy archive file could not be read" });
        }
    }

    private async Task<LegacyContentTarget?> ResolveLegacyContentTargetAsync(Guid documentId, long contentVersionId)
    {
        // Resolve through the caller-visible New-DMS document UUID first, then
        // constrain the content row to the same source document. A content ID
        // copied from another document can never cross this boundary.
        var mapping = await context.LegacyDocumentMappings
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.NewDocumentId == documentId);
        if (mapping == null)
            return null;

        var content = await context.LegacyContentVersions
            .AsNoTracking()
            .SingleOrDefaultAsync(item =>
                item.SourceSystem == mapping.SourceSystem &&
                item.LegacyDocumentId == mapping.LegacyDocumentId &&
                item.LegacyContentVersionId == contentVersionId);
        if (content == null)
            return null;

        if (content.PhysicalFileStatus == "archived" && !string.IsNullOrWhiteSpace(content.ArchiveObjectKey))
            return new LegacyContentTarget(content.ArchiveObjectKey, content.OriginalFilename);

        if (content.PhysicalFileStatus == "active_in_new_dms" &&
            content.LegacyContentVersionId == mapping.ActiveLegacyContentVersionId)
        {
            var version = await context.DocumentVersions
                .AsNoTracking()
                .SingleOrDefaultAsync(item =>
                    item.VersionId == mapping.ActiveNewVersionId &&
                    item.DocumentId == documentId);
            if (version != null && !string.IsNullOrWhiteSpace(version.S3ObjectKey))
                return new LegacyContentTarget(version.S3ObjectKey, content.OriginalFilename);
        }

        return null;
    }

    private static LegacyAssociatedFile BuildLegacyAssociatedFile(
        Guid documentId,
        long activeLegacyContentVersionId,
        DmsLegacyContentVersion content,
        DateTime? fileDate,
        DmsDocumentVersion? activeVersion)
    {
        var isArchivedAvailable = content.PhysicalFileStatus == "archived" &&
            !string.IsNullOrWhiteSpace(content.ArchiveObjectKey);
        var isActiveAvailable = content.PhysicalFileStatus == "active_in_new_dms" &&
            content.LegacyContentVersionId == activeLegacyContentVersionId &&
            activeVersion != null &&
            !string.IsNullOrWhiteSpace(activeVersion.S3ObjectKey);
        var isAvailable = isArchivedAvailable || isActiveAvailable;
        var fileStatus = content.PhysicalFileStatus switch
        {
            "archived" when isArchivedAvailable => "Available in Legacy Archive",
            "active_in_new_dms" when isActiveAvailable => "Available as migrated current file",
            "source_file_missing" => "Not available in legacy export",
            "source_file_zero_byte" => "Not available: zero-byte legacy export file",
            "source_md5_mismatch" => "Not available: legacy MD5 mismatch",
            _ => "Not available in legacy export",
        };
        var baseUrl = $"/api/documents/{documentId}/legacy-content/{content.LegacyContentVersionId}";

        return new LegacyAssociatedFile(
            content.LegacyContentVersionId,
            content.OriginalFilename,
            content.MajorVersion,
            content.MinorVersion,
            $"{content.MajorVersion}.{content.MinorVersion}",
            fileDate,
            content.SourceSizeBytes,
            fileStatus,
            isAvailable,
            isAvailable ? $"{baseUrl}/view" : null,
            isAvailable ? $"{baseUrl}/download" : null);
    }

    private static string LegacyContentType(string fileName) => Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".pdf" => "application/pdf",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".txt" => "text/plain",
        ".csv" => "text/csv",
        ".doc" => "application/msword",
        ".docx" or ".docm" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls" => "application/vnd.ms-excel",
        ".xlsx" or ".xlsm" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".ppt" => "application/vnd.ms-powerpoint",
        ".pptx" or ".pptm" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    };

    private static IReadOnlyList<LegacyMetadataField> BuildLegacyMetadataFields(
        DmsLegacyMetadataSnapshot snapshot)
    {
        var fields = new List<LegacyMetadataField>();
        var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (snapshot.RawMetadata.RootElement.ValueKind == JsonValueKind.Object &&
            snapshot.RawMetadata.RootElement.TryGetProperty("fields", out var rawFields) &&
            rawFields.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in rawFields.EnumerateObject())
            {
                // Keep every archived key, including unknown names and keys
                // whose value was empty. The current DMS metadata schema must
                // never decide what is visible in this evidence view.
                fields.Add(new LegacyMetadataField(property.Name, LegacyFieldValue(property.Value)));
                seenNames.Add(property.Name);
            }
        }

        AddLegacyFieldIfMissing(fields, seenNames, "Title", snapshot.Title);
        AddLegacyFieldIfMissing(fields, seenNames, "Description", snapshot.Description);
        AddLegacyFieldIfMissing(fields, seenNames, "Authors", snapshot.OriginalAuthors);
        AddLegacyFieldIfMissing(fields, seenNames, "Group", snapshot.LegacyGroup);
        AddLegacyFieldIfMissing(fields, seenNames, "Internal/External", snapshot.InternalExternal);
        AddLegacyFieldIfMissing(fields, seenNames, "IP number", snapshot.IpNumber);
        AddLegacyFieldIfMissing(fields, seenNames, "Tag", snapshot.LegacyTags);
        AddLegacyFieldIfMissing(fields, seenNames, "Document #", snapshot.OriginalDocumentNumber);
        AddLegacyFieldIfMissing(fields, seenNames, "Document Type", snapshot.LegacyDocumentType);

        // document_metadata_version.description is a separate KnowledgeTree
        // base column. When a custom "Description" field also existed and had
        // a different value, both are historical evidence and both must remain
        // visible instead of allowing the custom field to mask the base value.
        if (snapshot.RawMetadata.RootElement.ValueKind == JsonValueKind.Object &&
            snapshot.RawMetadata.RootElement.TryGetProperty("descriptionColumn", out var descriptionColumnElement))
        {
            var descriptionColumn = LegacyFieldValue(descriptionColumnElement);
            var displayedDescription = fields.FirstOrDefault(field =>
                field.Name.Equals("Description", StringComparison.OrdinalIgnoreCase))?.Value;
            if (descriptionColumn != null &&
                !string.Equals(descriptionColumn, displayedDescription, StringComparison.Ordinal))
            {
                fields.Add(new LegacyMetadataField("Legacy description column", descriptionColumn));
            }
        }

        // Put familiar KnowledgeTree labels first while retaining every raw
        // field (and the original order among unknown fields).
        return fields
            .Select((field, index) => new { field, index })
            .OrderBy(item => LegacyFieldPriority(item.field.Name))
            .ThenBy(item => item.index)
            .Select(item => item.field)
            .ToList();
    }

    private static void AddLegacyFieldIfMissing(
        ICollection<LegacyMetadataField> fields,
        ISet<string> seenNames,
        string name,
        string? value)
    {
        if (value == null || seenNames.Contains(name))
            return;

        fields.Add(new LegacyMetadataField(name, value));
        seenNames.Add(name);
    }

    private static string? LegacyFieldValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.String => value.GetString(),
        _ => value.GetRawText(),
    };

    private static int LegacyFieldPriority(string name) => name.ToUpperInvariant() switch
    {
        "TITLE" => 0,
        "AUTHORS" => 1,
        "GROUP" => 2,
        "DESCRIPTION" => 3,
        "LEGACY DESCRIPTION COLUMN" => 4,
        "INTERNAL/EXTERNAL" => 5,
        "IP NUMBER" => 6,
        "TAG" => 7,
        "DOCUMENT #" => 8,
        "DOCUMENT TYPE" => 9,
        _ => 100,
    };

    // POST /api/documents — create a document without a file
    [HttpPost]
    public async Task<ActionResult<object>> CreateDocument([FromBody] CreateDocumentRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();

            // Validate input. The upload form has always required Description/
            // Category/Department client-side, but nothing enforced it here —
            // a direct API call could create a document with none of them set
            // at all. Matches the frontend's own required-field set exactly.
            if (string.IsNullOrWhiteSpace(req.Title))
                return BadRequest(new { success = false, error = "Document title is required" });
            if (string.IsNullOrWhiteSpace(req.Description))
                return BadRequest(new { success = false, error = "Description is required" });
            if (string.IsNullOrWhiteSpace(req.Category))
                return BadRequest(new { success = false, error = "Category is required" });
            if (string.IsNullOrWhiteSpace(req.Department))
                return BadRequest(new { success = false, error = "Department is required" });

            // Verify the folder exists
            var folderExists = await context.Folders
                .AnyAsync(f => f.FolderId == req.FolderId);

            if (!folderExists)
                return BadRequest(new { success = false, error = "Folder not found" });

            // POST /api/documents has no document ID in the path yet (nothing to
            // exist to gate on), so RBACMiddleware never sees this request —
            // check the dynamic Upload flag here instead, same pattern as
            // FoldersController.CreateFolder / TasksController.CreateTask.
            var folderPermission = await context.FolderPermissions
                .FirstOrDefaultAsync(p => p.FolderId == req.FolderId && p.UserId == userId);
            var effectiveRole = folderPermission?.Role ?? await GetEffectiveRoleAsync(context, userId, req.FolderId);
            var roleAllowsUpload = await HasRolePermissionAsync(context, effectiveRole, rp => rp.Upload);

            if (!await accessOverrideService.ResolveAsync(userId, null, req.FolderId, AccessOverrideActions.Write, roleAllowsUpload))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = false,
                    error = "Your role does not have Upload permission in this folder"
                });
            }

            var ownerExists = await context.Users
                .AnyAsync(u => u.UserId == req.OwnerId && u.IsActive);

            if (!ownerExists)
                return BadRequest(new { success = false, error = "Owner not found" });

            // Document ID at upload time is System Admin only — QA only gets access to
            // it later, at First Review (see ApprovalsController.RequireQaOrAdminForApprovalAsync).
            var isAdmin = effectiveRole is FolderRoles.Admin;
            if (!string.IsNullOrWhiteSpace(req.OriginalDocumentId) && !isAdmin)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = false,
                    error = "Only System Admin can set the Document ID directly"
                });
            }

            if (isAdmin && !string.IsNullOrWhiteSpace(req.OriginalDocumentId) && await IsDocIdTakenAsync(req.OriginalDocumentId))
                return BadRequest(new { success = false, error = $"Document ID \"{req.OriginalDocumentId.Trim()}\" is already used by another document" });

            var document = new DmsDocument
            {
                DocumentId = Guid.NewGuid(),
                FolderId = req.FolderId,
                Title = req.Title.Trim(),
                Status = "draft",
                Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
                Tags = req.Tags?.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()).ToArray() ?? Array.Empty<string>(),
                Department = string.IsNullOrWhiteSpace(req.Department) ? null : req.Department.Trim(),
                Category = string.IsNullOrWhiteSpace(req.Category) ? null : req.Category.Trim(),
                OriginalDocumentId = isAdmin && !string.IsNullOrWhiteSpace(req.OriginalDocumentId) ? req.OriginalDocumentId.Trim() : null,
                OwnerId = req.OwnerId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            context.Documents.Add(document);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, DOCUMENT_CREATED, new
            {
                document.DocumentId,
                document.Title,
                document.FolderId,
                document.Status,
                document.OwnerId,
                document.CreatedAt
            });

            logger.LogInformation("Created document {DocumentId}", document.DocumentId);

            return CreatedAtAction(nameof(GetDocument), new { id = document.DocumentId }, new
            {
                success = true,
                data = new
                {
                    document.DocumentId,
                    document.Title,
                    document.Status,
                    document.Description,
                    document.CreatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating document");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Automatic Document ID extraction (runs right after upload, once the frontend's
    /// existing Docling/OCR pass has produced extracted text). Any Writer+ can trigger
    /// this — it's detection, not authorization-sensitive — but it only ever fills in
    /// a blank Document ID, never overwrites one a QA/Admin already set.
    /// </summary>
    [HttpPost("{id}/extract-doc-id")]
    public async Task<ActionResult<object>> ExtractDocId(Guid id, [FromBody] ExtractDocIdRequest req)
    {
        try
        {
            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == id);
            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            if (!string.IsNullOrWhiteSpace(document.OriginalDocumentId))
            {
                return Ok(new { success = true, data = new { found = true, originalDocumentId = document.OriginalDocumentId, alreadySet = true } });
            }

            var extracted = DocIdExtractor.Extract(req.Text);

            // A value already used by another document is treated the same as
            // "nothing found" — this is a low-stakes automatic guess, so rather
            // than error out, leave the field blank and let QA resolve it
            // manually (enter a different ID or generate a fresh sequential one).
            if (extracted != null && await IsDocIdTakenAsync(extracted, id))
                extracted = null;

            if (extracted != null)
            {
                document.OriginalDocumentId = extracted;
                document.UpdatedAt = DateTime.UtcNow;
                await context.SaveChangesAsync();

                await auditService.LogAsync(GetCurrentUserId(), "DOCUMENT_ID_EXTRACTED", new
                {
                    document.DocumentId,
                    originalDocumentId = extracted
                });
            }

            return Ok(new { success = true, data = new { found = extracted != null, originalDocumentId = extracted, alreadySet = false } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error extracting Document ID for {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Manual Document ID entry at QA Triage — QA/Admin only.
    /// </summary>
    [HttpPost("{id}/set-doc-id")]
    public async Task<ActionResult<object>> SetDocId(Guid id, [FromBody] SetDocIdRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.OriginalDocumentId))
                return BadRequest(new { success = false, error = "Document ID is required" });

            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == id);
            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            var roleCheck = await RequireQaOrAdminAsync(document.FolderId);
            if (roleCheck != null) return roleCheck;

            if (await IsDocIdTakenAsync(req.OriginalDocumentId, id))
                return BadRequest(new { success = false, error = $"Document ID \"{req.OriginalDocumentId.Trim()}\" is already used by another document" });

            document.OriginalDocumentId = req.OriginalDocumentId.Trim();
            document.UpdatedAt = DateTime.UtcNow;
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), "DOCUMENT_ID_SET_MANUALLY", new
            {
                document.DocumentId,
                originalDocumentId = document.OriginalDocumentId
            });

            return Ok(new { success = true, data = new { originalDocumentId = document.OriginalDocumentId } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error setting Document ID for {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// System auto-generation of a Document ID at QA Triage — QA/Admin only.
    /// Format: SWS-{n}, where {n} is one more than the highest existing SWS-{n}
    /// Document ID across all documents (e.g. last one on file is SWS-2, so the
    /// next generated one is SWS-3).
    /// </summary>
    [HttpPost("{id}/generate-doc-id")]
    public async Task<ActionResult<object>> GenerateDocId(Guid id)
    {
        try
        {
            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == id);
            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            var roleCheck = await RequireQaOrAdminAsync(document.FolderId);
            if (roleCheck != null) return roleCheck;

            var existingIds = await context.Documents
                .Where(d => d.OriginalDocumentId != null && EF.Functions.ILike(d.OriginalDocumentId, "SWS-%"))
                .Select(d => d.OriginalDocumentId!)
                .ToListAsync();

            var lastNumber = existingIds
                .Select(docId => System.Text.RegularExpressions.Regex.Match(docId, @"^SWS-(\d+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                .Where(match => match.Success)
                .Select(match => int.Parse(match.Groups[1].Value))
                .DefaultIfEmpty(0)
                .Max();

            // The sequence is derived from existing SWS-{n} IDs, so it's normally
            // unique by construction — this loop is just a safety net against a
            // gap (e.g. a manually-entered non-sequential "SWS-{n}" value, or a
            // race with a concurrent request) rather than the expected path.
            var candidateNumber = lastNumber + 1;
            var generated = $"SWS-{candidateNumber}";
            while (await IsDocIdTakenAsync(generated, id))
            {
                candidateNumber += 1;
                generated = $"SWS-{candidateNumber}";
            }

            document.OriginalDocumentId = generated;
            document.UpdatedAt = DateTime.UtcNow;
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), "DOCUMENT_ID_GENERATED", new
            {
                document.DocumentId,
                originalDocumentId = generated
            });

            return Ok(new { success = true, data = new { originalDocumentId = generated } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error generating Document ID for {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // Document ID resolution (manual entry or system-generated) at QA Triage —
    // its own independently-grantable flag (migration 067), decoupled from
    // CanApprove/CanViewQaStage so a role can be given just this one ability
    // without also getting full QA Accept/Reject rights. This used to check
    // the folder-scoped Reader/Writer/Manager/QA/Admin role instead, a
    // leftover from before the Session 27 redesign that moved approval-stage
    // actions onto the page-access-role system — it was simply missed when
    // that redesign happened, so a real QA/Admin user without an unrelated
    // per-folder "QA" grant was wrongly rejected.
    private async Task<ActionResult<object>?> RequireQaOrAdminAsync(Guid folderId)
    {
        var userId = GetCurrentUserId();
        var pageAccessRole = await GetPageAccessRoleAsync(context, userId);

        if (pageAccessRole == null || !pageAccessRole.CanResolveDocumentId)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                error = "Your role does not have permission to resolve Document IDs"
            });
        }

        return null;
    }

    // Doc ID must be unique across every document (case-insensitive) — backed by
    // a DB-level unique index (migration 055) as the hard guarantee; this is the
    // friendly pre-check so a collision surfaces as a clear 400, not a raw
    // Postgres constraint-violation exception.
    private async Task<bool> IsDocIdTakenAsync(string docId, Guid? excludeDocumentId = null)
    {
        var normalized = docId.Trim();
        return await context.Documents.AnyAsync(d =>
            d.OriginalDocumentId != null &&
            d.OriginalDocumentId.ToLower() == normalized.ToLower() &&
            d.DocumentId != excludeDocumentId);
    }

    // POST /api/documents/{id}/upload — upload a file
    [HttpPost("{id}/upload")]
    public async Task<ActionResult<object>> UploadVersion(Guid id, IFormFile file, [FromForm] string? versionLabel = null)
    {
        try
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, error = "File is required" });

            // Both real call sites (the new-document upload form and Upload New
            // Version/Upload Updated File) already require this client-side —
            // enforced here too so a direct API call can't attach a version
            // with no label at all.
            if (string.IsNullOrWhiteSpace(versionLabel))
                return BadRequest(new { success = false, error = "Version label is required" });

            // Verify the document exists
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            // Critical gap found in production: this endpoint let ANY user
            // upload a new version even while another user had the document
            // checked out, silently overwriting the locked edit and defeating
            // the whole point of the checkout lock. A user may only replace
            // the file while it's locked if they're the one holding the lock
            // — full stop, no exception for AdminForceUnlock/Unlock-override
            // here. Having the *capability* to force-unlock must never
            // silently bypass the block; an admin who actually wants to
            // override someone else's lock has to call POST
            // {id}/versions/{versionId}/force-unlock first, which is itself
            // audited (FORCE_UNLOCK) and notifies the document owner — that
            // explicit, logged step is the whole point, not a formality this
            // endpoint could just skip on their behalf.
            var userId = GetCurrentUserId();
            var currentVersion = document.CurrentVersionId.HasValue
                ? await context.DocumentVersions.FirstOrDefaultAsync(v => v.VersionId == document.CurrentVersionId)
                : null;

            if (currentVersion is { IsCheckedOut: true } && currentVersion.CheckedOutById != userId)
            {
                var lockedByName = await context.Users
                    .Where(u => u.UserId == currentVersion.CheckedOutById)
                    .Select(u => u.FullName)
                    .FirstOrDefaultAsync();
                return StatusCode(StatusCodes.Status423Locked, new
                {
                    success = false,
                    error = $"This document is locked for editing by {lockedByName ?? "another user"} — force-unlock it first if you need to override their lock."
                });
            }

            // Compute the SHA256 hash of the file
            string sha256Hash;
            using (var sha256 = SHA256.Create())
            {
                var hash = await sha256.ComputeHashAsync(file.OpenReadStream());
                sha256Hash = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
            }

            // Reset the stream
            file.OpenReadStream().Seek(0, SeekOrigin.Begin);

            // dms_document_versions has a unique (document_id, version_number)
            // constraint — hardcoding "1.0" only worked because this endpoint
            // was previously only ever called once per document, at creation.
            // Now that re-uploading a new version of an existing document is a
            // real action (releases a checkout lock), each call must bump the
            // version number instead of colliding with the first upload.
            var nextMajorVersion = 1 + await context.DocumentVersions
                .Where(v => v.DocumentId == id)
                .Select(v => (int?)v.MajorVersion)
                .MaxAsync() ?? 1;

            // Create a new version
            var version = new DmsDocumentVersion
            {
                VersionId = Guid.NewGuid(),
                DocumentId = id,
                VersionNumber = $"{nextMajorVersion}.0",
                VersionLabel = string.IsNullOrWhiteSpace(versionLabel) ? null : versionLabel.Trim(),
                MajorVersion = nextMajorVersion,
                MinorVersion = 0,
                FileName = file.FileName,
                FileSizeBytes = file.Length,
                MimeType = file.ContentType,
                Sha256Hash = sha256Hash,
                Status = "draft",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            // Upload the file to MinIO
            var objectKey = $"documents/{id}/{version.VersionId}/{file.FileName}";
            await minioService.UploadAsync(
                objectKey,
                file.OpenReadStream(),
                file.ContentType ?? "application/octet-stream");

            version.S3ObjectKey = objectKey;

            // Save to the database
            context.DocumentVersions.Add(version);
            document.CurrentVersionId = version.VersionId;
            document.UpdatedAt = DateTime.UtcNow;

            // Real bug found live: dms_approval_documents.version_id is a
            // point-in-time snapshot of whichever version was in review when
            // the approval batch/stage started — the task-resubmit and
            // Manager-self-correct paths already knew to re-point it at the
            // freshly-uploaded version, but this generic "just attach a new
            // version" endpoint never did. Any document re-uploaded through
            // this path (Document Library's own Upload New Version, not via
            // a task correction) while an approval was still in progress
            // (Status != "approved") drifted CurrentVersionId away from the
            // version the approval row actually points at — the Document
            // Library's stage lookup, keyed by CurrentVersionId, then finds
            // no match at all and silently falls back to a stale/default
            // "QA Review" label even though the real stage had already
            // advanced further. Re-point it here too, leaving the stage/
            // status/notes exactly as they were — this endpoint isn't a
            // review decision, just a newer file for whatever's already
            // in flight.
            var activeApprovalDocuments = await context.ApprovalDocuments
                .Where(ad => ad.DocumentId == id && ad.Status != "approved")
                .ToListAsync();
            foreach (var activeApprovalDocument in activeApprovalDocuments)
                activeApprovalDocument.VersionId = version.VersionId;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, DOCUMENT_UPLOADED, new
            {
                version.VersionId,
                document.DocumentId,
                version.FileName,
                version.FileSizeBytes,
                version.Sha256Hash,
                version.MimeType,
                version.CreatedAt
            });

            logger.LogInformation("Uploaded file to document {DocumentId}", id);

            if (currentVersion is { IsCheckedOut: true })
                await notificationService.NotifyDocumentOwnerAsync(id, userId, "Your document was unlocked", "The updated file was uploaded, releasing the editing lock.");

            return Ok(new
            {
                success = true,
                data = new
                {
                    version.VersionId,
                    version.FileName,
                    version.FileSizeBytes,
                    version.Sha256Hash,
                    version.S3ObjectKey,
                    version.CreatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error uploading file to document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/documents/{id}/versions/{versionId}/revert — make an older
    // version current again. This never rewrites or deletes history — it
    // creates a brand-new version row that reuses the target version's
    // already-uploaded file (same S3ObjectKey, so no re-upload/copy needed)
    // and becomes the new current version, exactly like uploading that same
    // file again would.
    [HttpPost("{id}/versions/{versionId}/revert")]
    public async Task<ActionResult<object>> RevertToVersion(Guid id, Guid versionId)
    {
        try
        {
            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == id);
            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            var targetVersion = await context.DocumentVersions.FirstOrDefaultAsync(v => v.VersionId == versionId && v.DocumentId == id);
            if (targetVersion == null)
                return NotFound(new { success = false, error = "Version not found" });

            if (targetVersion.VersionId == document.CurrentVersionId)
                return BadRequest(new { success = false, error = "This is already the current version" });

            // Same lock check as uploading a new version — reverting replaces
            // the current version's content just like a fresh upload would.
            // No AdminForceUnlock exception here either — see the matching
            // note in UploadVersion above; force-unlock must be its own
            // explicit, audited step, never silently implied by this call.
            var userId = GetCurrentUserId();
            var currentVersion = document.CurrentVersionId.HasValue
                ? await context.DocumentVersions.FirstOrDefaultAsync(v => v.VersionId == document.CurrentVersionId)
                : null;

            if (currentVersion is { IsCheckedOut: true } && currentVersion.CheckedOutById != userId)
                return StatusCode(StatusCodes.Status423Locked, new { success = false, error = "This document is locked for editing by another user — force-unlock it first if you need to override their lock." });

            var nextMajorVersion = 1 + await context.DocumentVersions
                .Where(v => v.DocumentId == id)
                .Select(v => (int?)v.MajorVersion)
                .MaxAsync() ?? 1;

            // Copying the target's own label verbatim (the old behavior) made a
            // revert look like a plain duplicate of that old entry instead of a
            // new, distinct restore — keep the original label's own name but
            // mark clearly which version it was restored from; the row's own
            // CreatedAt (already shown next to the label everywhere versions are
            // listed) is the actual restore timestamp, so it isn't duplicated here.
            var restoredLabel = string.IsNullOrWhiteSpace(targetVersion.VersionLabel)
                ? $"Restored from v{targetVersion.VersionNumber}"
                : $"{targetVersion.VersionLabel} (Restored from v{targetVersion.VersionNumber})";

            var revertedVersion = new DmsDocumentVersion
            {
                VersionId = Guid.NewGuid(),
                DocumentId = id,
                VersionNumber = $"{nextMajorVersion}.0",
                VersionLabel = restoredLabel,
                MajorVersion = nextMajorVersion,
                MinorVersion = 0,
                FileName = targetVersion.FileName,
                FileSizeBytes = targetVersion.FileSizeBytes,
                MimeType = targetVersion.MimeType,
                S3ObjectKey = targetVersion.S3ObjectKey,
                Sha256Hash = targetVersion.Sha256Hash,
                Status = "draft",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            context.DocumentVersions.Add(revertedVersion);
            document.CurrentVersionId = revertedVersion.VersionId;
            document.UpdatedAt = DateTime.UtcNow;

            // Same re-pointing as UploadVersion above — a revert while an
            // approval is still in progress must not leave it referencing a
            // version that's no longer current.
            var activeApprovalDocumentsForRevert = await context.ApprovalDocuments
                .Where(ad => ad.DocumentId == id && ad.Status != "approved")
                .ToListAsync();
            foreach (var activeApprovalDocument in activeApprovalDocumentsForRevert)
                activeApprovalDocument.VersionId = revertedVersion.VersionId;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, DOCUMENT_VERSION_REVERTED, new
            {
                document.DocumentId,
                RevertedFromVersionId = targetVersion.VersionId,
                RevertedFromVersionNumber = targetVersion.VersionNumber,
                NewVersionId = revertedVersion.VersionId,
                NewVersionNumber = revertedVersion.VersionNumber,
            });

            logger.LogInformation("Reverted document {DocumentId} to version {VersionNumber}", id, targetVersion.VersionNumber);

            await notificationService.NotifyDocumentOwnerAsync(id, userId, "Your document was reverted", $"Reverted to version {targetVersion.VersionNumber}.");

            return Ok(new
            {
                success = true,
                data = new
                {
                    revertedVersion.VersionId,
                    revertedVersion.VersionNumber,
                    revertedVersion.FileName,
                    revertedVersion.CreatedAt,
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error reverting document {DocumentId} to version {VersionId}", id, versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/{id}/download — download a file
    // The browser receives only the generated PDF, not the original file plus
    // a second browser-to-renderer upload.
    [HttpGet("{id}/versions/{versionId}/preview")]
    public async Task<ActionResult> PreviewVersion(Guid id, Guid versionId, CancellationToken cancellationToken)
    {
        try
        {
            var version = await context.DocumentVersions
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    dv => dv.VersionId == versionId && dv.DocumentId == id,
                    cancellationToken);

            if (version == null)
                return NotFound(new { success = false, error = "Version not found" });

            if (string.IsNullOrEmpty(version.S3ObjectKey))
                return BadRequest(new { success = false, error = "File has not been uploaded yet" });

            if (!PdfPreviewExtensions.Contains(Path.GetExtension(version.FileName)))
                return StatusCode(StatusCodes.Status415UnsupportedMediaType, new
                {
                    success = false,
                    error = "This file type does not use the generated PDF preview endpoint",
                });

            await using var sourceStream = await minioService.DownloadAsync(version.S3ObjectKey);
            using var multipart = new MultipartFormDataContent();
            using var fileContent = new StreamContent(sourceStream);
            if (MediaTypeHeaderValue.TryParse(version.MimeType, out var sourceContentType))
                fileContent.Headers.ContentType = sourceContentType;
            multipart.Add(fileContent, "file", version.FileName);

            var previewClient = httpClientFactory.CreateClient("OcrRag");
            using var previewResponse = await previewClient.PostAsync(
                "api/documents/convert-to-pdf",
                multipart,
                cancellationToken);

            if (!previewResponse.IsSuccessStatusCode)
            {
                var detail = await previewResponse.Content.ReadAsStringAsync(cancellationToken);
                logger.LogWarning(
                    "Preview conversion failed for document {DocumentId}, version {VersionId}: {Status} {Detail}",
                    id,
                    versionId,
                    previewResponse.StatusCode,
                    detail);
                return StatusCode(StatusCodes.Status502BadGateway, new
                {
                    success = false,
                    error = "The document preview service could not render this file",
                });
            }

            var pdfBytes = await previewResponse.Content.ReadAsByteArrayAsync(cancellationToken);
            Response.Headers.CacheControl = "private, max-age=31536000, immutable";
            if (previewResponse.Headers.TryGetValues("X-Preview-Cache", out var cacheValues))
                Response.Headers["X-Preview-Cache"] = cacheValues.FirstOrDefault();
            Response.Headers.ContentDisposition =
                $"inline; filename=\"{Path.GetFileNameWithoutExtension(version.FileName)}.pdf\"";

            return File(pdfBytes, "application/pdf");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return new EmptyResult();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error previewing version {VersionId} of document {DocumentId}", versionId, id);
            return StatusCode(500, new { success = false, error = "Document preview failed" });
        }
    }

    // Download the immutable original file bytes.
    [HttpGet("{id}/versions/{versionId}/download")]
    public async Task<ActionResult> DownloadVersion(Guid id, Guid versionId)
    {
        try
        {
            // Verify the version exists
            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(dv => dv.VersionId == versionId && dv.DocumentId == id);

            if (version == null)
                return NotFound(new { success = false, error = "Version not found" });

            if (string.IsNullOrEmpty(version.S3ObjectKey))
                return BadRequest(new { success = false, error = "File has not been uploaded yet" });

            // Get the document data
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            // Download from MinIO
            var stream = await minioService.DownloadAsync(version.S3ObjectKey);

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, DOCUMENT_DOWNLOADED, new
            {
                version.VersionId,
                document?.DocumentId,
                version.FileName,
                version.FileSizeBytes,
                DownloadedAt = DateTime.UtcNow
            });

            logger.LogInformation("Downloaded version {VersionId} of document {DocumentId}", versionId, id);

            return File(
                stream,
                version.MimeType ?? "application/octet-stream",
                version.FileName);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error downloading version {VersionId}", versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/documents/{id} — update document data
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateDocument(Guid id, [FromBody] UpdateDocumentRequest req)
    {
        try
        {
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            // This previously had no permission check at all — any authenticated user
            // could edit any document's metadata regardless of role. Edit is its own
            // dedicated action (distinct from Rename), hidden from everyone by default
            // — either an Admin grants it per user/group via an override, or the
            // caller's global page-access role carries the blanket CanEditFiles flag.
            var userId = GetCurrentUserId();
            var effectiveRole = await GetEffectiveRoleAsync(context, userId, document.FolderId);
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            var editBaseline = effectiveRole == FolderRoles.Admin || pageAccessRole?.CanEditFiles == true;
            if (!await accessOverrideService.ResolveAsync(userId, id, document.FolderId, AccessOverrideActions.FileEdit, editBaseline))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have permission to edit this document" });

            if (!string.IsNullOrWhiteSpace(req.Title))
                document.Title = req.Title.Trim();

            if (!string.IsNullOrWhiteSpace(req.Status))
                document.Status = req.Status;

            if (req.Description != null)
                document.Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim();

            if (req.Tags != null)
                document.Tags = req.Tags.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()).ToArray();

            if (req.Department != null)
                document.Department = string.IsNullOrWhiteSpace(req.Department) ? null : req.Department.Trim();

            if (req.Category != null)
                document.Category = string.IsNullOrWhiteSpace(req.Category) ? null : req.Category.Trim();

            if (req.OwnerId.HasValue)
            {
                var ownerExists = await context.Users.AnyAsync(u => u.UserId == req.OwnerId && u.IsActive);
                if (!ownerExists)
                    return BadRequest(new { success = false, error = "Owner not found" });
                document.OwnerId = req.OwnerId.Value;
            }

            // VersionLabel and FileName both live on the current version row, not the
            // document itself. Renaming only touches this metadata column — the actual
            // MinIO object is addressed by the immutable S3ObjectKey (set once at
            // upload), so a rename never needs to move/re-key the stored file.
            if ((req.VersionLabel != null || req.FileName != null) && document.CurrentVersionId.HasValue)
            {
                var currentVersion = await context.DocumentVersions.FirstOrDefaultAsync(v => v.VersionId == document.CurrentVersionId);
                if (currentVersion != null)
                {
                    if (req.VersionLabel != null)
                        currentVersion.VersionLabel = string.IsNullOrWhiteSpace(req.VersionLabel) ? null : req.VersionLabel.Trim();

                    if (!string.IsNullOrWhiteSpace(req.FileName))
                    {
                        var newFileName = req.FileName.Trim();
                        if (newFileName.IndexOfAny(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) >= 0)
                            return BadRequest(new { success = false, error = "File name contains invalid characters" });
                        currentVersion.FileName = newFileName;
                    }

                    currentVersion.UpdatedAt = DateTime.UtcNow;
                }
            }

            document.UpdatedAt = DateTime.UtcNow;

            context.Documents.Update(document);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, DOCUMENT_UPDATED, new
            {
                document.DocumentId,
                document.Title,
                document.Status,
                document.UpdatedAt,
                ChangedFields = req
            });

            logger.LogInformation("Updated document {DocumentId}", id);

            await notificationService.NotifyAsync(document.OwnerId, userId, "Your document was edited", $"\"{document.Title}\" was updated.", document.DocumentId);

            return Ok(new
            {
                success = true,
                data = new
                {
                    document.DocumentId,
                    document.Title,
                    document.Status,
                    document.Description,
                    document.Tags,
                    document.Department,
                    document.Category,
                    document.OwnerId,
                    versionLabel = req.VersionLabel,
                    fileName = req.FileName,
                    document.UpdatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/documents/{id}/move — move a document into a different folder.
    // The Document Library's Move/Cut action previously only mutated local
    // React state and never called any backend endpoint at all — the move
    // looked like it worked, but reloading the page (or any other user's own
    // session) still showed the document in its original folder, since
    // nothing was ever persisted. Needs both Cut permission on the source
    // folder (adminBaseline, same as the FileCut flag already resolved for
    // the UI's own Move button) and Upload/Write permission on the
    // destination (same check CreateDocument already uses).
    [HttpPost("{id}/move")]
    public async Task<ActionResult<object>> MoveDocument(Guid id, [FromBody] MoveDocumentRequest req)
    {
        try
        {
            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == id);
            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            if (document.FolderId == req.DestinationFolderId)
                return BadRequest(new { success = false, error = "The document is already in this folder" });

            var destinationExists = await context.Folders.AnyAsync(f => f.FolderId == req.DestinationFolderId);
            if (!destinationExists)
                return BadRequest(new { success = false, error = "Destination folder not found" });

            var userId = GetCurrentUserId();

            var sourceEffectiveRole = await GetEffectiveRoleAsync(context, userId, document.FolderId);
            var sourceAdminBaseline = sourceEffectiveRole == FolderRoles.Admin;
            if (!await accessOverrideService.ResolveAsync(userId, id, document.FolderId, AccessOverrideActions.FileCut, sourceAdminBaseline))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have permission to move this document out of its current folder" });

            var destinationEffectiveRole = await GetEffectiveRoleAsync(context, userId, req.DestinationFolderId);
            var destinationRoleAllowsUpload = await HasRolePermissionAsync(context, destinationEffectiveRole, rp => rp.Upload);
            if (!await accessOverrideService.ResolveAsync(userId, null, req.DestinationFolderId, AccessOverrideActions.Write, destinationRoleAllowsUpload))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Upload permission in the destination folder" });

            var previousFolderId = document.FolderId;
            document.FolderId = req.DestinationFolderId;
            document.UpdatedAt = DateTime.UtcNow;
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, DOCUMENT_MOVED, new
            {
                document.DocumentId,
                previousFolderId,
                newFolderId = req.DestinationFolderId,
            });

            logger.LogInformation("Moved document {DocumentId} from folder {PreviousFolderId} to {NewFolderId}", id, previousFolderId, req.DestinationFolderId);

            return Ok(new { success = true, data = new { document.DocumentId, document.FolderId, document.UpdatedAt } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error moving document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/documents/{id} — delete a document
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteDocument(Guid id)
    {
        try
        {
            var (status, error) = await DeleteDocumentInternalAsync(id, GetCurrentUserId());
            if (status == DocumentDeleteStatus.ProtectedLegacyDocument)
                return Conflict(new { success = false, error });

            if (status == DocumentDeleteStatus.NotFound)
                return NotFound(new { success = false, error });

            return Ok(new { success = true, message = "Document deleted successfully" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // Shared by the single-document delete endpoint and BulkDeleteDocuments so the
    // two paths can't silently drift (e.g. one forgetting the MinIO/version cleanup).
    private async Task<(DocumentDeleteStatus Status, string? Error)> DeleteDocumentInternalAsync(Guid id, Guid actorUserId)
    {
        var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == id);
        if (document == null)
            return (DocumentDeleteStatus.NotFound, "Document not found");

        // Legacy migration provenance is immutable and intentionally holds
        // restrictive foreign keys to both the active document and version.
        // Reject the operation before touching MinIO so a failed database
        // delete cannot leave a migrated document pointing at a missing file.
        var hasProtectedLegacyHistory = await context.LegacyDocumentMappings
            .AsNoTracking()
            .AnyAsync(mapping => mapping.NewDocumentId == id);
        if (hasProtectedLegacyHistory)
            return (DocumentDeleteStatus.ProtectedLegacyDocument, LegacyMigrationDeleteBlockedMessage);

        var versions = await context.DocumentVersions
            .Where(v => v.DocumentId == id)
            .ToListAsync();

        await using (var transaction = await context.Database.BeginTransactionAsync())
        {
            try
            {
                // Break the document/current-version cycle before deleting both
                // sides of the required version-to-document relationship.
                document.CurrentVersionId = null;
                await context.SaveChangesAsync();

                // A single-document approval batch would otherwise become an empty,
                // permanently orphaned queue record after the document is deleted.
                var approvalsToDelete = await context.Approvals
                    .Where(a =>
                        a.Documents.Any(ad => ad.DocumentId == id)
                        && a.Documents.All(ad => ad.DocumentId == id))
                    .ToListAsync();

                context.Approvals.RemoveRange(approvalsToDelete);
                context.DocumentVersions.RemoveRange(versions);
                context.Documents.Remove(document);
                await context.SaveChangesAsync();

                await auditService.LogAsync(actorUserId, DOCUMENT_DELETED, new
                {
                    document.DocumentId,
                    document.Title,
                    document.FolderId,
                    VersionsDeleted = versions.Count,
                    DeletedAt = DateTime.UtcNow
                });

                await transaction.CommitAsync();
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        // Database deletion is authoritative. Storage cleanup only starts after
        // the transaction commits, so a database failure never destroys the
        // only readable copy of a live document.
        foreach (var version in versions)
        {
            if (string.IsNullOrEmpty(version.S3ObjectKey))
                continue;

            try
            {
                await minioService.DeleteAsync(version.S3ObjectKey);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to delete {ObjectKey} from MinIO", version.S3ObjectKey);
            }
        }

        logger.LogInformation("Deleted document {DocumentId}", id);
        return (DocumentDeleteStatus.Deleted, null);
    }

    // POST /api/documents/{id}/versions/{versionId}/checkout — lock the version for editing.
    // Body is optional — the "Download for Editing" button checks a document out
    // with no reason given, so an empty/absent body must not 400.
    [HttpPost("{id}/versions/{versionId}/checkout")]
    public async Task<ActionResult<object>> CheckoutVersion(Guid id, Guid versionId, [FromBody] CheckoutRequest? req = null)
    {
        try
        {
            var userId = GetCurrentUserId();
            var result = await checkoutService.CheckoutAsync(versionId, userId, req?.Reason);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "AlreadyCheckedOut" => BadRequest(new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    "Forbidden" => StatusCode(403, new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            await notificationService.NotifyDocumentOwnerAsync(id, userId, "Your document was locked for editing", "Someone checked it out for editing.");

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error checking out version {VersionId}", versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/documents/{id}/versions/{versionId}/checkout — release the version
    [HttpDelete("{id}/versions/{versionId}/checkout")]
    public async Task<ActionResult<object>> CheckinVersion(Guid id, Guid versionId)
    {
        try
        {
            var userId = GetCurrentUserId();
            var result = await checkoutService.CheckinAsync(versionId, userId);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    "Forbidden" => StatusCode(403, new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            await notificationService.NotifyDocumentOwnerAsync(id, userId, "Your document was unlocked", "The editing lock was released.");

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error checking in version {VersionId}", versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/documents/{id}/versions/{versionId}/force-unlock — unlock
    // someone else's checkout. Gated by AdminForceUnlock via RBACMiddleware
    // (path-based special case, same pattern as /submit).
    [HttpPost("{id}/versions/{versionId}/force-unlock")]
    public async Task<ActionResult<object>> ForceUnlockVersion(Guid id, Guid versionId)
    {
        try
        {
            var userId = GetCurrentUserId();
            var result = await checkoutService.ForceUnlockAsync(versionId, userId);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            await notificationService.NotifyDocumentOwnerAsync(id, userId, "Your document was unlocked", "An administrator force-unlocked it.");

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error force-unlocking version {VersionId}", versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/{id}/versions/{versionId}/checkout — lock status
    [HttpGet("{id}/versions/{versionId}/checkout")]
    public async Task<ActionResult<object>> GetCheckoutStatus(Guid id, Guid versionId)
    {
        try
        {
            var status = await checkoutService.GetCheckoutStatusAsync(versionId);

            if (status == null)
                return NotFound(new { success = false, error = "Version not found" });

            logger.LogInformation("Retrieved checkout status for version {VersionId}", versionId);

            return Ok(new { success = true, data = status });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting checkout status for version {VersionId}", versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/documents/{id}/submit — submit the document for approval
    [HttpPost("{id}/submit")]
    public async Task<ActionResult<object>> SubmitForApproval(Guid id, [FromBody] SubmitRequest req)
    {
        try
        {
            if (req.VersionId == Guid.Empty)
                return BadRequest(new { success = false, error = "VersionId is required" });

            var userId = GetCurrentUserId();
            var result = await approvalService.SubmitForApprovalAsync(id, req.VersionId, userId, req.Comment);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error submitting document {DocumentId} for approval", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/documents/{id}/approve — manager approval
    [HttpPost("{id}/approve")]
    public async Task<ActionResult<object>> ApproveDocument(Guid id, [FromBody] ApproveRequest req)
    {
        try
        {
            if (req.VersionId == Guid.Empty)
                return BadRequest(new { success = false, error = "VersionId is required" });

            var userId = GetCurrentUserId();
            var result = await approvalService.ApproveAsync(id, req.VersionId, userId, req.Comment);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error approving document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/documents/{id}/reject — manager rejection
    [HttpPost("{id}/reject")]
    public async Task<ActionResult<object>> RejectDocument(Guid id, [FromBody] RejectRequest req)
    {
        try
        {
            if (req.VersionId == Guid.Empty)
                return BadRequest(new { success = false, error = "VersionId is required" });

            if (string.IsNullOrWhiteSpace(req.Reason))
                return BadRequest(new { success = false, error = "Rejection reason is required" });

            var userId = GetCurrentUserId();
            var result = await approvalService.RejectAsync(id, req.VersionId, userId, req.Reason);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error rejecting document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/{id}/approval-status — approval status
    [HttpGet("{id}/approval-status")]
    public async Task<ActionResult<object>> GetApprovalStatus(Guid id, [FromQuery] Guid? versionId)
    {
        try
        {
            if (!versionId.HasValue || versionId == Guid.Empty)
                return BadRequest(new { success = false, error = "VersionId is required" });

            var status = await approvalService.GetApprovalStatusAsync(id, versionId.Value);

            if (status == null)
                return NotFound(new { success = false, error = "Version not found" });

            return Ok(new { success = true, data = status });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting approval status for document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/pending-approvals — pending queue
    [HttpGet("pending-approvals/list")]
    public async Task<ActionResult<object>> GetPendingApprovals(
        [FromQuery] Guid? folderId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 100,
        [FromQuery] int? limit = null)
    {
        try
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(limit ?? pageSize, 1, 200);
            var result = await approvalService.GetPendingApprovalsAsync(folderId, page, pageSize);

            return Ok(new
            {
                success = true,
                data = result.Items,
                count = result.TotalCount,
                totalCount = result.TotalCount,
                page,
                pageSize,
                totalPages = Math.Max(1, (int)Math.Ceiling(result.TotalCount / (double)pageSize))
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting pending approvals");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/documents/bulk-approve — approve multiple documents in one batch
    [HttpPost("bulk-approve")]
    public async Task<ActionResult<object>> BulkApproveDocuments([FromBody] BulkApproveRequest req)
    {
        if (req.DocumentIds is not { Count: > 0 })
            return BadRequest(new { success = false, error = "documentIds is required" });

        var userId = GetCurrentUserId();
        var succeeded = new List<Guid>();
        var failed = new List<object>();

        foreach (var documentId in req.DocumentIds.Distinct())
        {
            var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == documentId);
            if (document?.CurrentVersionId == null)
            {
                failed.Add(new { documentId, error = "Document has no uploaded version" });
                continue;
            }

            var result = await approvalService.ApproveAsync(documentId, document.CurrentVersionId.Value, userId, req.Comments);
            if (result.Success) succeeded.Add(documentId);
            else failed.Add(new { documentId, error = result.Message });
        }

        logger.LogInformation("Bulk approve: {Succeeded} succeeded, {Failed} failed", succeeded.Count, failed.Count);
        return Ok(new { success = true, data = new { succeeded, failed } });
    }

    // POST /api/documents/bulk-reject — reject multiple documents in one batch
    [HttpPost("bulk-reject")]
    public async Task<ActionResult<object>> BulkRejectDocuments([FromBody] BulkRejectRequest req)
    {
        if (req.DocumentIds is not { Count: > 0 })
            return BadRequest(new { success = false, error = "documentIds is required" });
        if (string.IsNullOrWhiteSpace(req.Reason))
            return BadRequest(new { success = false, error = "Rejection reason is required" });

        var userId = GetCurrentUserId();
        var succeeded = new List<Guid>();
        var failed = new List<object>();

        foreach (var documentId in req.DocumentIds.Distinct())
        {
            var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == documentId);
            if (document?.CurrentVersionId == null)
            {
                failed.Add(new { documentId, error = "Document has no uploaded version" });
                continue;
            }

            var result = await approvalService.RejectAsync(documentId, document.CurrentVersionId.Value, userId, req.Reason);
            if (result.Success) succeeded.Add(documentId);
            else failed.Add(new { documentId, error = result.Message });
        }

        logger.LogInformation("Bulk reject: {Succeeded} succeeded, {Failed} failed", succeeded.Count, failed.Count);
        return Ok(new { success = true, data = new { succeeded, failed } });
    }

    // POST /api/documents/bulk-delete — delete multiple documents in one batch
    [HttpPost("bulk-delete")]
    public async Task<ActionResult<object>> BulkDeleteDocuments([FromBody] BulkDeleteRequest req)
    {
        if (req.DocumentIds is not { Count: > 0 })
            return BadRequest(new { success = false, error = "documentIds is required" });

        var userId = GetCurrentUserId();
        var succeeded = new List<Guid>();
        var failed = new List<object>();

        // Bulk delete has no per-document ID in this endpoint's own path for
        // RBACMiddleware to gate (unlike the single-document DELETE
        // endpoint), so the same DeleteFile role check + FileDelete override
        // this action maps to elsewhere is applied explicitly here per item.
        foreach (var documentId in req.DocumentIds.Distinct())
        {
            var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == documentId);
            if (document == null)
            {
                failed.Add(new { documentId, error = "Document not found" });
                continue;
            }

            var effectiveRole = await GetEffectiveRoleAsync(context, userId, document.FolderId);
            var roleAllows = await HasRolePermissionAsync(context, effectiveRole, rp => rp.DeleteFile);
            var allowed = await accessOverrideService.ResolveAsync(userId, documentId, document.FolderId, AccessOverrideActions.FileDelete, roleAllows);
            if (!allowed)
            {
                failed.Add(new { documentId, error = "You don't have permission to delete this document" });
                continue;
            }

            var (status, error) = await DeleteDocumentInternalAsync(documentId, userId);
            if (status == DocumentDeleteStatus.Deleted) succeeded.Add(documentId);
            else failed.Add(new { documentId, error });
        }

        logger.LogInformation("Bulk delete: {Succeeded} succeeded, {Failed} failed", succeeded.Count, failed.Count);
        return Ok(new { success = true, data = new { succeeded, failed } });
    }

    // POST /api/documents/bulk-download — download multiple documents as a single zip file
    [HttpPost("bulk-download")]
    public async Task<ActionResult> BulkDownloadDocuments([FromBody] BulkDownloadRequest req)
    {
        if (req.DocumentIds is not { Count: > 0 })
            return BadRequest(new { success = false, error = "documentIds is required" });

        var userId = GetCurrentUserId();
        var documents = await context.Documents
            .Where(d => req.DocumentIds.Contains(d.DocumentId) && d.CurrentVersionId != null)
            .ToListAsync();

        var versionIds = documents.Select(d => d.CurrentVersionId!.Value).ToList();
        var versions = await context.DocumentVersions
            .Where(v => versionIds.Contains(v.VersionId))
            .ToDictionaryAsync(v => v.VersionId);

        var memoryStream = new MemoryStream();
        using (var archive = new System.IO.Compression.ZipArchive(memoryStream, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
        {
            var usedNames = new HashSet<string>();
            foreach (var document in documents)
            {
                if (!versions.TryGetValue(document.CurrentVersionId!.Value, out var version) || string.IsNullOrEmpty(version.S3ObjectKey))
                    continue;

                // Guards against two documents sharing the same file name colliding inside the zip.
                var entryName = version.FileName;
                var suffix = 1;
                while (!usedNames.Add(entryName))
                    entryName = $"{Path.GetFileNameWithoutExtension(version.FileName)} ({++suffix}){Path.GetExtension(version.FileName)}";

                var entry = archive.CreateEntry(entryName, System.IO.Compression.CompressionLevel.Fastest);
                await using var entryStream = entry.Open();
                try
                {
                    await using var sourceStream = await minioService.DownloadAsync(version.S3ObjectKey);
                    await sourceStream.CopyToAsync(entryStream);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Skipping {ObjectKey} in bulk download — could not read from storage", version.S3ObjectKey);
                }
            }
        }

        await auditService.LogAsync(userId, DOCUMENT_DOWNLOADED, new
        {
            DocumentIds = documents.Select(d => d.DocumentId),
            Count = documents.Count,
            DownloadedAt = DateTime.UtcNow
        });

        memoryStream.Position = 0;
        return File(memoryStream, "application/zip", $"documents-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip");
    }
}

public record CreateDocumentRequest(string Title, Guid FolderId, Guid OwnerId, string? Description = null, string[]? Tags = null, string? Department = null, string? Category = null, string? OriginalDocumentId = null);
public record UpdateDocumentRequest(string? Title = null, string? Status = null, string? Description = null, string[]? Tags = null, string? Department = null, string? Category = null, Guid? OwnerId = null, string? VersionLabel = null, string? FileName = null);
public record MoveDocumentRequest(Guid DestinationFolderId);
public record CheckoutRequest(string? Reason = null);
public record SubmitRequest(Guid VersionId, string? Comment = null);
public record ApproveRequest(Guid VersionId, string? Comment = null);
public record RejectRequest(Guid VersionId, string Reason);
public record BulkApproveRequest(List<Guid> DocumentIds, string? Comments = null);
public record BulkRejectRequest(List<Guid> DocumentIds, string Reason);
public record BulkDeleteRequest(List<Guid> DocumentIds);
public record BulkDownloadRequest(List<Guid> DocumentIds);
public record ExtractDocIdRequest(string? Text);
public record SetDocIdRequest(string OriginalDocumentId);
public sealed record LegacyMetadataField(string Name, string? Value);
public sealed record LegacyAssociatedFile(
    long LegacyContentVersionId,
    string OriginalFileName,
    int MajorVersion,
    int MinorVersion,
    string VersionLabel,
    DateTime? FileDate,
    long? FileSizeBytes,
    string FileStatus,
    bool IsAvailable,
    string? ViewUrl,
    string? DownloadUrl);
public sealed record LegacyContentTarget(string ObjectKey, string FileName);
