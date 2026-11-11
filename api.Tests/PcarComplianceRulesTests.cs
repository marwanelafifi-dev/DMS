using DMS.Api.Services;
using Xunit;

namespace DMS.Api.Tests;

public class PcarComplianceRulesTests
{
    [Fact]
    public void Scope_requires_at_least_one_linked_file_or_folder()
    {
        var folder = Guid.NewGuid();
        Assert.False(PcarComplianceRules.HasRequiredScope([], []));
        Assert.True(PcarComplianceRules.HasRequiredScope([], [folder]));
    }

    [Fact]
    public void EveryLinkedFileIsReleased_rejects_a_draft_secondary_file()
    {
        var released = Guid.NewGuid();
        var draft = Guid.NewGuid();

        Assert.False(PcarComplianceRules.EveryLinkedFileIsReleased([released, draft], [released]));
    }

    [Fact]
    public void EveryLinkedFileIsReleased_accepts_all_selected_released_files()
    {
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        Assert.True(PcarComplianceRules.EveryLinkedFileIsReleased([first, second], [first, second]));
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    public void Evidence_is_required_before_submission(int attachmentCount, bool expected)
        => Assert.Equal(expected, PcarComplianceRules.HasRequiredEvidence(attachmentCount));

    [Fact]
    public void Return_requires_notes_but_approval_does_not()
    {
        Assert.False(PcarComplianceRules.HasRequiredReturnNotes(false, "  "));
        Assert.True(PcarComplianceRules.HasRequiredReturnNotes(false, "Please provide calibration evidence."));
        Assert.True(PcarComplianceRules.HasRequiredReturnNotes(true, null));
    }

    [Fact]
    public void Verification_requires_the_dedicated_role_permission()
    {
        Assert.False(PcarComplianceRules.CanVerify(false));
        Assert.True(PcarComplianceRules.CanVerify(true));
    }

    [Fact]
    public void Closure_requires_effective_and_return_requires_ineffective()
    {
        Assert.True(PcarComplianceRules.IsEffectivenessDecisionConsistent(true, "effective"));
        Assert.True(PcarComplianceRules.IsEffectivenessDecisionConsistent(false, "ineffective"));
        Assert.False(PcarComplianceRules.IsEffectivenessDecisionConsistent(true, "ineffective"));
        Assert.False(PcarComplianceRules.IsEffectivenessDecisionConsistent(false, "effective"));
    }
}
