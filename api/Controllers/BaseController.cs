using DMS.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

public class BaseController : ControllerBase
{
    protected Guid GetCurrentUserId()
    {
        if (HttpContext.Items.TryGetValue("UserId", out var userId) && userId is Guid guid)
            return guid;

        throw new UnauthorizedAccessException("User ID not found in context");
    }

    protected DmsUser GetCurrentUser()
    {
        if (HttpContext.Items.TryGetValue("User", out var user) && user is DmsUser dmsUser)
            return dmsUser;

        throw new UnauthorizedAccessException("User not found in context");
    }

    protected string GetUserRole()
    {
        if (HttpContext.Items.TryGetValue("UserRole", out var role) && role is string roleStr)
            return roleStr;

        return "Reader"; // Default role
    }

    protected Guid? GetFolderId()
    {
        if (HttpContext.Items.TryGetValue("FolderId", out var folderId) && folderId is Guid guid)
            return guid;

        return null;
    }
}
