namespace DMS.Api.Models;

/// <summary>
/// C-Doc Workflow approval batch (Stage 1 QA → Stage 2 Manager → Stage 3 Final Release)
/// </summary>
public class DmsApproval
{
    public Guid ApprovalId { get; set; }
    public Guid CreatedBy { get; set; }  // Original submitter (document owner)
    public DateTime CreatedAt { get; set; }

    // Approval stage tracking
    public string CurrentStage { get; set; } = "qa_review";  // qa_review | manager_review | final_release | released | rejected
    public string Status { get; set; } = "pending";  // pending | approved | rejected

    // QA Stage 1 notes
    public string? QaNotes { get; set; }

    // Manager Stage 2 notes
    public string? ManagerNotes { get; set; }

    // Final Release Stage 3
    public string? TrackingCode { get; set; }  // [DEPT]-[YEAR]-[CATEGORY]-[SEQ]
    public string? ReleaseNotes { get; set; }

    public DmsUser? CreatedByUser { get; set; }
    public ICollection<DmsApprovalDocument> Documents { get; set; } = new List<DmsApprovalDocument>();
}
