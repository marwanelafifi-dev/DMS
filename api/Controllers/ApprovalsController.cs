using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/approvals")]
public class ApprovalsController(DmsContext context, AuditService auditService, AccessOverrideService accessOverrideService, MinioService minioService, NotificationService notificationService) : BaseController
{
    /// <summary>
    /// Every document in the approval batch must belong to a folder where the
    /// current user's effective role grants the given permission (Approve/Reject) —
    /// mirrors the same per-folder-role check SubmitForApproval already used.
    /// </summary>
    private async Task<bool> CurrentUserHasApprovalPermissionAsync(Guid approvalId, Guid userId, Func<DmsRolePermission, bool> selector)
    {
        var folderIds = await context.ApprovalDocuments
            .Where(ad => ad.ApprovalId == approvalId)
            .Join(context.Documents, ad => ad.DocumentId, d => d.DocumentId, (ad, d) => d.FolderId)
            .Distinct()
            .ToListAsync();

        foreach (var folderId in folderIds)
        {
            var effectiveRole = await GetEffectiveRoleAsync(context, userId, folderId);
            if (!await HasRolePermissionAsync(context, effectiveRole, selector))
                return false;
        }

        return true;
    }

    // Notifies every document owner in the batch that its approval status
    // changed — a batch can span multiple documents/owners, so this can't
    // just look at a single "the" owner.
    private async Task NotifyBatchOwnersAsync(Guid approvalId, Guid actorUserId, string title, string? body = null)
    {
        var documentIds = await context.ApprovalDocuments
            .Where(ad => ad.ApprovalId == approvalId)
            .Select(ad => ad.DocumentId)
            .ToListAsync();

        foreach (var documentId in documentIds)
            await notificationService.NotifyDocumentOwnerAsync(documentId, actorUserId, title, body);
    }

