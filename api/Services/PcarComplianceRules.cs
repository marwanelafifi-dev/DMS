namespace DMS.Api.Services;

// Small, side-effect-free compliance gates shared by the controller/service
// workflow and direct unit tests. Database lookups remain at the caller, but
// the actual policy decisions stay explicit and independently testable.
public static class PcarComplianceRules
{
    public static bool HasRequiredScope(IEnumerable<Guid> linkedDocumentIds, IEnumerable<Guid> linkedFolderIds) =>
        linkedDocumentIds.Any() || linkedFolderIds.Any();

    public static bool EveryLinkedFileIsReleased(IEnumerable<Guid> linkedDocumentIds, IEnumerable<Guid> releasedDocumentIds)
    {
        var requested = linkedDocumentIds.Distinct().ToHashSet();
        return requested.Count > 0 && requested.SetEquals(releasedDocumentIds.Distinct());
    }

    public static bool HasRequiredEvidence(int attachmentCount) => attachmentCount > 0;

    public static bool HasRequiredReturnNotes(bool approve, string? notes) => approve || !string.IsNullOrWhiteSpace(notes);

    public static bool IsEffectivenessDecisionConsistent(bool approve, string? effectiveness) =>
        approve ? effectiveness == "effective" : effectiveness == "ineffective";

    public static bool CanVerify(bool canVerifyPcars) => canVerifyPcars;
}
