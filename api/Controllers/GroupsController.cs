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
                    SubgroupCount = context.GroupSubgroups.Count(gs => gs.ParentGroupId == g.GroupId),
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

            var subgroups = await context.GroupSubgroups
                .Where(gs => gs.ParentGroupId == id)
                .Include(gs => gs.ChildGroup)
                .OrderBy(gs => gs.ChildGroup!.Name)
                .Select(gs => new
                {
                    gs.GroupSubgroupId,
                    ChildGroupId = gs.ChildGroupId,
                    ChildGroupName = gs.ChildGroup!.Name,
                    gs.AddedAt,
                })
                .ToListAsync();

            return Ok(new
            {
                success = true,
                data = new { group.GroupId, group.Name, group.Description, group.CreatedAt, group.UpdatedAt, Members = members, Subgroups = subgroups },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving group {GroupId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/groups/for-user/{userId} — which groups a given user currently belongs to
    // (used by the Users admin page's "Manage Groups" action, so it doesn't have to
    // fetch every group's full member list just to figure out which ones already match).
    [HttpGet("for-user/{userId}")]
    public async Task<ActionResult<object>> GetGroupsForUser(Guid userId)
    {
        try
        {
            var groupIds = await context.GroupMembers
                .Where(gm => gm.UserId == userId)
                .Select(gm => gm.GroupId)
                .ToListAsync();

            return Ok(new { success = true, data = groupIds });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving groups for user {UserId}", userId);
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

    // POST /api/groups/{id}/subgroups — nest an existing group inside this one
    [HttpPost("{id}/subgroups")]
    public async Task<ActionResult<object>> AddSubgroup(Guid id, [FromBody] AddSubgroupRequest req)
    {
        try
        {
            if (id == req.ChildGroupId)
                return BadRequest(new { success = false, error = "A group cannot contain itself" });

            var parent = await context.Groups.FirstOrDefaultAsync(g => g.GroupId == id);
            if (parent == null)
                return NotFound(new { success = false, error = "Group not found" });

            var child = await context.Groups.FirstOrDefaultAsync(g => g.GroupId == req.ChildGroupId);
            if (child == null)
                return NotFound(new { success = false, error = "Subgroup not found" });

            if (await context.GroupSubgroups.AnyAsync(gs => gs.ParentGroupId == id && gs.ChildGroupId == req.ChildGroupId))
                return BadRequest(new { success = false, error = "This group is already a subgroup" });

            // Reject if the proposed child already (directly or indirectly) contains
            // the parent — otherwise this would create a membership cycle.
            var descendantsOfChild = await GetDescendantGroupIdsAsync(req.ChildGroupId);
            if (descendantsOfChild.Contains(id))
                return BadRequest(new { success = false, error = "Adding this group would create a circular nesting" });

            var subgroup = new DmsGroupSubgroup
            {
                GroupSubgroupId = Guid.NewGuid(),
                ParentGroupId = id,
                ChildGroupId = req.ChildGroupId,
                AddedAt = DateTime.UtcNow,
            };

            context.GroupSubgroups.Add(subgroup);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), GROUP_SUBGROUP_ADDED, new { ParentGroupId = id, ParentName = parent.Name, req.ChildGroupId, ChildName = child.Name });

            return Ok(new
            {
                success = true,
                data = new { subgroup.GroupSubgroupId, ChildGroupId = child.GroupId, ChildGroupName = child.Name, subgroup.AddedAt },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error adding subgroup to group {GroupId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/groups/{id}/subgroups/{childGroupId} — un-nest a subgroup
    [HttpDelete("{id}/subgroups/{childGroupId}")]
    public async Task<ActionResult<object>> RemoveSubgroup(Guid id, Guid childGroupId)
    {
        try
        {
            var subgroup = await context.GroupSubgroups.FirstOrDefaultAsync(gs => gs.ParentGroupId == id && gs.ChildGroupId == childGroupId);
            if (subgroup == null)
                return NotFound(new { success = false, error = "This group is not a subgroup" });

            context.GroupSubgroups.Remove(subgroup);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), GROUP_SUBGROUP_REMOVED, new { ParentGroupId = id, ChildGroupId = childGroupId });

            return Ok(new { success = true, message = "Subgroup removed" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error removing subgroup from group {GroupId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // Breadth-first walk down the "contains" graph — every group directly or
    // indirectly nested inside groupId.
    private async Task<HashSet<Guid>> GetDescendantGroupIdsAsync(Guid groupId)
    {
        var descendants = new HashSet<Guid>();
        var frontier = new Queue<Guid>();
        frontier.Enqueue(groupId);

        while (frontier.Count > 0)
        {
            var current = frontier.Dequeue();
            var children = await context.GroupSubgroups
                .Where(gs => gs.ParentGroupId == current)
                .Select(gs => gs.ChildGroupId)
                .ToListAsync();

            foreach (var childId in children)
            {
                if (descendants.Add(childId))
                    frontier.Enqueue(childId);
            }
        }

        return descendants;
    }
}

public record CreateGroupRequest(string Name, string? Description = null);
public record UpdateGroupRequest(string? Name = null, string? Description = null);
public record AddGroupMemberRequest(Guid UserId);
public record AddSubgroupRequest(Guid ChildGroupId);
