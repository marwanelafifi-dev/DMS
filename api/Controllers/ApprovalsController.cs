using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/approvals")]
public class ApprovalsController(DmsContext context, AuditService auditService, MinioService minioService) : BaseController
{
    /// <summary>
    /// Submit documents for approval (C-Doc Stage 0).
    /// Creates a batch approval record and transitions documents from draft to qa_review.
    /// </summary>
    [HttpPost("submit-batch")]
    public async Task<IActionResult> SubmitDocumentsForApprovalAsync([FromBody] SubmitDocumentsForApprovalRequest request)
    {
        try
        {
            var currentUserId = GetCurrentUserId();

            var documents = await context.DocumentVersions
                .Include(dv => dv.Document)
                .Where(dv => request.DocumentIds.Contains(dv.DocumentId))
                .ToListAsync();

            if (documents.Count == 0)
                return BadRequest(new { success = false, error = "No documents found with the specified IDs" });

            var groupedByUser = documents.GroupBy(d => d.Document!.OwnerId);
            if (groupedByUser.Count() > 1 || groupedByUser.FirstOrDefault()?.Key != currentUserId)
                return BadRequest(new { success = false, error = "All documents must belong to the current user" });

            if (documents.Any(d => d.Status != CDocStatus.Draft))
                return BadRequest(new { success = false, error = "All documents must be in draft status" });

            var approval = new DmsApproval
            {
                ApprovalId = Guid.NewGuid(),
                CreatedAt = DateTime.UtcNow,
                CreatedBy = currentUserId,
                Status = "pending_qa_review",
                ApprovalNotes = request.ApprovalNotes,
                DocumentCategory = request.Category,
                QaDecision = "pending",
                ManagerDecision = "pending"
            };

            context.Approvals.Add(approval);

            var approvalDocuments = new List<DmsApprovalDocument>();
            foreach (var docVersion in documents)
            {
                approvalDocuments.Add(new DmsApprovalDocument
                {
                    ApprovalDocumentId = Guid.NewGuid(),
                    ApprovalId = approval.ApprovalId,
                    DocumentId = docVersion.DocumentId,
                    VersionId = docVersion.VersionId,
                    AddedAt = DateTime.UtcNow
                });

                docVersion.Status = CDocStatus.QaReview;
                docVersion.Document!.Status = CDocStatus.QaReview;
                docVersion.SubmittedAt = DateTime.UtcNow;
                docVersion.SubmittedById = currentUserId;
                docVersion.UpdatedAt = DateTime.UtcNow;
            }

            context.ApprovalDocuments.AddRange(approvalDocuments);

            await auditService.LogAsync(
                currentUserId,
                "DOCUMENT_SUBMITTED_FOR_APPROVAL",
                new
                {
                    approvalId = approval.ApprovalId,
                    documentCount = documents.Count,
                    documentIds = documents.Select(d => d.DocumentId).ToList(),
                    category = request.Category,
                    notes = request.ApprovalNotes
                }
            );

            await context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                data = new { approvalId = approval.ApprovalId, submittedDocuments = documents.Count, approvalUrl = $"/approvals/{approval.ApprovalId}" },
                message = $"{documents.Count} document(s) submitted for approval"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get QA review queue (C-Doc Stage 1). Returns approvals awaiting QA decision.
    /// </summary>
    [HttpGet("qa-review-queue")]
    public async Task<IActionResult> GetQaReviewQueueAsync([FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        try
        {
            var approvals = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document).ThenInclude(d => d.Owner)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .Include(a => a.CreatedByUser)
                .Where(a => a.QaDecision == "pending" && a.Status == "pending_qa_review")
                .OrderByDescending(a => a.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            var totalCount = await context.Approvals
                .CountAsync(a => a.QaDecision == "pending" && a.Status == "pending_qa_review");

            var data = approvals.Select(a => new
            {
                approvalId = a.ApprovalId,
                createdAt = a.CreatedAt,
                createdByUserName = a.CreatedByUser?.FullName,
                documentCount = a.ApprovalDocuments.Count,
                status = a.Status,
                qaDecision = a.QaDecision,
                approvalNotes = a.ApprovalNotes,
                documents = a.ApprovalDocuments.Select(ad => ToQueueDocumentDto(ad)).ToList()
            }).ToList();

            return Ok(new
            {
                success = true,
                data,
                count = data.Count,
                page,
                pageSize,
                totalCount,
                totalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get manager review queue (documents accepted by QA, awaiting manager decision).
    /// </summary>
    [HttpGet("manager-review-queue")]
    public async Task<IActionResult> GetManagerReviewQueueAsync([FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        try
        {
            var approvals = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document).ThenInclude(d => d.Owner)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .Include(a => a.CreatedByUser)
                .Where(a => a.QaDecision == "accepted" && a.ManagerDecision == "pending")
                .OrderByDescending(a => a.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            var totalCount = await context.Approvals
                .CountAsync(a => a.QaDecision == "accepted" && a.ManagerDecision == "pending");

            var data = approvals.Select(a => new
            {
                approvalId = a.ApprovalId,
                createdAt = a.CreatedAt,
                createdByUserName = a.CreatedByUser?.FullName,
                documentCount = a.ApprovalDocuments.Count,
                status = a.Status,
                qaNotes = a.QaNotes,
                documents = a.ApprovalDocuments.Select(ad => ToQueueDocumentDto(ad)).ToList()
            }).ToList();

            return Ok(new
            {
                success = true,
                data,
                count = data.Count,
                page,
                pageSize,
                totalCount,
                totalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get final release queue (documents approved by manager, awaiting QA release).
    /// </summary>
    [HttpGet("final-release-queue")]
    public async Task<IActionResult> GetFinalReleaseQueueAsync([FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        try
        {
            var approvals = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document).ThenInclude(d => d.Owner)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .Include(a => a.CreatedByUser)
                .Where(a => a.Status == CDocStatus.QaFinalReview)
                .OrderByDescending(a => a.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            var totalCount = await context.Approvals.CountAsync(a => a.Status == CDocStatus.QaFinalReview);

            var data = approvals.Select(a => new
            {
                approvalId = a.ApprovalId,
                createdAt = a.CreatedAt,
                createdByUserName = a.CreatedByUser?.FullName,
                documentCount = a.ApprovalDocuments.Count,
                status = a.Status,
                documents = a.ApprovalDocuments.Select(ad => ToQueueDocumentDto(ad)).ToList()
            }).ToList();

            return Ok(new
            {
                success = true,
                data,
                count = data.Count,
                page,
                pageSize,
                totalCount,
                totalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Accept approval (C-Doc Stage 1). Accepts documents, unlocks manager approval.
    /// </summary>
    [HttpPost("{approvalId}/qa-accept")]
    public async Task<IActionResult> QaAcceptApprovalAsync(Guid approvalId, [FromBody] QaDecisionRequest request)
    {
        try
        {
            var currentUserId = GetCurrentUserId();

            var approval = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            var roleCheck = await RequireApprovalPermissionAsync(approval, currentUserId, rp => rp.Approve, "approve");
            if (roleCheck != null) return roleCheck;

            if (approval.QaDecision != "pending")
                return BadRequest(new { success = false, error = "This approval has already been reviewed by QA" });

            var missingDocId = approval.ApprovalDocuments
                .Where(ad => string.IsNullOrWhiteSpace(ad.Document.OriginalDocumentId))
                .Select(ad => new { documentId = ad.DocumentId, fileName = ad.Version.FileName })
                .ToList();

            if (missingDocId.Count > 0)
            {
                return BadRequest(new
                {
                    success = false,
                    error = "Document ID must be set before QA can approve this document",
                    missingDocumentIds = missingDocId
                });
            }

            approval.QaDecision = "accepted";
            approval.Status = "manager_review";
            approval.QaNotes = request.Notes;
            approval.QaReviewedBy = currentUserId;
            approval.QaReviewedAt = DateTime.UtcNow;

            foreach (var appDoc in approval.ApprovalDocuments)
            {
                appDoc.Version.Status = CDocStatus.ManagerReview;
                appDoc.Document.Status = CDocStatus.ManagerReview;
                appDoc.Version.UpdatedAt = DateTime.UtcNow;
            }

            await auditService.LogAsync(
                currentUserId,
                "QA_APPROVED_DOCUMENTS",
                new
                {
                    approvalId = approval.ApprovalId,
                    documentCount = approval.ApprovalDocuments.Count,
                    qaReviewedAt = approval.QaReviewedAt,
                    notes = request.Notes
                }
            );

            await context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = "Documents accepted by QA. Manager approval is now unlocked.",
                data = new { approvalId = approval.ApprovalId, status = approval.Status }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Request Correction (C-Doc Stage 1). Creates a correction task and locks manager approval.
    /// </summary>
    [HttpPost("{approvalId}/qa-request-correction")]
    public async Task<IActionResult> QaRequestCorrectionAsync(Guid approvalId, [FromBody] QaRequestCorrectionRequest request)
    {
        try
        {
            var currentUserId = GetCurrentUserId();

            var approval = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            var roleCheck = await RequireApprovalPermissionAsync(approval, currentUserId, rp => rp.Reject, "reject");
            if (roleCheck != null) return roleCheck;

            if (approval.QaDecision != "pending")
                return BadRequest(new { success = false, error = "This approval has already been reviewed by QA" });

            var assignee = await context.Users.FirstOrDefaultAsync(u => u.UserId == request.AssignToUserId);
            if (assignee == null)
                return BadRequest(new { success = false, error = "Assigned user not found" });

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                Title = $"Correction: {request.TaskDescription}",
                Description = request.QaNotesComments,
                TaskType = "CORRECTION",
                AssignedToId = request.AssignToUserId,
                RiskSeverity = "HIGH",
                Status = "open",
                DueDate = request.DueDate,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            context.Tasks.Add(task);

            approval.QaDecision = "requested_correction";
            approval.Status = CDocStatus.CorrectionInProgress;
            approval.QaNotes = request.QaNotesComments;
            approval.QaReviewedBy = currentUserId;
            approval.QaReviewedAt = DateTime.UtcNow;
            approval.CorrectionTaskId = task.TaskId;

            foreach (var appDoc in approval.ApprovalDocuments)
            {
                appDoc.Version.Status = CDocStatus.CorrectionInProgress;
                appDoc.Document.Status = CDocStatus.CorrectionInProgress;
                appDoc.Version.UpdatedAt = DateTime.UtcNow;
            }

            await auditService.LogAsync(
                currentUserId,
                "QA_REQUESTED_CORRECTION",
                new
                {
                    approvalId = approval.ApprovalId,
                    taskId = task.TaskId,
                    assignedTo = assignee.FullName,
                    dueDate = request.DueDate,
                    qaFeedback = request.QaNotesComments
                }
            );

            await context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"Correction task created and assigned to {assignee.FullName}",
                data = new { taskId = task.TaskId, approvalId = approval.ApprovalId, status = approval.Status }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Manager Approve (C-Doc Stage 2A). Approves documents and sends to final QA review.
    /// </summary>
    [HttpPost("{approvalId}/manager-approve")]
    public async Task<IActionResult> ManagerApproveAsync(Guid approvalId, [FromBody] ManagerApprovalRequest request)
    {
        try
        {
            var currentUserId = GetCurrentUserId();

            var approval = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            var roleCheck = await RequireApprovalPermissionAsync(approval, currentUserId, rp => rp.Approve, "approve");
            if (roleCheck != null) return roleCheck;

            if (approval.QaDecision != "accepted")
                return BadRequest(new { success = false, error = "This approval has not yet been accepted by QA" });

            if (approval.ManagerDecision != "pending")
                return BadRequest(new { success = false, error = "This approval has already been reviewed by manager" });

            approval.ManagerDecision = "approved";
            approval.Status = CDocStatus.QaFinalReview;
            approval.ManagerNotes = request.Notes;
            approval.ManagerReviewedBy = currentUserId;
            approval.ManagerReviewedAt = DateTime.UtcNow;

            foreach (var appDoc in approval.ApprovalDocuments)
            {
                appDoc.Version.Status = CDocStatus.QaFinalReview;
                appDoc.Document.Status = CDocStatus.QaFinalReview;
                appDoc.Version.UpdatedAt = DateTime.UtcNow;
            }

            await auditService.LogAsync(
                currentUserId,
                "MANAGER_APPROVED_DOCUMENTS",
                new
                {
                    approvalId = approval.ApprovalId,
                    documentCount = approval.ApprovalDocuments.Count,
                    managerReviewedAt = approval.ManagerReviewedAt,
                    notes = request.Notes
                }
            );

            await context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = "Documents approved by manager. Sent to QA for final release.",
                data = new { approvalId = approval.ApprovalId, status = approval.Status }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Manager Reject with Correction Task (C-Doc Stage 2B, Path A).
    /// </summary>
    [HttpPost("{approvalId}/manager-reject-correction-task")]
    public async Task<IActionResult> ManagerRejectWithCorrectionAsync(Guid approvalId, [FromBody] ManagerRejectCorrectionRequest request)
    {
        try
        {
            var currentUserId = GetCurrentUserId();

            var approval = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            var roleCheck = await RequireApprovalPermissionAsync(approval, currentUserId, rp => rp.Reject, "reject");
            if (roleCheck != null) return roleCheck;

            if (approval.ManagerDecision != "pending")
                return BadRequest(new { success = false, error = "This approval has already been reviewed by manager" });

            var assignee = await context.Users.FirstOrDefaultAsync(u => u.UserId == request.AssignToUserId);
            if (assignee == null)
                return BadRequest(new { success = false, error = "Assigned user not found" });

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                Title = $"Correction: {request.TaskDescription}",
                Description = request.RejectionReason,
                TaskType = "CORRECTION",
                AssignedToId = request.AssignToUserId,
                RiskSeverity = "HIGH",
                Status = "open",
                DueDate = request.DueDate,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            context.Tasks.Add(task);

            approval.ManagerDecision = "rejected";
            approval.Status = CDocStatus.CorrectionInProgress;
            approval.ManagerNotes = request.RejectionReason;
            approval.ManagerReviewedBy = currentUserId;
            approval.ManagerReviewedAt = DateTime.UtcNow;
            approval.RejectionTrack = "a_issue_correction_task";
            approval.RejectionReason = request.RejectionReason;
            approval.CorrectionTaskId = task.TaskId;

            foreach (var appDoc in approval.ApprovalDocuments)
            {
                appDoc.Version.Status = CDocStatus.CorrectionInProgress;
                appDoc.Document.Status = CDocStatus.CorrectionInProgress;
                appDoc.Version.UpdatedAt = DateTime.UtcNow;
            }

            await auditService.LogAsync(
                currentUserId,
                "MANAGER_REJECTED_CORRECTION_TASK",
                new
                {
                    approvalId = approval.ApprovalId,
                    taskId = task.TaskId,
                    assignedTo = assignee.FullName,
                    rejectionReason = request.RejectionReason
                }
            );

            await context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"Documents rejected. Correction task assigned to {assignee.FullName}",
                data = new { taskId = task.TaskId, approvalId = approval.ApprovalId }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Manager Self-Correct (C-Doc Stage 2B, Path B).
    /// Manager uploads a corrected version directly, bypassing team correction.
    /// </summary>
    [HttpPost("{approvalId}/manager-self-correct")]
    public async Task<IActionResult> ManagerSelfCorrectAsync(Guid approvalId, [FromForm] ManagerSelfCorrectRequest request)
    {
        try
        {
            var currentUserId = GetCurrentUserId();

            if (request.File == null || request.File.Length == 0)
                return BadRequest(new { success = false, error = "No file provided" });

            var approval = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            var roleCheck = await RequireApprovalPermissionAsync(approval, currentUserId, rp => rp.Approve, "approve");
            if (roleCheck != null) return roleCheck;

            if (approval.ManagerDecision != "pending")
                return BadRequest(new { success = false, error = "This approval has already been reviewed by manager" });

            var firstAppDoc = approval.ApprovalDocuments.FirstOrDefault();
            if (firstAppDoc == null)
                return BadRequest(new { success = false, error = "No documents linked to approval" });

            byte[] fileBytes;
            using (var ms = new MemoryStream())
            {
                await request.File.CopyToAsync(ms);
                fileBytes = ms.ToArray();
            }

            var fileHash = ComputeSha256(fileBytes);
            var previousVersion = firstAppDoc.Version;
            var newMinorVersion = previousVersion.MinorVersion + 1;
            var s3ObjectKey = $"{firstAppDoc.DocumentId}/{Guid.NewGuid()}/{request.File.FileName}";

            using (var uploadStream = new MemoryStream(fileBytes))
            {
                await minioService.UploadAsync(s3ObjectKey, uploadStream, request.File.ContentType);
            }

            var newVersion = new DmsDocumentVersion
            {
                VersionId = Guid.NewGuid(),
                DocumentId = firstAppDoc.DocumentId,
                VersionNumber = $"{previousVersion.MajorVersion}.{newMinorVersion}",
                FileName = request.File.FileName,
                FileSizeBytes = fileBytes.Length,
                MimeType = request.File.ContentType,
                S3ObjectKey = s3ObjectKey,
                Sha256Hash = fileHash,
                Status = CDocStatus.QaFinalReview,
                MajorVersion = previousVersion.MajorVersion,
                MinorVersion = newMinorVersion,
                SubmittedById = currentUserId,
                SubmittedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            context.DocumentVersions.Add(newVersion);

            approval.ManagerDecision = "approved";
            approval.Status = CDocStatus.QaFinalReview;
            approval.ManagerReviewedBy = currentUserId;
            approval.ManagerReviewedAt = DateTime.UtcNow;
            approval.RejectionTrack = "b_manager_self_correct";
            approval.RejectionReason = request.RejectionReason;
            approval.ManagerUploadedCorrectionId = newVersion.VersionId;

            foreach (var appDoc in approval.ApprovalDocuments)
            {
                appDoc.VersionId = newVersion.VersionId;
                appDoc.Document.CurrentVersionId = newVersion.VersionId;
                appDoc.Document.Status = CDocStatus.QaFinalReview;
            }

            await auditService.LogAsync(
                currentUserId,
                "MANAGER_SELF_CORRECTED_DOCUMENT",
                new
                {
                    approvalId = approval.ApprovalId,
                    newVersionId = newVersion.VersionId,
                    fileName = request.File.FileName,
                    fileSize = fileBytes.Length,
                    rejectionReason = request.RejectionReason
                }
            );

            await context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = "Corrected version uploaded. Sent to QA for final release.",
                data = new { approvalId = approval.ApprovalId, versionId = newVersion.VersionId, status = approval.Status }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Generate Tracking Code (C-Doc Stage 3). Format: [DEPT]-[YEAR]-[CAT]-[SEQ].
    /// Idempotent: returns the existing code if already generated.
    /// </summary>
    [HttpPost("{approvalId}/generate-tracking-code")]
    public async Task<IActionResult> GenerateTrackingCodeAsync(Guid approvalId, [FromBody] GenerateTrackingCodeRequest request)
    {
        try
        {
            var (trackingCode, error) = await GenerateTrackingCodeInternalAsync(approvalId, request.DeptCode, request.Category);
            if (error != null)
                return BadRequest(new { success = false, error });

            await context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = "Tracking code generated",
                data = new { trackingCode }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // This app has no global user-role field — roles are granted per folder —
    // so approval decisions are gated by the Approve/Reject flags (editable on
    // the Roles admin page, see RolePermissionsController) of whatever role the
    // user holds on every folder the documents in this batch belong to.
    private async Task<IActionResult?> RequireApprovalPermissionAsync(DmsApproval approval, Guid userId, Func<DmsRolePermission, bool> hasPermission, string actionLabel)
    {
        var folderIds = approval.ApprovalDocuments.Select(ad => ad.Document.FolderId).Distinct().ToList();

        var userPermissions = await context.FolderPermissions
            .Where(p => folderIds.Contains(p.FolderId) && p.UserId == userId)
            .ToListAsync();

        var roleNames = userPermissions.Select(p => p.Role).Distinct().ToList();
        var rolePermissions = await context.RolePermissions
            .Where(rp => roleNames.Contains(rp.Role))
            .ToListAsync();

        bool HasPermissionOnFolder(Guid folderId)
        {
            var role = userPermissions.FirstOrDefault(p => p.FolderId == folderId)?.Role;
            if (role == null) return false;
            var rolePermission = rolePermissions.FirstOrDefault(rp => rp.Role == role);
            return rolePermission != null && hasPermission(rolePermission);
        }

        if (!folderIds.All(HasPermissionOnFolder))
        {
            return new ObjectResult(new { success = false, error = $"You don't have permission to {actionLabel} this approval" })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
        }

        return null;
    }

    private async Task<(string? trackingCode, string? error)> GenerateTrackingCodeInternalAsync(Guid approvalId, string? deptCode, string? category)
    {
        var approval = await context.Approvals
            .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document)
            .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

        if (approval == null)
            return (null, "Approval not found");

        var firstDoc = approval.ApprovalDocuments.FirstOrDefault()?.Document;
        if (firstDoc != null && !string.IsNullOrEmpty(firstDoc.TrackingCode))
            return (firstDoc.TrackingCode, null);

        var year = DateTime.UtcNow.Year;
        var dept = string.IsNullOrWhiteSpace(deptCode) ? "DMS" : deptCode;
        var cat = string.IsNullOrWhiteSpace(category) ? "DOC" : category;

        var sequence = await context.TrackingCodeSequences
            .FirstOrDefaultAsync(s => s.DeptCode == dept && s.Category == cat && s.Year == year);

        if (sequence == null)
        {
            sequence = new DmsTrackingCodeSequence
            {
                SequenceId = Guid.NewGuid(),
                DeptCode = dept,
                Category = cat,
                Year = year,
                NextSeq = 1
            };
            context.TrackingCodeSequences.Add(sequence);
        }

        var trackingCode = $"{dept}-{year}-{cat}-{sequence.NextSeq:D4}";
        sequence.NextSeq++;

        foreach (var appDoc in approval.ApprovalDocuments)
        {
            appDoc.Document.TrackingCode = trackingCode;
            appDoc.Document.UpdatedAt = DateTime.UtcNow;
        }

        return (trackingCode, null);
    }

    /// <summary>
    /// QA Final Release (C-Doc Stage 3). Marks documents as released with a
    /// tracking code and a permanent WORM audit trail entry.
    /// </summary>
    [HttpPost("{approvalId}/qa-final-release")]
    public async Task<IActionResult> QaFinalReleaseAsync(Guid approvalId, [FromBody] QaFinalReleaseRequest request)
    {
        try
        {
            var currentUserId = GetCurrentUserId();

            var approval = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document).ThenInclude(d => d.Owner)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            var roleCheck = await RequireApprovalPermissionAsync(approval, currentUserId, rp => rp.Approve, "release");
            if (roleCheck != null) return roleCheck;

            if (approval.ManagerDecision != "approved")
                return BadRequest(new { success = false, error = "This approval has not yet been approved by manager" });

            var (trackingCode, trackingError) = await GenerateTrackingCodeInternalAsync(approvalId, request.DeptCode, request.Category);
            if (trackingError != null)
                return BadRequest(new { success = false, error = trackingError });

            approval.Status = CDocStatus.Released;
            approval.ReleasedAt = DateTime.UtcNow;
            approval.ReleasedBy = currentUserId;
            approval.ReleaseNotes = request.ReleaseNotes;

            var fileHashes = new List<string>();
            var uploaderNames = new List<string>();

            foreach (var appDoc in approval.ApprovalDocuments)
            {
                appDoc.Version.Status = CDocStatus.Released;
                appDoc.Version.ApprovedById = currentUserId;
                appDoc.Version.ApprovedAt = DateTime.UtcNow;
                appDoc.Version.UpdatedAt = DateTime.UtcNow;
                appDoc.Document.Status = CDocStatus.Released;
                appDoc.Document.UpdatedAt = DateTime.UtcNow;
                fileHashes.Add(appDoc.Version.Sha256Hash);
                if (appDoc.Document.Owner != null)
                    uploaderNames.Add(appDoc.Document.Owner.FullName);
            }

            await auditService.LogAsync(
                currentUserId,
                "DOCUMENT_RELEASED",
                new
                {
                    approvalId = approval.ApprovalId,
                    documentCount = approval.ApprovalDocuments.Count,
                    trackingCode,
                    fileHashes,
                    uploaderNames,
                    releasedAt = approval.ReleasedAt,
                    releaseNotes = request.ReleaseNotes
                }
            );

            await context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"{approval.ApprovalDocuments.Count} document(s) released successfully",
                data = new
                {
                    approvalId = approval.ApprovalId,
                    trackingCodes = approval.ApprovalDocuments.Select(_ => trackingCode).ToList(),
                    releasedAt = approval.ReleasedAt
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get single approval with full details.
    /// </summary>
    [HttpGet("{approvalId}")]
    public async Task<IActionResult> GetApprovalAsync(Guid approvalId)
    {
        try
        {
            var approval = await context.Approvals
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Document)
                .Include(a => a.ApprovalDocuments).ThenInclude(ad => ad.Version)
                .Include(a => a.CreatedByUser)
                .Include(a => a.QaReviewedByUser)
                .Include(a => a.ManagerReviewedByUser)
                .Include(a => a.ReleasedByUser)
                .Include(a => a.CorrectionTask)
                .FirstOrDefaultAsync(a => a.ApprovalId == approvalId);

            if (approval == null)
                return NotFound(new { success = false, error = "Approval not found" });

            return Ok(new
            {
                success = true,
                data = new
                {
                    approvalId = approval.ApprovalId,
                    createdAt = approval.CreatedAt,
                    createdByUserName = approval.CreatedByUser?.FullName,
                    approvalNotes = approval.ApprovalNotes,
                    documentCategory = approval.DocumentCategory,
                    status = approval.Status,
                    qaDecision = approval.QaDecision,
                    qaNotes = approval.QaNotes,
                    qaReviewedByName = approval.QaReviewedByUser?.FullName,
                    qaReviewedAt = approval.QaReviewedAt,
                    managerDecision = approval.ManagerDecision,
                    managerNotes = approval.ManagerNotes,
                    managerReviewedByName = approval.ManagerReviewedByUser?.FullName,
                    managerReviewedAt = approval.ManagerReviewedAt,
                    rejectionTrack = approval.RejectionTrack,
                    rejectionReason = approval.RejectionReason,
                    correctionTask = approval.CorrectionTask == null ? null : new
                    {
                        taskId = approval.CorrectionTask.TaskId,
                        title = approval.CorrectionTask.Title,
                        status = approval.CorrectionTask.Status,
                        dueDate = approval.CorrectionTask.DueDate,
                        completedAt = approval.CorrectionTask.CompletedAt
                    },
                    releasedAt = approval.ReleasedAt,
                    releasedByName = approval.ReleasedByUser?.FullName,
                    releaseNotes = approval.ReleaseNotes,
                    documentCount = approval.ApprovalDocuments.Count,
                    documents = approval.ApprovalDocuments.Select(ad => new
                    {
                        documentId = ad.DocumentId,
                        fileName = ad.Version.FileName,
                        fileSize = ad.Version.FileSizeBytes ?? 0,
                        status = ad.Version.Status,
                        uploadedAt = ad.Version.CreatedAt,
                        trackingCode = ad.Document.TrackingCode,
                        originalDocumentId = ad.Document.OriginalDocumentId,
                        hasDocId = !string.IsNullOrWhiteSpace(ad.Document.OriginalDocumentId)
                    }).ToList()
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    private static readonly string[] CDocAuditActions =
    [
        "DOCUMENT_SUBMITTED_FOR_APPROVAL",
        "QA_APPROVED_DOCUMENTS",
        "QA_REQUESTED_CORRECTION",
        "MANAGER_APPROVED_DOCUMENTS",
        "MANAGER_REJECTED_CORRECTION_TASK",
        "MANAGER_SELF_CORRECTED_DOCUMENT",
        "DOCUMENT_RELEASED",
        AuditActions.CORRECTION_TASK_COMPLETED,
    ];

    /// <summary>
    /// Full chronological audit trail for one approval, built from the WORM-protected
    /// audit log rather than the approval row's current-state fields — so history
    /// survives stage loop-backs (e.g. a QA rejection followed by re-acceptance).
    /// </summary>
    [HttpGet("{approvalId}/audit-trail")]
    public async Task<IActionResult> GetApprovalAuditTrailAsync(Guid approvalId)
    {
        try
        {
            var approvalIdString = approvalId.ToString();

            var candidates = await context.AuditTrails
                .Where(a => CDocAuditActions.Contains(a.Action))
                .OrderBy(a => a.CreatedAt)
                .ToListAsync();

            var matches = candidates
                .Where(a => a.Metadata != null
                    && a.Metadata.RootElement.TryGetProperty("approvalId", out var idProp)
                    && idProp.GetString() == approvalIdString)
                .ToList();

            var userIds = matches.Select(a => a.UserId).Distinct().ToList();
            var userNames = await context.Users
                .Where(u => userIds.Contains(u.UserId))
                .ToDictionaryAsync(u => u.UserId, u => u.FullName);

            var events = matches.Select(a => new
            {
                action = a.Action,
                userName = userNames.GetValueOrDefault(a.UserId, "Unknown user"),
                createdAt = a.CreatedAt,
                metadata = a.Metadata
            });

            return Ok(new { success = true, data = events });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    private static object ToQueueDocumentDto(DmsApprovalDocument ad) => new
    {
        documentId = ad.DocumentId,
        versionId = ad.VersionId,
        fileName = ad.Version.FileName,
        ownerName = ad.Document.Owner?.FullName ?? "Unknown",
        department = ad.Document.Department ?? "General",
        status = ad.Version.Status,
        tags = ad.Document.Tags,
        originalDocumentId = ad.Document.OriginalDocumentId,
        hasDocId = !string.IsNullOrWhiteSpace(ad.Document.OriginalDocumentId),
    };

    private static string ComputeSha256(byte[] data)
    {
        var hash = SHA256.HashData(data);
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }
}

// === REQUEST DTOs ===

public class SubmitDocumentsForApprovalRequest
{
    public List<Guid> DocumentIds { get; set; } = new();
    public string? ApprovalNotes { get; set; }
    public string? Category { get; set; }
}

public class QaDecisionRequest
{
    public string? Notes { get; set; }
}

public class QaRequestCorrectionRequest
{
    public string QaNotesComments { get; set; } = string.Empty;
    public string TaskDescription { get; set; } = string.Empty;
    public Guid AssignToUserId { get; set; }
    public DateTime DueDate { get; set; }
}

public class ManagerApprovalRequest
{
    public string? Notes { get; set; }
}

public class ManagerRejectCorrectionRequest
{
    public string RejectionReason { get; set; } = string.Empty;
    public string TaskDescription { get; set; } = string.Empty;
    public Guid AssignToUserId { get; set; }
    public DateTime DueDate { get; set; }
}

public class ManagerSelfCorrectRequest
{
    public IFormFile? File { get; set; }
    public string RejectionReason { get; set; } = string.Empty;
}

public class GenerateTrackingCodeRequest
{
    public string? DeptCode { get; set; }
    public string? Category { get; set; }
}

public class QaFinalReleaseRequest
{
    public string? DeptCode { get; set; }
    public string? Category { get; set; }
    public string? ReleaseNotes { get; set; }
}
