namespace DMS.Api.Models;

/// <summary>
/// Documents included in a single approval batch
/// </summary>
public class DmsApprovalDocument
{
    public Guid ApprovalDocumentId { get; set; }
    public Guid ApprovalId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid VersionId { get; set; }  // The version submitted for approval
    public DateTime CreatedAt { get; set; }
    // When this row last entered/re-entered its current stage/status — updated
    // on every stage transition and resubmission, unlike CreatedAt (set once,
    // at the row's initial insert). The queue's "Submitted" column reads this.
    public DateTime UpdatedAt { get; set; }

    // Per-document C-Doc Workflow progress — deliberately independent of every
    // other document in the same batch. QA/Manager/Release actions target one
    // DmsApprovalDocument row at a time; they never touch a sibling document's
    // stage/status just because it was uploaded/submitted together.
    public string CurrentStage { get; set; } = "qa_review";  // qa_review | manager_review | final_release | released | rejected
    public string Status { get; set; } = "pending";  // pending | correction_requested | approved | rejected
    public string? QaNotes { get; set; }
    public string? ManagerNotes { get; set; }
    public string? ReleaseNotes { get; set; }
    // What the submitter themselves typed into "Approval Notes (Optional)"
    // at submission time — distinct from QaNotes/ManagerNotes/ReleaseNotes,
    // which are the *reviewer's* notes at each later stage.
    public string? SubmissionNote { get; set; }

    // Navigation properties
    public DmsApproval? Approval { get; set; }
    public DmsDocument? Document { get; set; }
    public DmsDocumentVersion? Version { get; set; }
}
