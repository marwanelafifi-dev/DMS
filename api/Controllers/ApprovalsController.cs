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

    private async Task<bool> IsFolderOwnerOrManagerAsync(Guid userId, Guid documentId)
    {
        var folderId = await context.Documents.Where(d => d.DocumentId == documentId).Select(d => (Guid?)d.FolderId).FirstOrDefaultAsync();
        if (!folderId.HasValue) return false;
        return await context.Folders.AnyAsync(f => f.FolderId == folderId && f.OwnerId == userId)
            || await context.FolderManagers.AnyAsync(m => m.FolderId == folderId && m.UserId == userId);
    }

    private async Task<string?> GetFolderApprovalRoutingErrorAsync(Guid folderId)
    {
        var hasActiveOwner = await context.Folders
            .Where(f => f.FolderId == folderId)
            .Join(context.Users.Where(u => u.IsActive), f => f.OwnerId, u => u.UserId, (_, _) => true)
            .AnyAsync();
        if (!hasActiveOwner) return "The folder has no active owner. Assign an active owner before submitting for approval.";

        var hasActiveManager = await context.FolderManagers
            .Where(m => m.FolderId == folderId)
            .Join(context.Users.Where(u => u.IsActive), m => m.UserId, u => u.UserId, (_, _) => true)
            .AnyAsync();
        return hasActiveManager ? null : "The folder has no active manager. Assign at least one manager in Edit Folder before submitting for approval.";
    }

    private static bool StageAllowsAccessCheck(string currentStage, bool canViewQa, bool canViewManager, bool canViewFinal) => currentStage switch
    {
        "qa_review" => canViewQa,
        "manager_review" => canViewManager,
        "final_release" => canViewFinal,
        _ => true, // released/rejected — already out of the stage-gated part of the workflow
    };

    // A document can have an open task tied to it two ways: a real correction
    // task from a QA/Manager rejection (ApprovalId set, drives the approval-
    // document's own Status), or a self-filed PCAR that just references the
    // document for context (ApprovalId null) — either kind blocks the
    // document from advancing while it's genuinely still open, and both are
    // surfaced to reviewers the same way (see BuildStageQueueAsync's
    // linkedTask field and the per-action guard below). Only "open" blocks —
    // once the assignee submits it (self-filed PCAR "submitted", awaiting its
    // own QA decision) the assignee's own part is done, so it stops holding
    // up this document; a real correction task never passes through
    // "submitted" at all (ResubmitForReview moves it straight to
    // "completed"), so this doesn't change that path.
    private async Task<object?> GetOpenLinkedTaskAsync(Guid documentId)
    {
        var task = await context.Tasks
            .Where(t => t.DocumentId == documentId && t.Status == "open")
            .Include(t => t.AssignedTo)
            .Include(t => t.AssignedToGroup)
            .OrderByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync();
        if (task == null) return null;

        return new
        {
            task.TaskId,
            task.Title,
            task.Status,
            assigneeName = task.AssignedTo?.FullName ?? task.AssignedToGroup?.Name,
        };
    }

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

    // A correction task represents "please fix this specific rejection" — it's
    // fully resolved the moment the stage that rejected it accepts the fix and
    // moves the approval forward, not only once the document eventually
    // reaches Final Release (that auto-complete, still below, is a fallback
    // safety net for anything left stranded, not the primary trigger). Real
    // bug found live: a correction task stayed "open" in the PCAR register
    // for as long as the document sat in Manager Review/Final Release,
    // even though the assignee's actual corrective work (the upload QA just
    // accepted) was already done and accepted.
    private async Task CompleteOpenTasksForApprovalAsync(Guid approvalId, Guid documentId, Guid userId)
    {
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
                var routingError = await GetFolderApprovalRoutingErrorAsync(document.FolderId);
                if (routingError != null)
                    return BadRequest(new { success = false, error = $"{document.Title}: {routingError}" });

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
                    UpdatedAt = DateTime.UtcNow,
                    CurrentStage = "qa_review",
                    Status = "pending",
                    SubmissionNote = request.ApprovalNotes,
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

            // Real gap found live: submitting a brand-new document never told
            // QA anything landed in their queue at all — every later stage
            // transition (QA accept, Manager approve, Manager self-correct)
            // already notifies the next stage's reviewers, but the very first
            // stage had no equivalent "something is waiting for you" ping.
            foreach (var document in documents)
                await notificationService.NotifyStageReviewersAsync(userId, document.DocumentId, "A document is waiting for QA Review", document.Title, r => r.CanViewQaStage);

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

            if (approvalDocument.CurrentStage == "manager_review" && !await IsFolderOwnerOrManagerAsync(userId, documentId))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Only this folder's owner or assigned managers can review this document" });

            if (approvalDocument.Document != null && !await HasFolderReadAccessAsync(context, accessOverrideService, userId, approvalDocument.Document.FolderId))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have access to this document's folder" });

            var linkedTask = await GetOpenLinkedTaskAsync(documentId);

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
                    // Reflects when this document last entered its current stage/
                    // status (see BuildStageQueueAsync) — not the batch's one-time
                    // original creation timestamp.
                    CreatedAt = approvalDocument.UpdatedAt,
                    approvalDocument.CurrentStage,
                    // Named ApprovalStatus (not Status) — Document?.Status below is the
                    // document's own generic lifecycle status and needs its own JSON key;
                    // both named "status" once camelCased collided and crashed serialization.
                    ApprovalStatus = approvalDocument.Status,
                    approvalDocument.QaNotes,
                    approvalDocument.ManagerNotes,
                    approvalDocument.ReleaseNotes,
                    // What the submitter themselves typed into "Approval Notes
                    // (Optional)" at submit time — real bug found live: this was
                    // always sent by the frontend but SubmitApprovalRequest had no
                    // field to receive it, so it was silently dropped on every
                    // submission ever made and never reached QA/Manager/Release.
                    approvalDocument.SubmissionNote,
                    fileName = approvalDocument.Version?.FileName ?? approvalDocument.Document?.Title ?? "Untitled document",
                    // Real gap found live: whatever the uploader typed into the
                    // document's own Description (the one place they can leave
                    // context/notes about what changed) was never returned here
                    // at all — a reviewer had no way to see it without leaving
                    // this screen to open the Document Library separately.
                    description = approvalDocument.Document?.Description,
                    ownerName = approvalDocument.Document?.Owner?.FullName ?? "Unknown owner",
                    department = approvalDocument.Document?.Department,
                    category = approvalDocument.Document?.Category,
                    originalDocumentId = approvalDocument.Document?.OriginalDocumentId,
                    status = approvalDocument.Document?.Status,
                    versionNumber = approvalDocument.Version?.VersionNumber,
                    fileSizeBytes = approvalDocument.Version?.FileSizeBytes,
                    sha256Hash = approvalDocument.Version?.Sha256Hash,
                    linkedTask,
                    blocked = linkedTask != null,
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

        // Previously only "pending" rows showed at all — a document sitting at
        // "correction_requested" (an open task assigned back to the submitter)
        // silently vanished from the reviewer's queue with no trace, which read
        // as "nothing to review" rather than "blocked, waiting on someone else".
        // Included here as a read-only, annotated row instead (see linkedTask
        // below) so the reviewer can see what it's waiting on.
        IQueryable<DmsApprovalDocument> query = context.ApprovalDocuments
            .Where(ad => ad.CurrentStage == stage && (ad.Status == "pending" || ad.Status == "correction_requested"))
            .Where(ad => accessibleFolderIds == null || accessibleFolderIds.Contains(ad.Document!.FolderId))
            .Include(ad => ad.Approval).ThenInclude(a => a!.CreatedByUser)
            .Include(ad => ad.Document).ThenInclude(d => d!.Owner)
            .Include(ad => ad.Version);

        if (stage == "manager_review")
            query = query.Where(ad => context.Folders.Any(f => f.FolderId == ad.Document!.FolderId && f.OwnerId == userId)
                || context.FolderManagers.Any(m => m.FolderId == ad.Document!.FolderId && m.UserId == userId));

        query = query.OrderByDescending(ad => ad.UpdatedAt);

        var totalCount = await query.CountAsync();

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var data = new List<object>();
        foreach (var ad in items)
        {
            // Any open task tied to this document — a real correction task
            // (ApprovalId set) or an unrelated self-filed PCAR that just
            // references it — blocks the reviewer's action (see the
            // qa-accept/manager-approve/manager-self-correct/qa-final-release
            // guards) and is surfaced here so the row explains why.
            var linkedTask = await GetOpenLinkedTaskAsync(ad.DocumentId);
            data.Add(new
            {
                ApprovalId = ad.ApprovalId,
                CreatedBy = ad.Approval?.CreatedBy,
                createdByUserName = ad.Approval?.CreatedByUser?.FullName,
                // "Submitted" in the queue reflects when this document last entered its
                // current stage/status (UpdatedAt) — not the batch's one-time original
                // creation timestamp, which never advances on a resubmitted correction.
                CreatedAt = ad.UpdatedAt,
                Status = ad.Status,
                QaNotes = ad.QaNotes,
                ManagerNotes = ad.ManagerNotes,
                documentCount = 1,
                documents = new[] { ToQueueDocument(ad) },
                linkedTask,
                blocked = linkedTask != null,
            });
        }

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

            var qaAcceptBlockingTask = await GetOpenLinkedTaskAsync(documentId);
            if (qaAcceptBlockingTask != null)
                return BadRequest(new { success = false, error = "This document has an open task that must be completed first", blockingTask = qaAcceptBlockingTask });

            approvalDocument.CurrentStage = "manager_review";
            approvalDocument.Status = "pending";
            approvalDocument.UpdatedAt = DateTime.UtcNow;
            approvalDocument.QaNotes = request.Notes;

            await CompleteOpenTasksForApprovalAsync(approvalId, documentId, userId);

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "QA_ACCEPTED", new
            {
                approvalId,
                documentId,
                notes = request.Notes,
            });

            await notificationService.NotifyDocumentOwnerAsync(documentId, userId, "Your document was accepted by QA", "Now moving to Manager Review.");
            await notificationService.NotifyDocumentSubmitterAsync(documentId, userId, "Your document was accepted by QA", "Now moving to Manager Review.");

            var acceptedDocTitle = await context.Documents.Where(d => d.DocumentId == documentId).Select(d => d.Title).FirstOrDefaultAsync();
            await notificationService.NotifyStageReviewersAsync(userId, documentId, "A document is waiting for Manager Review", acceptedDocTitle, r => r.CanViewManagerStage, folderManagersOnly: true);

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
            approvalDocument.UpdatedAt = DateTime.UtcNow;

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                DocumentId = documentId,
                ApprovalId = approvalId,
                Title = request.TaskTitle,
                Description = request.TaskDescription,
                // Real bug found live: the "Notes" field on this form (separate from
                // Task description) only ever got saved onto the approval_documents
                // row — the assignee opening their PCAR/Tasks page had no way to see
                // it at all, since Tasks.tsx reads task fields, not approval-document
                // fields. Reuses the same QaReviewNotes column the PCAR review queue
                // already displays as a "why this needs fixing" banner.
                QaReviewNotes = request.Notes,
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
            await notificationService.NotifyDocumentSubmitterAsync(documentId, userId, "QA requested a correction on your document", request.Notes);

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

            if (!await IsFolderOwnerOrManagerAsync(userId, documentId))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Only this folder's owner or assigned managers can approve this document" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanApprove))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Approve permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewManagerStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Manager Review stage" });

            if (approvalDocument.CurrentStage != "manager_review")
                return BadRequest(new { success = false, error = "This document is not in manager review stage" });

            var managerApproveBlockingTask = await GetOpenLinkedTaskAsync(documentId);
            if (managerApproveBlockingTask != null)
                return BadRequest(new { success = false, error = "This document has an open task that must be completed first", blockingTask = managerApproveBlockingTask });

            approvalDocument.CurrentStage = "final_release";
            approvalDocument.Status = "pending";
            approvalDocument.UpdatedAt = DateTime.UtcNow;
            approvalDocument.ManagerNotes = request.Notes;

            await CompleteOpenTasksForApprovalAsync(approvalId, documentId, userId);

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "MANAGER_APPROVED", new
            {
                approvalId,
                documentId,
                notes = request.Notes,
            });

            await notificationService.NotifyDocumentOwnerAsync(documentId, userId, "Your document was approved by the Manager", "Now moving to Final Release.");
            await notificationService.NotifyDocumentSubmitterAsync(documentId, userId, "Your document was approved by the Manager", "Now moving to Final Release.");

            var managerApprovedDocTitle = await context.Documents.Where(d => d.DocumentId == documentId).Select(d => d.Title).FirstOrDefaultAsync();
            await notificationService.NotifyStageReviewersAsync(userId, documentId, "A document is waiting for Final Release", managerApprovedDocTitle, r => r.CanViewFinalReleaseStage);

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

            if (!await IsFolderOwnerOrManagerAsync(userId, documentId))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Only this folder's owner or assigned managers can reject this document" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanReject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewManagerStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Manager Review stage" });

            if (request.AssignToUserId.HasValue == request.AssignToGroupId.HasValue)
                return BadRequest(new { success = false, error = "Exactly one of assignToUserId or assignToGroupId is required" });

            approvalDocument.Status = "correction_requested";
            approvalDocument.UpdatedAt = DateTime.UtcNow;
            approvalDocument.ManagerNotes = request.RejectionReason;

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                DocumentId = documentId,
                ApprovalId = approvalId,
                Title = request.TaskTitle,
                Description = request.TaskDescription,
                // Same fix as QaRequestCorrectionAsync — carry the rejection
                // reason onto the task itself so the assignee actually sees it.
                QaReviewNotes = request.RejectionReason,
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
            await notificationService.NotifyDocumentSubmitterAsync(documentId, userId, "Your document was rejected by the Manager", request.RejectionReason);

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

            if (!await IsFolderOwnerOrManagerAsync(userId, documentId))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Only this folder's owner or assigned managers can correct this document" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanReject))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have Reject permission" });

            if (!await CurrentUserHasStageAccessAsync(userId, r => r.CanViewManagerStage))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have access to the Manager Review stage" });

            if (approvalDocument.CurrentStage != "manager_review")
                return BadRequest(new { success = false, error = "This document is not in manager review stage" });

            var selfCorrectBlockingTask = await GetOpenLinkedTaskAsync(documentId);
            if (selfCorrectBlockingTask != null)
                return BadRequest(new { success = false, error = "This document has an open task that must be completed first", blockingTask = selfCorrectBlockingTask });

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
            approvalDocument.UpdatedAt = DateTime.UtcNow;
            approvalDocument.ManagerNotes = rejectionReason;

            await CompleteOpenTasksForApprovalAsync(approvalId, document.DocumentId, userId);

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
            await notificationService.NotifyDocumentSubmitterAsync(document.DocumentId, userId, "The Manager corrected your document directly", "Now moving to Final Release.");
            await notificationService.NotifyStageReviewersAsync(userId, document.DocumentId, "A document is waiting for Final Release", document.Title, r => r.CanViewFinalReleaseStage);

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

            var releaseBlockingTask = await GetOpenLinkedTaskAsync(documentId);
            if (releaseBlockingTask != null)
                return BadRequest(new { success = false, error = "This document has an open task that must be completed first", blockingTask = releaseBlockingTask });

            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == documentId);
            if (document == null)
                return NotFound(new { success = false, error = "Document not found" });

            document.Status = "released";

            approvalDocument.CurrentStage = "released";
            approvalDocument.Status = "approved";
            approvalDocument.UpdatedAt = DateTime.UtcNow;
            approvalDocument.ReleaseNotes = request.ReleaseNotes;

            // Safety net: QaAcceptAsync/ManagerApproveAsync/ManagerSelfCorrectAsync
            // already complete a correction task the moment its own rejecting
            // stage accepts the fix — this just catches anything that somehow
            // slipped through still open/in_progress by the time the document
            // is actually released, so nothing stays stranded regardless of
            // what the PCAR page's own status controls did or didn't set along
            // the way.
            await CompleteOpenTasksForApprovalAsync(approvalId, documentId, userId);

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
            await notificationService.NotifyDocumentSubmitterAsync(documentId, userId, "Your document was released");

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
            approvalDocument.UpdatedAt = DateTime.UtcNow;
            approvalDocument.ReleaseNotes = request.RejectionReason;

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                DocumentId = documentId,
                ApprovalId = approvalId,
                Title = request.TaskTitle,
                Description = request.TaskDescription,
                // Same fix as QaRequestCorrectionAsync — carry the rejection
                // reason onto the task itself so the assignee actually sees it.
                QaReviewNotes = request.RejectionReason,
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
            await notificationService.NotifyDocumentSubmitterAsync(documentId, userId, "Your document was rejected at Final Release", request.RejectionReason);

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
            // Same real gap as the single-document detail endpoint — a
            // reviewer glancing at the queue list couldn't see the
            // uploader's own note/context at all without opening Review.
            description = document?.Description,
            submissionNote = approvalDocument.SubmissionNote,
            ownerName = document?.Owner?.FullName ?? "Unknown owner",
            department = document?.Department ?? "Not assigned",
            status = document?.Status ?? "pending",
            originalDocumentId = document?.OriginalDocumentId,
            hasDocId = !string.IsNullOrWhiteSpace(document?.OriginalDocumentId),
        };
    }
}

// Request DTOs
public record SubmitApprovalRequest(List<Guid> DocumentIds, string? ApprovalNotes = null);
public record QaActionRequest(string? Notes = null);
public record QaCorrectionRequest(string TaskTitle, string TaskDescription, DateTime DueDate, Guid? AssignToUserId = null, Guid? AssignToGroupId = null, string? Notes = null, string? TaskType = null, string? Priority = null);
public record ManagerActionRequest(string? Notes = null);
public record ManagerRejectRequest(string RejectionReason, string TaskTitle, string TaskDescription, DateTime DueDate, Guid? AssignToUserId = null, Guid? AssignToGroupId = null, string? TaskType = null, string? Priority = null);
public record FinalReleaseRequest(string? ReleaseNotes = null);
public record FinalReleaseRejectRequest(string RejectionReason, string TaskTitle, string TaskDescription, DateTime DueDate, Guid? AssignToUserId = null, Guid? AssignToGroupId = null, string? TaskType = null, string? Priority = null);