    private async Task<string> GenerateTrackingCodeAsync(DmsDocument document, string? deptOverride, string? categoryOverride)
    {
        static string Shorten(string? raw, string fallback)
        {
            var cleaned = new string((raw ?? string.Empty).Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
            if (cleaned.Length == 0) return fallback;
            return cleaned.Length > 4 ? cleaned[..4] : cleaned;
        }

        var deptCode = Shorten(deptOverride ?? document.Department, "GEN");
        var catCode = Shorten(categoryOverride ?? document.Category, "DOC");
        var year = DateTime.UtcNow.Year;
        var prefix = $"{deptCode}-{year}-{catCode}-";

        var existingCount = await context.Documents.CountAsync(d => d.TrackingCode != null && d.TrackingCode.StartsWith(prefix));
        return $"{prefix}{(existingCount + 1):D4}";
    }

    /// <summary>
    /// Submit documents for approval batch (C-Doc Stage 1)
    /// </summary>
    [HttpPost("submit-batch")]
    public async Task<ActionResult<object>> SubmitForApprovalAsync([FromBody] SubmitApprovalRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();

            // Validate documents exist and belong to current user
            var documents = await context.Documents
                .Where(d => request.DocumentIds.Contains(d.DocumentId))
                .ToListAsync();

            if (documents.Count != request.DocumentIds.Count)
                return BadRequest(new { success = false, error = "Some documents not found" });

            if (documents.Any(d => d.OwnerId != userId))
                return BadRequest(new { success = false, error = "All documents must belong to the current user" });

            // Previously unchecked beyond ownership — any authenticated user,
            // including Reader, could submit a document into the approval
            // workflow. Now requires SubmitForApproval on the effective role
            // for every document (folder-level role, narrowed/widened by any
            // applicable File/Folder Permission override).
            foreach (var document in documents)
            {
                var effectiveRole = await GetEffectiveRoleAsync(context, userId, document.FolderId);
                var roleAllows = await HasRolePermissionAsync(context, effectiveRole, rp => rp.SubmitForApproval);
                if (!await accessOverrideService.ResolveAsync(userId, document.DocumentId, document.FolderId, AccessOverrideActions.SubmitForApproval, roleAllows))
                    return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Submit for Approval permission" });
            }

            // Get latest versions
            var versions = await context.DocumentVersions
                .Where(v => request.DocumentIds.Contains(v.DocumentId))
                .GroupBy(v => v.DocumentId)
                .Select(g => g.OrderByDescending(v => v.CreatedAt).First())
                .ToListAsync();

            // Create approval batch
            var approval = new DmsApproval
            {
                ApprovalId = Guid.NewGuid(),
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow,
                CurrentStage = "qa_review",
                Status = "pending",
            };

            foreach (var version in versions)
            {
                approval.Documents.Add(new DmsApprovalDocument
                {
                    ApprovalDocumentId = Guid.NewGuid(),
                    DocumentId = version.DocumentId,
                    VersionId = version.VersionId,
                    CreatedAt = DateTime.UtcNow,
                });
            }

            context.Approvals.Add(approval);
            await context.SaveChangesAsync();

            // Audit
            await auditService.LogAsync(userId, "DOCUMENT_SUBMITTED_FOR_APPROVAL", new
            {
                approvalId = approval.ApprovalId,
                documentCount = documents.Count,
            });

            return Ok(new
            {
                success = true,
                data = new
                {
                    approval.ApprovalId,
                    approval.CreatedBy,
                    approval.CreatedAt,
                    approval.CurrentStage,
                    approval.Status,
                    documentIds = approval.Documents.Select(ad => ad.DocumentId),
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get full detail for a single approval batch (used by the review modal)
    /// </summary>
    [HttpGet("{approvalId}")]
    public async Task<ActionResult<object>> GetApprovalAsync(Guid approvalId)
    {
        try
        {
            var approval = await context.Approvals
                .Include(a => a.CreatedByUser)
                .Include(a => a.Documents).ThenInclude(ad => ad.Document).ThenInclude(d => d!.Owner)
                .Include(a => a.Documents).ThenInclude(ad => ad.Version)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            return Ok(new
            {
                success = true,
                data = new
                {
                    approval.ApprovalId,
                    approval.CreatedBy,
                    createdByUserName = approval.CreatedByUser?.FullName,
                    approval.CreatedAt,
                    approval.CurrentStage,
                    approval.Status,
                    approval.QaNotes,
                    approval.ManagerNotes,
                    approval.TrackingCode,
                    approval.ReleaseNotes,
                    documents = approval.Documents.Select(ad => new
                    {
                        ad.DocumentId,
                        ad.VersionId,
                        fileName = ad.Version?.FileName ?? ad.Document?.Title ?? "Untitled document",
                        ownerName = ad.Document?.Owner?.FullName ?? "Unknown owner",
                        department = ad.Document?.Department,
                        category = ad.Document?.Category,
                        originalDocumentId = ad.Document?.OriginalDocumentId,
                        trackingCode = ad.Document?.TrackingCode,
                        status = ad.Document?.Status,
                        versionNumber = ad.Version?.VersionNumber,
                        fileSizeBytes = ad.Version?.FileSizeBytes,
                        sha256Hash = ad.Version?.Sha256Hash,
                    }),
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get QA Review Queue (Stage 1) - documents waiting for QA approval
    /// </summary>
    [HttpGet("qa-review-queue")]
    public async Task<ActionResult<object>> GetQaReviewQueueAsync([FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        try
        {
            var approvals = await context.Approvals
                .Where(a => a.CurrentStage == "qa_review" && a.Status == "pending" && a.Documents.Any())
                .Include(a => a.CreatedByUser)
                .Include(a => a.Documents).ThenInclude(ad => ad.Document).ThenInclude(d => d!.Owner)
                .Include(a => a.Documents).ThenInclude(ad => ad.Version)
                .OrderByDescending(a => a.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            var totalCount = await context.Approvals
                .CountAsync(a => a.CurrentStage == "qa_review" && a.Status == "pending" && a.Documents.Any());

            return Ok(new
            {
                success = true,
                data = approvals.Select(a => new
                {
                    a.ApprovalId,
                    a.CreatedBy,
                    createdByUserName = a.CreatedByUser?.FullName,
                    a.CreatedAt,
                    a.Status,
                    documentCount = a.Documents.Count,
                    a.QaNotes,
                    documents = a.Documents.Select(ToQueueDocument),
                }),
                count = approvals.Count,
                totalCount,
                totalPages = (int)Math.Ceiling((double)totalCount / pageSize),
                page,
                pageSize,
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get Manager Review Queue (Stage 2) - documents waiting for manager approval
    /// </summary>
    [HttpGet("manager-review-queue")]
    public async Task<ActionResult<object>> GetManagerReviewQueueAsync([FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        try
        {
            var approvals = await context.Approvals
                .Where(a => a.CurrentStage == "manager_review" && a.Status == "pending" && a.Documents.Any())
                .Include(a => a.CreatedByUser)
                .Include(a => a.Documents).ThenInclude(ad => ad.Document).ThenInclude(d => d!.Owner)
                .Include(a => a.Documents).ThenInclude(ad => ad.Version)
                .OrderByDescending(a => a.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            var totalCount = await context.Approvals
                .CountAsync(a => a.CurrentStage == "manager_review" && a.Status == "pending" && a.Documents.Any());

            return Ok(new
            {
                success = true,
                data = approvals.Select(a => new
                {
                    a.ApprovalId,
                    a.CreatedBy,
                    createdByUserName = a.CreatedByUser?.FullName,
                    a.CreatedAt,
                    a.Status,
                    documentCount = a.Documents.Count,
                    a.ManagerNotes,
                    documents = a.Documents.Select(ToQueueDocument),
                }),
                count = approvals.Count,
                totalCount,
                totalPages = (int)Math.Ceiling((double)totalCount / pageSize),
                page,
                pageSize,
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get Final Release Queue (Stage 3) - documents waiting for final QA release
    /// </summary>
    [HttpGet("final-release-queue")]
    public async Task<ActionResult<object>> GetFinalReleaseQueueAsync([FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        try
        {
            var approvals = await context.Approvals
                .Where(a => a.CurrentStage == "final_release" && a.Status == "pending" && a.Documents.Any())
                .Include(a => a.CreatedByUser)
                .Include(a => a.Documents).ThenInclude(ad => ad.Document).ThenInclude(d => d!.Owner)
                .Include(a => a.Documents).ThenInclude(ad => ad.Version)
                .OrderByDescending(a => a.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            var totalCount = await context.Approvals
                .CountAsync(a => a.CurrentStage == "final_release" && a.Status == "pending" && a.Documents.Any());

            return Ok(new
            {
                success = true,
                data = approvals.Select(a => new
                {
                    a.ApprovalId,
                    a.CreatedBy,
                    createdByUserName = a.CreatedByUser?.FullName,
                    a.CreatedAt,
                    a.Status,
                    documentCount = a.Documents.Count,
                    a.TrackingCode,
                    documents = a.Documents.Select(ToQueueDocument),
                }),
                count = approvals.Count,
                totalCount,
                totalPages = (int)Math.Ceiling((double)totalCount / pageSize),
                page,
                pageSize,
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Accept - Move to Manager Review Stage
    /// </summary>
    [HttpPost("{approvalId}/qa-accept")]
    public async Task<ActionResult<object>> QaAcceptAsync(Guid approvalId, [FromBody] QaActionRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approval = await context.Approvals.FindAsync(approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            if (!await CurrentUserHasApprovalPermissionAsync(approvalId, userId, rp => rp.Approve))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Approve permission" });

            if (approval.CurrentStage != "qa_review")
                return BadRequest(new { success = false, error = "Approval is not in QA review stage" });

            approval.CurrentStage = "manager_review";
            approval.Status = "pending";
            approval.QaNotes = request.Notes;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "QA_ACCEPTED", new
            {
                approvalId = approval.ApprovalId,
                notes = request.Notes,
            });

            await NotifyBatchOwnersAsync(approvalId, userId, "Your document was accepted by QA", "Now moving to Manager Review.");

            return Ok(new
            {
                success = true,
                data = new
                {
                    approval.ApprovalId,
                    approval.CurrentStage,
                    approval.Status,
                    approval.QaNotes,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Request Correction - Creates task and stays in QA review
    /// </summary>
    [HttpPost("{approvalId}/qa-request-correction")]
    public async Task<ActionResult<object>> QaRequestCorrectionAsync(Guid approvalId, [FromBody] QaCorrectionRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approval = await context.Approvals.FindAsync(approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            if (!await CurrentUserHasApprovalPermissionAsync(approvalId, userId, rp => rp.Reject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            approval.QaNotes = request.Notes;
            approval.Status = "correction_requested";

            // Create task for the assignee
            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                Title = request.TaskTitle,
                Description = request.TaskDescription,
                AssignedToId = request.AssignToUserId,
                Status = "open",
                RiskSeverity = "high",
                DueDate = request.DueDate,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            context.Tasks.Add(task);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "QA_CORRECTION_REQUESTED", new
            {
                approvalId = approval.ApprovalId,
                taskId = task.TaskId,
                notes = request.Notes,
            });

            await NotifyBatchOwnersAsync(approvalId, userId, "QA requested a correction on your document", request.Notes);

            return Ok(new
            {
                success = true,
                data = new
                {
                    approval.ApprovalId,
                    approval.CurrentStage,
                    approval.Status,
                    approval.QaNotes,
                    taskId = task.TaskId,
                    taskTitle = task.Title,
                    assignedToId = task.AssignedToId,
                    dueDate = task.DueDate,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Manager Approve - Move to Final Release
    /// </summary>
    [HttpPost("{approvalId}/manager-approve")]
    public async Task<ActionResult<object>> ManagerApproveAsync(Guid approvalId, [FromBody] ManagerActionRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approval = await context.Approvals.FindAsync(approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            if (!await CurrentUserHasApprovalPermissionAsync(approvalId, userId, rp => rp.Approve))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Approve permission" });

            if (approval.CurrentStage != "manager_review")
                return BadRequest(new { success = false, error = "Approval is not in manager review stage" });

            approval.CurrentStage = "final_release";
            approval.Status = "pending";
            approval.ManagerNotes = request.Notes;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "MANAGER_APPROVED", new
            {
                approvalId = approval.ApprovalId,
                notes = request.Notes,
            });

            await NotifyBatchOwnersAsync(approvalId, userId, "Your document was approved by the Manager", "Now moving to Final Release.");

            return Ok(new
            {
                success = true,
                data = new
                {
                    approval.ApprovalId,
                    approval.CurrentStage,
                    approval.Status,
                    approval.ManagerNotes,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Manager Reject with Correction Task
    /// </summary>
    [HttpPost("{approvalId}/manager-reject")]
    public async Task<ActionResult<object>> ManagerRejectAsync(Guid approvalId, [FromBody] ManagerRejectRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approval = await context.Approvals.FindAsync(approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            if (!await CurrentUserHasApprovalPermissionAsync(approvalId, userId, rp => rp.Reject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            approval.CurrentStage = "manager_review";
            approval.Status = "correction_requested";
            approval.ManagerNotes = request.RejectionReason;

            // Create correction task
            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                Title = request.TaskTitle,
                Description = request.TaskDescription,
                AssignedToId = request.AssignToUserId,
                Status = "open",
                RiskSeverity = "high",
                DueDate = request.DueDate,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            context.Tasks.Add(task);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "MANAGER_REJECTED", new
            {
                approvalId = approval.ApprovalId,
                taskId = task.TaskId,
                reason = request.RejectionReason,
            });

            await NotifyBatchOwnersAsync(approvalId, userId, "Your document was rejected by the Manager", request.RejectionReason);

            return Ok(new
            {
                success = true,
                data = new
                {
                    approval.ApprovalId,
                    approval.CurrentStage,
                    approval.Status,
                    approval.ManagerNotes,
                    taskId = task.TaskId,
                    taskTitle = task.Title,
                    assignedToId = task.AssignedToId,
                    dueDate = task.DueDate,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Manager Self-Correction (PRD Option 2) - the manager uploads the fixed
    /// file directly instead of routing a correction task back to the team
    /// member. Bumps the document's minor version and sends the batch straight
    /// to Final Release, bypassing Stage 2's normal manager-approve step.
    /// Only supported for single-document batches — a multi-document batch
    /// can't unambiguously say which document the uploaded file replaces, so
    /// those must go through the correction-task path instead.
    /// </summary>
    [HttpPost("{approvalId}/manager-self-correct")]
    public async Task<ActionResult<object>> ManagerSelfCorrectAsync(Guid approvalId, IFormFile file, [FromForm] string rejectionReason)
    {
        try
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, error = "File is required" });

            var userId = GetCurrentUserId();
            var approval = await context.Approvals
                .Include(a => a.Documents)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            if (!await CurrentUserHasApprovalPermissionAsync(approvalId, userId, rp => rp.Reject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            if (approval.CurrentStage != "manager_review")
                return BadRequest(new { success = false, error = "Approval is not in manager review stage" });

            if (approval.Documents.Count != 1)
                return BadRequest(new { success = false, error = "Self-correction only supports single-document batches — use a correction task for multi-document batches" });

            var approvalDocument = approval.Documents.First();
            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == approvalDocument.DocumentId);
            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            var currentVersion = await context.DocumentVersions.FindAsync(approvalDocument.VersionId);

            string sha256Hash;
            using (var sha256 = SHA256.Create())
            {
                var hash = await sha256.ComputeHashAsync(file.OpenReadStream());
                sha256Hash = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
            }
            file.OpenReadStream().Seek(0, SeekOrigin.Begin);

            var majorVersion = currentVersion?.MajorVersion ?? 1;
            var minorVersion = (currentVersion?.MinorVersion ?? 0) + 1;

            var newVersion = new DmsDocumentVersion
            {
                VersionId = Guid.NewGuid(),
                DocumentId = document.DocumentId,
                VersionNumber = $"{majorVersion}.{minorVersion}",
                MajorVersion = majorVersion,
                MinorVersion = minorVersion,
                FileName = file.FileName,
                FileSizeBytes = file.Length,
                MimeType = file.ContentType,
                Sha256Hash = sha256Hash,
                Status = "draft",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            var objectKey = $"documents/{document.DocumentId}/{newVersion.VersionId}/{file.FileName}";
            await minioService.UploadAsync(objectKey, file.OpenReadStream(), file.ContentType ?? "application/octet-stream");
            newVersion.S3ObjectKey = objectKey;

            context.DocumentVersions.Add(newVersion);
            document.CurrentVersionId = newVersion.VersionId;
            document.UpdatedAt = DateTime.UtcNow;
            approvalDocument.VersionId = newVersion.VersionId;

            approval.CurrentStage = "final_release";
            approval.Status = "pending";
            approval.ManagerNotes = rejectionReason;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "MANAGER_SELF_CORRECTED", new
            {
                approvalId = approval.ApprovalId,
                documentId = document.DocumentId,
                newVersionId = newVersion.VersionId,
                versionNumber = newVersion.VersionNumber,
                reason = rejectionReason,
            });

            await notificationService.NotifyDocumentOwnerAsync(document.DocumentId, userId, "The Manager corrected your document directly", "Now moving to Final Release.");

            return Ok(new
            {
                success = true,
                data = new
                {
                    approval.ApprovalId,
                    approval.CurrentStage,
                    approval.Status,
                    newVersion.VersionId,
                    newVersion.VersionNumber,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Final Release - Generate tracking code(s) and release document(s)
    /// </summary>
    [HttpPost("{approvalId}/qa-final-release")]
    public async Task<ActionResult<object>> QaFinalReleaseAsync(Guid approvalId, [FromBody] FinalReleaseRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approval = await context.Approvals
                .Include(a => a.Documents)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            if (!await CurrentUserHasApprovalPermissionAsync(approvalId, userId, rp => rp.Approve))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Approve permission" });

            if (approval.CurrentStage != "final_release")
                return BadRequest(new { success = false, error = "Approval is not in final release stage" });

            var documentIds = approval.Documents.Select(d => d.DocumentId).ToList();
            var documents = await context.Documents
                .Where(d => documentIds.Contains(d.DocumentId))
                .ToListAsync();

            // Each document gets its own atomic tracking code ([DEPT]-[YEAR]-[CATEGORY]-[SEQ]),
            // per the PRD's terminal compliance gate — a manually supplied TrackingCode
            // only applies when the batch is a single document (otherwise it's ambiguous
            // which document it's meant for, so every document auto-generates its own).
            foreach (var doc in documents)
            {
                if (!string.IsNullOrWhiteSpace(doc.TrackingCode))
                    continue;

                doc.TrackingCode = documents.Count == 1 && !string.IsNullOrWhiteSpace(request.TrackingCode)
                    ? request.TrackingCode!
                    : await GenerateTrackingCodeAsync(doc, request.DeptCodeOverride, request.CategoryOverride);

                doc.Status = "RELEASED";
            }

            approval.TrackingCode = string.Join(", ", documents.Select(d => d.TrackingCode));
            approval.CurrentStage = "released";
            approval.Status = "approved";
            approval.ReleaseNotes = request.ReleaseNotes;

            await context.SaveChangesAsync();

            // The version's SHA-256 hash was captured at upload time; recording it here
            // ties the permanent hash to the exact moment of release in the WORM-protected
            // audit ledger (dms_audit_trails rejects UPDATE/DELETE at the DB level).
            var releasedVersionIds = approval.Documents.Select(ad => ad.VersionId).ToList();
            var versionHashes = await context.DocumentVersions
                .Where(v => releasedVersionIds.Contains(v.VersionId))
                .Select(v => new { v.DocumentId, v.Sha256Hash })
                .ToListAsync();

            await auditService.LogAsync(userId, "QA_FINAL_RELEASE", new
            {
                approvalId = approval.ApprovalId,
                releasedDocuments = documents.Select(d => new { d.DocumentId, d.TrackingCode }),
                sha256Hashes = versionHashes,
            });

            foreach (var released in documents)
                await notificationService.NotifyDocumentOwnerAsync(released.DocumentId, userId, "Your document was released", $"Tracking code: {released.TrackingCode}");

            return Ok(new
            {
                success = true,
                data = new
                {
                    approval.ApprovalId,
                    approval.CreatedBy,
                    approval.CreatedAt,
                    approval.CurrentStage,
                    approval.Status,
                    approval.TrackingCode,
                    approval.ReleaseNotes,
                    documents = documents.Select(d => new { d.DocumentId, d.TrackingCode }),
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    private static object ToQueueDocument(DmsApprovalDocument approvalDocument)
    {
        var document = approvalDocument.Document;
        var version = approvalDocument.Version;

        return new
        {
            approvalDocument.DocumentId,
            approvalDocument.VersionId,
            fileName = version?.FileName ?? document?.Title ?? "Untitled document",
            ownerName = document?.Owner?.FullName ?? "Unknown owner",
            department = document?.Department ?? "Not assigned",
            status = document?.Status ?? "pending",
            originalDocumentId = document?.OriginalDocumentId,
            hasDocId = !string.IsNullOrWhiteSpace(document?.OriginalDocumentId),
        };
    }
}

// Request DTOs
public record SubmitApprovalRequest(List<Guid> DocumentIds);
public record QaActionRequest(string? Notes = null);
public record QaCorrectionRequest(string TaskTitle, string TaskDescription, Guid AssignToUserId, DateTime DueDate, string? Notes = null);
public record ManagerActionRequest(string? Notes = null);
public record ManagerRejectRequest(string RejectionReason, string TaskTitle, string TaskDescription, Guid AssignToUserId, DateTime DueDate);
public record FinalReleaseRequest(string? TrackingCode = null, string? DeptCodeOverride = null, string? CategoryOverride = null, string? ReleaseNotes = null);
