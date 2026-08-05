using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/approvals")]
public class ApprovalsController(DmsContext context, AuditService auditService, AccessOverrideService accessOverrideService, MinioService minioService, NotificationService notificationService, TaskService taskService) : BaseController
{
    // A role's CanViewApprovals only says whether the C-Doc Workflow page exists for
    // them at all — CanViewQaStage/CanViewManagerStage/CanViewFinalReleaseStage scope
    // it down to individual stage tabs (e.g. Manager only ever needed Stage 2), and
    // CanApprove/CanReject say whether this role can actually act, not just view.
    // Deliberately independent of per-folder role grants (DmsFolderPermission) and
    // File/Folder Permission overrides — those govern file/folder MANAGEMENT actions
    // only (upload/rename/copy/cut/delete/...), never approve/reject on a document. No
    // page-access role at all (or a role not found) falls back to "no access".
    private async Task<bool> CurrentUserHasStageAccessAsync(Guid userId, Func<DmsPageAccessRole, bool> selector)
    {
        var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
        return pageAccessRole != null && selector(pageAccessRole);
    }

    // CanApprove/CanReject/CanViewXStage are independent of folder permissions
    // by design (see the class-level comment above) — but a Deny-Read
    // override on the document's specific folder should still be able to
    // pull it back out of a reviewer's reach, per explicit follow-up request.
    private async Task<ActionResult<object>?> RequireFolderReadAccessAsync(Guid userId, Guid documentId)
    {
        var folderId = await context.Documents.Where(d => d.DocumentId == documentId).Select(d => (Guid?)d.FolderId).FirstOrDefaultAsync();
        if (folderId.HasValue && !await HasFolderReadAccessAsync(context, accessOverrideService, userId, folderId.Value))
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have access to this document's folder" });
        return null;
    }

    private static bool StageAllowsAccessCheck(string currentStage, bool canViewQa, bool canViewManager, bool canViewFinal) => currentStage switch
    {
        "qa_review" => canViewQa,
        "manager_review" => canViewManager,
        "final_release" => canViewFinal,
        _ => true, // released/rejected — already out of the stage-gated part of the workflow
    };

    // A correction task assigned to a Group has no single inbox — every member
    // is notified individually instead of just the (nonexistent) single assignee.
    private async Task NotifyTaskAssigneeAsync(DmsTask task, Guid actorUserId, string title)
    {
        if (task.AssignedToId.HasValue)
        {
            await notificationService.NotifyAsync(task.AssignedToId.Value, actorUserId, title, task.Title, taskId: task.TaskId);
        }
        else if (task.AssignedToGroupId.HasValue)
        {
            foreach (var memberId in await taskService.GetGroupMemberIdsAsync(task.AssignedToGroupId.Value))
                await notificationService.NotifyAsync(memberId, actorUserId, title, task.Title, taskId: task.TaskId);
        }
    }

