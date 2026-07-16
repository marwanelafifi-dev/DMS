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
    public async Task<ActionResult<object>> GetDocuments([FromQuery] Guid? folderId)
    {
        try
        {
            var query = context.Documents.AsQueryable();

            if (folderId.HasValue)
                query = query.Where(d => d.FolderId == folderId);

            var documents = await query
                .Select(d => new
                {
                    d.DocumentId,
                    d.Title,
                    d.Status,
                    d.TrackingCode,
                    d.OwnerId,
                    d.FolderId,
                    d.CurrentVersionId,
                    d.CreatedAt,
                    d.UpdatedAt
                })
                .OrderBy(d => d.Title)
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
                    v.CreatedAt
                })
                .OrderByDescending(v => v.CreatedAt)
                .ToListAsync();

            logger.LogInformation("Retrieved document {DocumentId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    document.DocumentId,
                    document.Title,
                    document.Status,
                    document.TrackingCode,
                    document.OwnerId,
                    document.FolderId,
                    document.CurrentVersionId,
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
            var ownerExists = await context.Users
                .AnyAsync(u => u.UserId == req.OwnerId && u.IsActive);

            if (!ownerExists)
                return BadRequest(new { success = false, error = "المالك غير موجود" });

            var document = new DmsDocument
            {
                DocumentId = Guid.NewGuid(),
                FolderId = req.FolderId,
                Title = req.Title.Trim(),
                Status = "draft",
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
            var document = await context.Documents
                .FirstOrDefaultAsync(d => d.DocumentId == id);

            if (document == null)
                return NotFound(new { success = false, error = "المستند غير موجود" });

            // حذف جميع النسخ من MinIO
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

            // حذف النسخ من قاعدة البيانات
            context.DocumentVersions.RemoveRange(versions);

            // حذف المستند
            context.Documents.Remove(document);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, DOCUMENT_DELETED, new
            {
                document.DocumentId,
                document.Title,
                document.FolderId,
                VersionsDeleted = versions.Count,
                DeletedAt = DateTime.UtcNow
            });

            logger.LogInformation("Deleted document {DocumentId}", id);

            return Ok(new { success = true, message = "تم حذف المستند بنجاح" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting document {DocumentId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
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
    public async Task<ActionResult<object>> GetPendingApprovals([FromQuery] Guid? folderId, [FromQuery] int limit = 100)
    {
        try
        {
            var pending = await approvalService.GetPendingApprovalsAsync(folderId, limit);

            return Ok(new { success = true, data = pending, count = pending.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting pending approvals");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateDocumentRequest(string Title, Guid FolderId, Guid OwnerId);
public record UpdateDocumentRequest(string? Title = null, string? Status = null);
public record CheckoutRequest(string? Reason = null);
public record SubmitRequest(Guid VersionId, string? Comment = null);
public record ApproveRequest(Guid VersionId, string? Comment = null);
public record RejectRequest(Guid VersionId, string Reason);
