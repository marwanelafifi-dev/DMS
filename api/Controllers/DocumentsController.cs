using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
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
    ILogger<DocumentsController> logger) : BaseController
{
    // GET /api/documents — قائمة المستندات
    [HttpGet]
    public async Task<ActionResult<object>> GetDocuments(
        [FromQuery] Guid? folderId,
        [FromQuery] string? search = null)
    {
        try
        {
            var query = context.Documents.AsQueryable();

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
                    CheckoutStatus = currentVersion != null && currentVersion.IsCheckedOut ? "checked_out" : "checked_in",
                    CheckedOutBy = currentVersion == null ? null : currentVersion.CheckedOutById,
                    CheckedOutAt = currentVersion == null ? null : currentVersion.CheckedOutAt,
                    UploadedAt = document.CreatedAt,
                    document.CreatedAt,
                    document.UpdatedAt
                })
                .ToListAsync();

            logger.LogInformation("Retrieved {Count} documents", documents.Count);
            return Ok(new { success = true, data = documents, count = documents.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving documents");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/{id} — تفاصيل مستند
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetDocument(Guid id)
    {
        try
        {
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            if (document == null)
                return NotFound(new { success = false, error = "المستند غير موجود" });

            var versions = await context.DocumentVersions
                .Where(v => v.DocumentId == id)
                .Select(v => new
                {
                    v.VersionId,
                    v.VersionNumber,
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
                    CheckoutStatus = currentVersion?.IsCheckedOut == true ? "checked_out" : "checked_in",
                    CheckedOutBy = currentVersion?.CheckedOutById,
                    CheckedOutAt = currentVersion?.CheckedOutAt,
                    UploadedAt = document.CreatedAt,
                    Versions = versions,
                    VersionCount = versions.Count,
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

    // POST /api/documents — إنشاء مستند بدون ملف
    [HttpPost]
    public async Task<ActionResult<object>> CreateDocument([FromBody] CreateDocumentRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();

            // التحقق من المدخلات
            if (string.IsNullOrWhiteSpace(req.Title))
                return BadRequest(new { success = false, error = "عنوان المستند مطلوب" });

            // التحقق من وجود المجلد
            var folderExists = await context.Folders
                .AnyAsync(f => f.FolderId == req.FolderId);

            if (!folderExists)
                return BadRequest(new { success = false, error = "المجلد غير موجود" });

            // التحقق من وجود المالك
            var folderPermission = await context.FolderPermissions
                .FirstOrDefaultAsync(p => p.FolderId == req.FolderId && p.UserId == userId);

            if (folderPermission == null ||
                folderPermission.Role is not (FolderRoles.Writer or FolderRoles.Manager or FolderRoles.QA or FolderRoles.Admin))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = false,
                    error = "Write permission is required to create documents in this folder"
                });
            }

            var ownerExists = await context.Users
                .AnyAsync(u => u.UserId == req.OwnerId && u.IsActive);

            if (!ownerExists)
                return BadRequest(new { success = false, error = "المالك غير موجود" });

            // Document ID at upload time is System Admin only — QA only gets access to
            // it later, at First Review (see ApprovalsController.RequireQaOrAdminForApprovalAsync).
            var isAdmin = folderPermission.Role is FolderRoles.Admin;
            if (!string.IsNullOrWhiteSpace(req.OriginalDocumentId) && !isAdmin)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = false,
                    error = "Only System Admin can set the Document ID directly"
                });
            }

            var document = new DmsDocument
            {
                DocumentId = Guid.NewGuid(),
                FolderId = req.FolderId,
                Title = req.Title.Trim(),
                Status = "draft",
                Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
                Tags = req.Tags?.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()).ToArray() ?? Array.Empty<string>(),
                Department = string.IsNullOrWhiteSpace(req.Department) ? null : req.Department.Trim(),
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
    /// Format: DOC-YYYYMMDD-#### (daily sequence).
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

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var sequence = await context.DocIdSequences.FirstOrDefaultAsync(s => s.SequenceDate == today);
            if (sequence == null)
            {
                sequence = new DmsDocIdSequence { SequenceDate = today, NextSeq = 1 };
                context.DocIdSequences.Add(sequence);
            }

            var generated = $"DOC-{today:yyyyMMdd}-{sequence.NextSeq:D4}";
            sequence.NextSeq++;

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

    private async Task<ActionResult<object>?> RequireQaOrAdminAsync(Guid folderId)
    {
        var userId = GetCurrentUserId();
        var permission = await context.FolderPermissions
            .FirstOrDefaultAsync(p => p.FolderId == folderId && p.UserId == userId);

        if (permission == null || permission.Role is not (FolderRoles.QA or FolderRoles.Admin))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                error = "Only QA or Admin can perform this action"
            });
        }

        return null;
    }

    // POST /api/documents/{id}/upload — تحميل ملف
    [HttpPost("{id}/upload")]
    public async Task<ActionResult<object>> UploadVersion(Guid id, IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, error = "الملف مطلوب" });

            // التحقق من وجود المستند
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            if (document == null)
                return NotFound(new { success = false, error = "المستند غير موجود" });

            // حساب SHA256 للملف
            string sha256Hash;
            using (var sha256 = SHA256.Create())
            {
                var hash = await sha256.ComputeHashAsync(file.OpenReadStream());
                sha256Hash = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
            }

            // إعادة تعيين الـ stream
            file.OpenReadStream().Seek(0, SeekOrigin.Begin);

            // إنشاء نسخة جديدة
            var version = new DmsDocumentVersion
            {
                VersionId = Guid.NewGuid(),
                DocumentId = id,
                VersionNumber = "1.0",
                FileName = file.FileName,
                FileSizeBytes = file.Length,
                MimeType = file.ContentType,
                Sha256Hash = sha256Hash,
                Status = "draft",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            // تحميل الملف إلى MinIO
            var objectKey = $"documents/{id}/{version.VersionId}/{file.FileName}";
            await minioService.UploadAsync(
                objectKey,
                file.OpenReadStream(),
                file.ContentType ?? "application/octet-stream");

            version.S3ObjectKey = objectKey;

            // حفظ في قاعدة البيانات
            context.DocumentVersions.Add(version);
            document.CurrentVersionId = version.VersionId;
            document.UpdatedAt = DateTime.UtcNow;

            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, DOCUMENT_UPLOADED, new
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

    // GET /api/documents/{id}/download — تحميل ملف
    [HttpGet("{id}/versions/{versionId}/download")]
    public async Task<ActionResult> DownloadVersion(Guid id, Guid versionId)
    {
        try
        {
            // التحقق من وجود النسخة
            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(dv => dv.VersionId == versionId && dv.DocumentId == id);

            if (version == null)
                return NotFound(new { success = false, error = "النسخة غير موجودة" });

            if (string.IsNullOrEmpty(version.S3ObjectKey))
                return BadRequest(new { success = false, error = "الملف غير محمّل بعد" });

            // الحصول على بيانات المستند
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            // تحميل من MinIO
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

    // PUT /api/documents/{id} — تعديل بيانات المستند
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateDocument(Guid id, [FromBody] UpdateDocumentRequest req)
    {
        try
        {
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            if (document == null)
                return NotFound(new { success = false, error = "المستند غير موجود" });

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

            document.UpdatedAt = DateTime.UtcNow;

            context.Documents.Update(document);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, DOCUMENT_UPDATED, new
            {
                document.DocumentId,
                document.Title,
                document.Status,
                document.UpdatedAt,
                ChangedFields = req
            });

            logger.LogInformation("Updated document {DocumentId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    document.DocumentId,
                    document.Title,
                    document.Status,
                    document.Tags,
                    document.Department,
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

    // DELETE /api/documents/{id} — حذف مستند
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteDocument(Guid id)
    {
        try
        {
            var (success, error) = await DeleteDocumentInternalAsync(id, GetCurrentUserId());
            if (!success)
                return NotFound(new { success = false, error });

            return Ok(new { success = true, message = "تم حذف المستند بنجاح" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // Shared by the single-document delete endpoint and BulkDeleteDocuments so the
    // two paths can't silently drift (e.g. one forgetting the MinIO/version cleanup).
    private async Task<(bool Success, string? Error)> DeleteDocumentInternalAsync(Guid id, Guid actorUserId)
    {
        var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == id);
        if (document == null)
            return (false, "المستند غير موجود");

        var versions = await context.DocumentVersions
            .Where(v => v.DocumentId == id)
            .ToListAsync();

        foreach (var version in versions)
        {
            if (!string.IsNullOrEmpty(version.S3ObjectKey))
            {
                try
                {
                    await minioService.DeleteAsync(version.S3ObjectKey);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to delete {ObjectKey} from MinIO", version.S3ObjectKey);
                }
            }
        }

        // Break the document/current-version cycle before deleting both
        // sides of the required version-to-document relationship.
        document.CurrentVersionId = null;
        await context.SaveChangesAsync();

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

        logger.LogInformation("Deleted document {DocumentId}", id);
        return (true, null);
    }

    // POST /api/documents/{id}/versions/{versionId}/checkout — تأمين النسخة للتعديل
    [HttpPost("{id}/versions/{versionId}/checkout")]
    public async Task<ActionResult<object>> CheckoutVersion(Guid id, Guid versionId, [FromBody] CheckoutRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var result = await checkoutService.CheckoutAsync(versionId, userId, req.Reason);

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

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error checking out version {VersionId}", versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/documents/{id}/versions/{versionId}/checkout — إطلاق النسخة
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

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error checking in version {VersionId}", versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/{id}/versions/{versionId}/checkout — حالة التأمين
    [HttpGet("{id}/versions/{versionId}/checkout")]
    public async Task<ActionResult<object>> GetCheckoutStatus(Guid id, Guid versionId)
    {
        try
        {
            var status = await checkoutService.GetCheckoutStatusAsync(versionId);

            if (status == null)
                return NotFound(new { success = false, error = "النسخة غير موجودة" });

            logger.LogInformation("Retrieved checkout status for version {VersionId}", versionId);

            return Ok(new { success = true, data = status });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting checkout status for version {VersionId}", versionId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/documents/{id}/submit — إرسال المستند لـ الموافقة
    [HttpPost("{id}/submit")]
    public async Task<ActionResult<object>> SubmitForApproval(Guid id, [FromBody] SubmitRequest req)
    {
        try
        {
            if (req.VersionId == Guid.Empty)
                return BadRequest(new { success = false, error = "VersionId مطلوب" });

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

    // POST /api/documents/{id}/approve — موافقة المدير
    [HttpPost("{id}/approve")]
    public async Task<ActionResult<object>> ApproveDocument(Guid id, [FromBody] ApproveRequest req)
    {
        try
        {
            if (req.VersionId == Guid.Empty)
                return BadRequest(new { success = false, error = "VersionId مطلوب" });

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

    // POST /api/documents/{id}/reject — رفض المدير
    [HttpPost("{id}/reject")]
    public async Task<ActionResult<object>> RejectDocument(Guid id, [FromBody] RejectRequest req)
    {
        try
        {
            if (req.VersionId == Guid.Empty)
                return BadRequest(new { success = false, error = "VersionId مطلوب" });

            if (string.IsNullOrWhiteSpace(req.Reason))
                return BadRequest(new { success = false, error = "سبب الرفض مطلوب" });

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

    // GET /api/documents/{id}/approval-status — حالة الموافقة
    [HttpGet("{id}/approval-status")]
    public async Task<ActionResult<object>> GetApprovalStatus(Guid id, [FromQuery] Guid? versionId)
    {
        try
        {
            if (!versionId.HasValue || versionId == Guid.Empty)
                return BadRequest(new { success = false, error = "VersionId مطلوب" });

            var status = await approvalService.GetApprovalStatusAsync(id, versionId.Value);

            if (status == null)
                return NotFound(new { success = false, error = "النسخة غير موجودة" });

            return Ok(new { success = true, data = status });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting approval status for document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/documents/pending-approvals — قائمة الانتظار
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

    // POST /api/documents/bulk-approve — موافقة على عدة مستندات دفعة واحدة
    [HttpPost("bulk-approve")]
    public async Task<ActionResult<object>> BulkApproveDocuments([FromBody] BulkApproveRequest req)
    {
        if (req.DocumentIds is not { Count: > 0 })
            return BadRequest(new { success = false, error = "documentIds مطلوب" });

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

    // POST /api/documents/bulk-reject — رفض عدة مستندات دفعة واحدة
    [HttpPost("bulk-reject")]
    public async Task<ActionResult<object>> BulkRejectDocuments([FromBody] BulkRejectRequest req)
    {
        if (req.DocumentIds is not { Count: > 0 })
            return BadRequest(new { success = false, error = "documentIds مطلوب" });
        if (string.IsNullOrWhiteSpace(req.Reason))
            return BadRequest(new { success = false, error = "سبب الرفض مطلوب" });

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

    // POST /api/documents/bulk-delete — حذف عدة مستندات دفعة واحدة
    [HttpPost("bulk-delete")]
    public async Task<ActionResult<object>> BulkDeleteDocuments([FromBody] BulkDeleteRequest req)
    {
        if (req.DocumentIds is not { Count: > 0 })
            return BadRequest(new { success = false, error = "documentIds مطلوب" });

        var userId = GetCurrentUserId();
        var succeeded = new List<Guid>();
        var failed = new List<object>();

        foreach (var documentId in req.DocumentIds.Distinct())
        {
            var (success, error) = await DeleteDocumentInternalAsync(documentId, userId);
            if (success) succeeded.Add(documentId);
            else failed.Add(new { documentId, error });
        }

        logger.LogInformation("Bulk delete: {Succeeded} succeeded, {Failed} failed", succeeded.Count, failed.Count);
        return Ok(new { success = true, data = new { succeeded, failed } });
    }

    // POST /api/documents/bulk-download — تحميل عدة مستندات كملف مضغوط واحد
    [HttpPost("bulk-download")]
    public async Task<ActionResult> BulkDownloadDocuments([FromBody] BulkDownloadRequest req)
    {
        if (req.DocumentIds is not { Count: > 0 })
            return BadRequest(new { success = false, error = "documentIds مطلوب" });

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

public record CreateDocumentRequest(string Title, Guid FolderId, Guid OwnerId, string? Description = null, string[]? Tags = null, string? Department = null, string? OriginalDocumentId = null);
public record UpdateDocumentRequest(string? Title = null, string? Status = null, string? Description = null, string[]? Tags = null, string? Department = null);
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