    /// <summary>
    /// Submit documents for approval (C-Doc Stage 1). One dms_approvals row still
    /// groups everything uploaded together for submitter/creation-time context, but
    /// each document gets its own dms_approval_documents row with independent
    /// stage/status tracking from here on — see 058_approval_document_stage_tracking.sql.
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
                    CurrentStage = "qa_review",
                    Status = "pending",
                });

                // Keep the document/version status in sync with the batch's QA-review
                // stage — this endpoint previously left both untouched, so the Document
                // Library kept showing "Draft" even though the batch was already visible
                // and pending in the C-Doc Workflow queue.
                version.Status = "pending_approval";
                version.SubmittedById = userId;
                version.SubmittedAt = DateTime.UtcNow;
                version.UpdatedAt = DateTime.UtcNow;
            }

            foreach (var document in documents)
            {
                document.Status = "pending_approval";
                document.UpdatedAt = DateTime.UtcNow;
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
    /// Get full detail for a single document's place in the C-Doc Workflow (used
    /// by the review modal) — independent of any other document submitted in the
    /// same batch.
    /// </summary>
    [HttpGet("{approvalId}/documents/{documentId}")]
    public async Task<ActionResult<object>> GetApprovalDocumentAsync(Guid approvalId, Guid documentId)
    {
        try
        {
            var approvalDocument = await context.ApprovalDocuments
                .Include(ad => ad.Approval).ThenInclude(a => a!.CreatedByUser)
                .Include(ad => ad.Document).ThenInclude(d => d!.Owner)
                .Include(ad => ad.Version)
                .FirstOrDefaultAsync(ad => ad.ApprovalId == approvalId && ad.DocumentId == documentId);

            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Approval document not found" });

            var userId = GetCurrentUserId();
            var access = await GetPageAccessRoleAsync(context, userId);
            if (!StageAllowsAccessCheck(approvalDocument.CurrentStage, access?.CanViewQaStage == true, access?.CanViewManagerStage == true, access?.CanViewFinalReleaseStage == true))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to this document's current stage" });

            if (approvalDocument.Document != null && !await HasFolderReadAccessAsync(context, accessOverrideService, userId, approvalDocument.Document.FolderId))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have access to this document's folder" });

            return Ok(new
            {
                success = true,
                data = new
                {
                    approvalDocument.ApprovalId,
                    approvalDocument.DocumentId,
                    approvalDocument.VersionId,
                    CreatedBy = approvalDocument.Approval?.CreatedBy,
                    createdByUserName = approvalDocument.Approval?.CreatedByUser?.FullName,
                    approvalDocument.CreatedAt,
                    approvalDocument.CurrentStage,
                    // Named ApprovalStatus (not Status) — Document?.Status below is the
                    // document's own generic lifecycle status and needs its own JSON key;
                    // both named "status" once camelCased collided and crashed serialization.
                    ApprovalStatus = approvalDocument.Status,
                    approvalDocument.QaNotes,
                    approvalDocument.ManagerNotes,
                    approvalDocument.ReleaseNotes,
                    fileName = approvalDocument.Version?.FileName ?? approvalDocument.Document?.Title ?? "Untitled document",
                    ownerName = approvalDocument.Document?.Owner?.FullName ?? "Unknown owner",
                    department = approvalDocument.Document?.Department,
                    category = approvalDocument.Document?.Category,
                    originalDocumentId = approvalDocument.Document?.OriginalDocumentId,
                    status = approvalDocument.Document?.Status,
                    versionNumber = approvalDocument.Version?.VersionNumber,
                    fileSizeBytes = approvalDocument.Version?.FileSizeBytes,
                    sha256Hash = approvalDocument.Version?.Sha256Hash,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    // Per explicit request: a reviewer with an explicit folder-level Deny
    // shouldn't see (or be able to act on) documents from that folder in the
    // approval queue, even though CanApprove/CanViewXStage are otherwise
    // decoupled from folder permissions by design — Deny is the one signal
    // that should still be able to carve a document back out of the queue.
    private async Task<object> BuildStageQueueAsync(string stage, int page, int pageSize, Guid userId)
    {
        var accessibleFolderIds = await GetAccessibleFolderIdsAsync(context, userId, accessOverrideService);

        var query = context.ApprovalDocuments
            .Where(ad => ad.CurrentStage == stage && ad.Status == "pending")
            .Where(ad => accessibleFolderIds == null || accessibleFolderIds.Contains(ad.Document!.FolderId))
            .Include(ad => ad.Approval).ThenInclude(a => a!.CreatedByUser)
            .Include(ad => ad.Document).ThenInclude(d => d!.Owner)
            .Include(ad => ad.Version)
            .OrderByDescending(ad => ad.CreatedAt);

        var totalCount = await query.CountAsync();

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var data = items.Select(ad => new
        {
            ApprovalId = ad.ApprovalId,
            CreatedBy = ad.Approval?.CreatedBy,
            createdByUserName = ad.Approval?.CreatedByUser?.FullName,
            CreatedAt = ad.CreatedAt,
            Status = ad.Status,
            QaNotes = ad.QaNotes,
            ManagerNotes = ad.ManagerNotes,
            documentCount = 1,
            documents = new[] { ToQueueDocument(ad) },
        });

        return new
        {
            success = true,
            data,
            count = items.Count,
            totalCount,
            totalPages = (int)Math.Ceiling((double)totalCount / pageSize),
            page,
            pageSize,
        };
    }

    /// <summary>
    /// Get QA Review Queue (Stage 1) - documents waiting for QA approval
    /// </summary>
    [HttpGet("qa-review-queue")]
    public async Task<ActionResult<object>> GetQaReviewQueueAsync([FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        try
        {
            var userId = GetCurrentUserId();
            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewQaStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the QA Review stage" });

            return Ok(await BuildStageQueueAsync("qa_review", page, pageSize, userId));
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
            var userId = GetCurrentUserId();
            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewManagerStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Manager Review stage" });

            return Ok(await BuildStageQueueAsync("manager_review", page, pageSize, userId));
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
            var userId = GetCurrentUserId();
            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewFinalReleaseStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Final Release stage" });

            return Ok(await BuildStageQueueAsync("final_release", page, pageSize, userId));
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Accept - Move this one document to Manager Review Stage
    /// </summary>
    [HttpPost("{approvalId}/documents/{documentId}/qa-accept")]
    public async Task<ActionResult<object>> QaAcceptAsync(Guid approvalId, Guid documentId, [FromBody] QaActionRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approvalDocument = await context.ApprovalDocuments.FirstOrDefaultAsync(ad => ad.ApprovalId == approvalId && ad.DocumentId == documentId);

            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Approval document not found" });

            var folderCheck = await RequireFolderReadAccessAsync(userId, documentId);
            if (folderCheck != null) return folderCheck;

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanApprove))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Approve permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewQaStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the QA Review stage" });

            if (approvalDocument.CurrentStage != "qa_review")
                return BadRequest(new { success = false, error = "This document is not in QA review stage" });

            approvalDocument.CurrentStage = "manager_review";
            approvalDocument.Status = "pending";
            approvalDocument.QaNotes = request.Notes;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "QA_ACCEPTED", new
            {
                approvalId,
                documentId,
                notes = request.Notes,
            });

            await notificationService.NotifyDocumentOwnerAsync(documentId, userId, "Your document was accepted by QA", "Now moving to Manager Review.");

            return Ok(new
            {
                success = true,
                data = new
                {
                    approvalDocument.ApprovalId,
                    approvalDocument.DocumentId,
                    approvalDocument.CurrentStage,
                    approvalDocument.Status,
                    approvalDocument.QaNotes,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Request Correction - Creates task and keeps this one document in QA review
    /// </summary>
    [HttpPost("{approvalId}/documents/{documentId}/qa-request-correction")]
    public async Task<ActionResult<object>> QaRequestCorrectionAsync(Guid approvalId, Guid documentId, [FromBody] QaCorrectionRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approvalDocument = await context.ApprovalDocuments.FirstOrDefaultAsync(ad => ad.ApprovalId == approvalId && ad.DocumentId == documentId);

            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Approval document not found" });

            var folderCheck = await RequireFolderReadAccessAsync(userId, documentId);
            if (folderCheck != null) return folderCheck;

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanReject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewQaStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the QA Review stage" });

            if (request.AssignToUserId.HasValue == request.AssignToGroupId.HasValue)
                return BadRequest(new { success = false, error = "Exactly one of assignToUserId or assignToGroupId is required" });

            approvalDocument.QaNotes = request.Notes;
            approvalDocument.Status = "correction_requested";

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                DocumentId = documentId,
                ApprovalId = approvalId,
                Title = request.TaskTitle,
                Description = request.TaskDescription,
                TaskType = request.TaskType ?? "correction",
                AssignedToId = request.AssignToUserId,
                AssignedToGroupId = request.AssignToGroupId,
                ManagerId = userId,
                Status = "open",
                RiskSeverity = request.Priority ?? "high",
                DueDate = request.DueDate,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            context.Tasks.Add(task);
            await context.SaveChangesAsync();

            await NotifyTaskAssigneeAsync(task, userId, "New correction task assigned to you");

            await auditService.LogAsync(userId, "QA_CORRECTION_REQUESTED", new
            {
                approvalId,
                documentId,
                taskId = task.TaskId,
                notes = request.Notes,
            });

            await notificationService.NotifyDocumentOwnerAsync(documentId, userId, "QA requested a correction on your document", request.Notes);

            return Ok(new
            {
                success = true,
                data = new
                {
                    approvalDocument.ApprovalId,
                    approvalDocument.DocumentId,
                    approvalDocument.CurrentStage,
                    approvalDocument.Status,
                    approvalDocument.QaNotes,
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
    /// Manager Approve - Move this one document to Final Release
    /// </summary>
    [HttpPost("{approvalId}/documents/{documentId}/manager-approve")]
    public async Task<ActionResult<object>> ManagerApproveAsync(Guid approvalId, Guid documentId, [FromBody] ManagerActionRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approvalDocument = await context.ApprovalDocuments.FirstOrDefaultAsync(ad => ad.ApprovalId == approvalId && ad.DocumentId == documentId);

            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Approval document not found" });

            var folderCheck = await RequireFolderReadAccessAsync(userId, documentId);
            if (folderCheck != null) return folderCheck;

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanApprove))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Approve permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewManagerStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Manager Review stage" });

            if (approvalDocument.CurrentStage != "manager_review")
                return BadRequest(new { success = false, error = "This document is not in manager review stage" });

            approvalDocument.CurrentStage = "final_release";
            approvalDocument.Status = "pending";
            approvalDocument.ManagerNotes = request.Notes;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "MANAGER_APPROVED", new
            {
                approvalId,
                documentId,
                notes = request.Notes,
            });

            await notificationService.NotifyDocumentOwnerAsync(documentId, userId, "Your document was approved by the Manager", "Now moving to Final Release.");

            return Ok(new
            {
                success = true,
                data = new
                {
                    approvalDocument.ApprovalId,
                    approvalDocument.DocumentId,
                    approvalDocument.CurrentStage,
                    approvalDocument.Status,
                    approvalDocument.ManagerNotes,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Manager Reject with Correction Task - only this one document
    /// </summary>
    [HttpPost("{approvalId}/documents/{documentId}/manager-reject")]
    public async Task<ActionResult<object>> ManagerRejectAsync(Guid approvalId, Guid documentId, [FromBody] ManagerRejectRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approvalDocument = await context.ApprovalDocuments.FirstOrDefaultAsync(ad => ad.ApprovalId == approvalId && ad.DocumentId == documentId);

            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Approval document not found" });

            var folderCheck = await RequireFolderReadAccessAsync(userId, documentId);
            if (folderCheck != null) return folderCheck;

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanReject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewManagerStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Manager Review stage" });

            if (request.AssignToUserId.HasValue == request.AssignToGroupId.HasValue)
                return BadRequest(new { success = false, error = "Exactly one of assignToUserId or assignToGroupId is required" });

            approvalDocument.Status = "correction_requested";
            approvalDocument.ManagerNotes = request.RejectionReason;

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                DocumentId = documentId,
                ApprovalId = approvalId,
                Title = request.TaskTitle,
                Description = request.TaskDescription,
                TaskType = request.TaskType ?? "correction",
                AssignedToId = request.AssignToUserId,
                AssignedToGroupId = request.AssignToGroupId,
                ManagerId = userId,
                Status = "open",
                RiskSeverity = request.Priority ?? "high",
                DueDate = request.DueDate,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            context.Tasks.Add(task);
            await context.SaveChangesAsync();

            await NotifyTaskAssigneeAsync(task, userId, "New correction task assigned to you");

            await auditService.LogAsync(userId, "MANAGER_REJECTED", new
            {
                approvalId,
                documentId,
                taskId = task.TaskId,
                reason = request.RejectionReason,
            });

            await notificationService.NotifyDocumentOwnerAsync(documentId, userId, "Your document was rejected by the Manager", request.RejectionReason);

            return Ok(new
            {
                success = true,
                data = new
                {
                    approvalDocument.ApprovalId,
                    approvalDocument.DocumentId,
                    approvalDocument.CurrentStage,
                    approvalDocument.Status,
                    approvalDocument.ManagerNotes,
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
    /// member. Bumps this one document's minor version and sends it straight
    /// to Final Release, bypassing Stage 2's normal manager-approve step.
    /// Other documents from the same upload batch are entirely unaffected.
    /// </summary>
    [HttpPost("{approvalId}/documents/{documentId}/manager-self-correct")]
    public async Task<ActionResult<object>> ManagerSelfCorrectAsync(Guid approvalId, Guid documentId, IFormFile file, [FromForm] string rejectionReason)
    {
        try
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, error = "File is required" });

            var userId = GetCurrentUserId();
            var approvalDocument = await context.ApprovalDocuments.FirstOrDefaultAsync(ad => ad.ApprovalId == approvalId && ad.DocumentId == documentId);

            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Approval document not found" });

            var folderCheck = await RequireFolderReadAccessAsync(userId, documentId);
            if (folderCheck != null) return folderCheck;

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanReject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewManagerStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Manager Review stage" });

            if (approvalDocument.CurrentStage != "manager_review")
                return BadRequest(new { success = false, error = "This document is not in manager review stage" });

            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == documentId);
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

            approvalDocument.CurrentStage = "final_release";
            approvalDocument.Status = "pending";
            approvalDocument.ManagerNotes = rejectionReason;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "MANAGER_SELF_CORRECTED", new
            {
                approvalId,
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
                    approvalDocument.ApprovalId,
                    approvalDocument.DocumentId,
                    approvalDocument.CurrentStage,
                    approvalDocument.Status,
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
    /// QA Final Release - Generate tracking code and release this one document
    /// </summary>
    [HttpPost("{approvalId}/documents/{documentId}/qa-final-release")]
    public async Task<ActionResult<object>> QaFinalReleaseAsync(Guid approvalId, Guid documentId, [FromBody] FinalReleaseRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approvalDocument = await context.ApprovalDocuments.FirstOrDefaultAsync(ad => ad.ApprovalId == approvalId && ad.DocumentId == documentId);

            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Approval document not found" });

            var folderCheck = await RequireFolderReadAccessAsync(userId, documentId);
            if (folderCheck != null) return folderCheck;

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanApprove))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Approve permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewFinalReleaseStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Final Release stage" });

            if (approvalDocument.CurrentStage != "final_release")
                return BadRequest(new { success = false, error = "This document is not in final release stage" });

            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == documentId);
            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            document.Status = "released";

            approvalDocument.CurrentStage = "released";
            approvalDocument.Status = "approved";
            approvalDocument.ReleaseNotes = request.ReleaseNotes;

            // Per explicit request: once the document is actually released, every
            // correction task raised against it during this approval is resolved by
            // definition — auto-complete any that are still open/in_progress instead
            // of leaving them stranded regardless of what the PCAR page's own status
            // controls did or didn't set along the way.
            var openTasks = await context.Tasks
                .Where(t => t.ApprovalId == approvalId && t.DocumentId == documentId && t.Status != "completed")
                .ToListAsync();
            foreach (var openTask in openTasks)
            {
                openTask.Status = "completed";
                openTask.CompletedById = userId;
                openTask.CompletedAt = DateTime.UtcNow;
                openTask.UpdatedAt = DateTime.UtcNow;
            }

            await context.SaveChangesAsync();

            // The version's SHA-256 hash was captured at upload time; recording it here
            // ties the permanent hash to the exact moment of release in the WORM-protected
            // audit ledger (dms_audit_trails rejects UPDATE/DELETE at the DB level).
            var releasedVersion = await context.DocumentVersions
                .Where(v => v.VersionId == approvalDocument.VersionId)
                .Select(v => new { v.DocumentId, v.Sha256Hash })
                .FirstOrDefaultAsync();

            await auditService.LogAsync(userId, "QA_FINAL_RELEASE", new
            {
                approvalId,
                documentId,
                sha256Hash = releasedVersion?.Sha256Hash,
            });

            await notificationService.NotifyDocumentOwnerAsync(documentId, userId, "Your document was released");

            return Ok(new
            {
                success = true,
                data = new
                {
                    approvalDocument.ApprovalId,
                    approvalDocument.DocumentId,
                    approvalDocument.CurrentStage,
                    approvalDocument.Status,
                    approvalDocument.ReleaseNotes,
                },
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Final Reject - Creates a correction task and keeps this one document in
    /// Final Release stage. Symmetric with QA Request Correction (Stage 1) and
    /// Manager Reject (Stage 2) — resubmitting the correction later leaves
    /// CurrentStage untouched, so it comes back to Final Release, not some other
    /// stage.
    /// </summary>
    [HttpPost("{approvalId}/documents/{documentId}/qa-final-reject")]
    public async Task<ActionResult<object>> QaFinalRejectAsync(Guid approvalId, Guid documentId, [FromBody] FinalReleaseRejectRequest request)
    {
        try
        {
            var userId = GetCurrentUserId();
            var approvalDocument = await context.ApprovalDocuments.FirstOrDefaultAsync(ad => ad.ApprovalId == approvalId && ad.DocumentId == documentId);

            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Approval document not found" });

            var folderCheck = await RequireFolderReadAccessAsync(userId, documentId);
            if (folderCheck != null) return folderCheck;

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanReject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewFinalReleaseStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Final Release stage" });

            if (approvalDocument.CurrentStage != "final_release")
                return BadRequest(new { success = false, error = "This document is not in final release stage" });

            if (request.AssignToUserId.HasValue == request.AssignToGroupId.HasValue)
                return BadRequest(new { success = false, error = "Exactly one of assignToUserId or assignToGroupId is required" });

            approvalDocument.Status = "correction_requested";
            approvalDocument.ReleaseNotes = request.RejectionReason;

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                DocumentId = documentId,
                ApprovalId = approvalId,
                Title = request.TaskTitle,
                Description = request.TaskDescription,
                TaskType = request.TaskType ?? "correction",
                AssignedToId = request.AssignToUserId,
                AssignedToGroupId = request.AssignToGroupId,
                ManagerId = userId,
                Status = "open",
                RiskSeverity = request.Priority ?? "high",
                DueDate = request.DueDate,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            context.Tasks.Add(task);
            await context.SaveChangesAsync();

            await NotifyTaskAssigneeAsync(task, userId, "New correction task assigned to you");

            await auditService.LogAsync(userId, "QA_FINAL_REJECTED", new
            {
                approvalId,
                documentId,
                taskId = task.TaskId,
                reason = request.RejectionReason,
            });

            await notificationService.NotifyDocumentOwnerAsync(documentId, userId, "Your document was rejected at Final Release", request.RejectionReason);

            return Ok(new
            {
                success = true,
                data = new
                {
                    approvalDocument.ApprovalId,
                    approvalDocument.DocumentId,
                    approvalDocument.CurrentStage,
                    approvalDocument.Status,
                    approvalDocument.ReleaseNotes,
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
public record QaCorrectionRequest(string TaskTitle, string TaskDescription, DateTime DueDate, Guid? AssignToUserId = null, Guid? AssignToGroupId = null, string? Notes = null, string? TaskType = null, string? Priority = null);
public record ManagerActionRequest(string? Notes = null);
public record ManagerRejectRequest(string RejectionReason, string TaskTitle, string TaskDescription, DateTime DueDate, Guid? AssignToUserId = null, Guid? AssignToGroupId = null, string? TaskType = null, string? Priority = null);
public record FinalReleaseRequest(string? ReleaseNotes = null);
public record FinalReleaseRejectRequest(string RejectionReason, string TaskTitle, string TaskDescription, DateTime DueDate, Guid? AssignToUserId = null, Guid? AssignToGroupId = null, string? TaskType = null, string? Priority = null);
