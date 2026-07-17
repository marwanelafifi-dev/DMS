using Hangfire.Dashboard;

namespace DMS.Api;

// Dev-only: allows unrestricted access to the Hangfire dashboard (/hangfire).
// Replace with a real auth check once the app has proper login (see CLAUDE.md roadmap).
public class NoAuthorizationFilter : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context) => true;
}
