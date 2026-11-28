using DMS.Api.Services;
using Xunit;

namespace DMS.Api.Tests;

public class TaskEscalationScheduleTests
{
    [Theory]
    [InlineData(4, null, null)]
    [InlineData(3, "before_due_3", "Due in 3 days")]
    [InlineData(2, null, null)]
    [InlineData(1, "before_due_1", "Due in 1 day")]
    [InlineData(0, "due", "Due today")]
    [InlineData(-1, "overdue", "Overdue")]
    public void Selects_only_the_stage_for_the_calendar_date(int daysUntilDue, string? stage, string? label)
    {
        var today = new DateTime(2026, 11, 28);
        var result = TaskEscalationService.ResolveStage(today.AddHours(23), today.AddDays(daysUntilDue), TaskNotificationPolicy.Default);

        Assert.Equal(stage, result.Stage);
        Assert.Equal(label, result.Label);
    }

    [Fact]
    public void Skips_a_disabled_due_date_reminder()
    {
        var today = new DateTime(2026, 11, 28);
        var policy = TaskNotificationPolicy.Default;
        policy = policy with { DueDate = policy.DueDate with { Enabled = false } };

        Assert.Null(TaskEscalationService.ResolveStage(today, today, policy).Stage);
    }
}
