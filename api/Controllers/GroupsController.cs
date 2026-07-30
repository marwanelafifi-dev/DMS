using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/groups")]
public class GroupsController(DmsContext context, AuditService auditService, ILogger<GroupsController> logger) : BaseController
{
    // GET /api/groups — list all groups with member counts
    [HttpGet]
    public async Task<ActionResult<object>> GetGroups()
    {
        try
        {
            var groups = await context.Groups
                .OrderBy(g => g.Name)
                .Select(g => new
                {
                    g.GroupId,
                    g.Name,
                    g.Description,
                    g.CreatedAt,
                    g.UpdatedAt,
                    MemberCount = context.GroupMembers.Count(gm => gm.GroupId == g.GroupId),
                })
                .ToListAsync();

            return Ok(new { success = true, data = groups, count = groups.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving groups");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/groups/{id} — group detail with member list
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetGroup(Guid id)
    {
        try
        {
            var group = await context.Groups.FirstOrDefaultAsync(g => g.GroupId == id);
            if (group == null)
                return NotFound(new { success = false, error = "Group not found" });

            var members = await context.GroupMembers
                .Where(gm => gm.GroupId == id)
                .Include(gm => gm.User)
                .OrderBy(gm => gm.User!.FullName)
                .Select(gm => new
                {
                    gm.GroupMemberId,
                    gm.UserId,
                    UserName = gm.User!.FullName,
                    UserEmail = gm.User!.Email,
                    gm.AddedAt,
                })
                .ToListAsync();

            return Ok(new
            {
                success = true,
                data = new { group.GroupId, group.Name, group.Description, group.CreatedAt, group.UpdatedAt, Members = members },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving group {GroupId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/groups — create a group
    [HttpPost]
    public async Task<ActionResult<object>> CreateGroup([FromBody] CreateGroupRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return BadRequest(new { success = false, error = "Group name is required" });

            if (await context.Groups.AnyAsync(g => g.Name == req.Name.Trim()))
                return BadRequest(new { success = false, error = "A group with this name already exists" });

            var group = new DmsGroup
            {
                GroupId = Guid.NewGuid(),
                Name = req.Name.Trim(),
                Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            context.Groups.Add(group);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), GROUP_CREATED, new { group.GroupId, group.Name });

            return CreatedAtAction(nameof(GetGroup), new { id = group.GroupId }, new
            {
                success = true,
                data = new { group.GroupId, group.Name, group.Description, group.CreatedAt },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating group");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/groups/{id} — rename / change description
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateGroup(Guid id, [FromBody] UpdateGroupRequest req)
    {
        try
        {
            var group = await context.Groups.FirstOrDefaultAsync(g => g.GroupId == id);
            if (group == null)
                return NotFound(new { success = false, error = "Group not found" });

            if (!string.IsNullOrWhiteSpace(req.Name))
            {
                if (await context.Groups.AnyAsync(g => g.GroupId != id && g.Name == req.Name.Trim()))
                    return BadRequest(new { success = false, error = "A group with this name already exists" });
                group.Name = req.Name.Trim();
            }

            if (req.Description != null)
                group.Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim();

            group.UpdatedAt = DateTime.UtcNow;
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), GROUP_UPDATED, new { group.GroupId, group.Name, group.Description });

            return Ok(new { success = true, data = new { group.GroupId, group.Name, group.Description, group.UpdatedAt } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating group {GroupId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/groups/{id}
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteGroup(Guid id)
    {
        try
        {
            var group = await context.Groups.FirstOrDefaultAsync(g => g.GroupId == id);
            if (group == null)
                return NotFound(new { success = false, error = "Group not found" });

            context.Groups.Remove(group);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), GROUP_DELETED, new { group.GroupId, group.Name });

            return Ok(new { success = true, message = "Group deleted" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting group {GroupId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/groups/{id}/members — add a user to the group
    [HttpPost("{id}/members")]
    public async Task<ActionResult<object>> AddMember(Guid id, [FromBody] AddGroupMemberRequest req)
    {
        try
        {
            var group = await context.Groups.FirstOrDefaultAsync(g => g.GroupId == id);
            if (group == null)
                return NotFound(new { success = false, error = "Group not found" });

            var user = await context.Users.FirstOrDefaultAsync(u => u.UserId == req.UserId);
            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            if (await context.GroupMembers.AnyAsync(gm => gm.GroupId == id && gm.UserId == req.UserId))
                return BadRequest(new { success = false, error = "User is already a member of this group" });

            var member = new DmsGroupMember
            {
                GroupMemberId = Guid.NewGuid(),
                GroupId = id,
                UserId = req.UserId,
                AddedAt = DateTime.UtcNow,
            };

            context.GroupMembers.Add(member);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), GROUP_MEMBER_ADDED, new { GroupId = id, group.Name, req.UserId, user.FullName });

            return Ok(new
            {
                success = true,
                data = new { member.GroupMemberId, member.UserId, UserName = user.FullName, UserEmail = user.Email, member.AddedAt },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error adding member to group {GroupId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/groups/{id}/members/{userId} — remove a user from the group
    [HttpDelete("{id}/members/{userId}")]
    public async Task<ActionResult<object>> RemoveMember(Guid id, Guid userId)
    {
        try
        {
            var member = await context.GroupMembers.FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);
            if (member == null)
                return NotFound(new { success = false, error = "User is not a member of this group" });

            context.GroupMembers.Remove(member);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), GROUP_MEMBER_REMOVED, new { GroupId = id, UserId = userId });

            return Ok(new { success = true, message = "Member removed" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error removing member from group {GroupId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateGroupRequest(string Name, string? Description = null);
public record UpdateGroupRequest(string? Name = null, string? Description = null);
public record AddGroupMemberRequest(Guid UserId);
