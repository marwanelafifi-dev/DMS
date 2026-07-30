using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/approvals")]
public class ApprovalsController(DmsContext context, AuditService auditService) : BaseController
{
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

            return Ok(new { success = true, data = new { approval, task } });
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

            return Ok(new { success = true, data = new { approval, task } });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    /// <summary>
    /// QA Final Release - Generate tracking code and release document
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

            if (approval.CurrentStage != "final_release")
                return BadRequest(new { success = false, error = "Approval is not in final release stage" });

            // Generate tracking code if provided
            if (!string.IsNullOrEmpty(request.TrackingCode))
            {
                approval.TrackingCode = request.TrackingCode;
            }

            approval.CurrentStage = "released";
            approval.Status = "approved";
            approval.ReleaseNotes = request.ReleaseNotes;

            // Update document status to RELEASED
            var documentIds = approval.Documents.Select(d => d.DocumentId).ToList();
            var documents = await context.Documents
                .Where(d => documentIds.Contains(d.DocumentId))
                .ToListAsync();

            foreach (var doc in documents)
            {
                doc.Status = "RELEASED";
            }

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "QA_FINAL_RELEASE", new
            {
                approvalId = approval.ApprovalId,
                trackingCode = approval.TrackingCode,
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
                    approval.TrackingCode,
                    approval.ReleaseNotes,
                    documentIds,
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
public record FinalReleaseRequest(string? TrackingCode = null, string? ReleaseNotes = null);
