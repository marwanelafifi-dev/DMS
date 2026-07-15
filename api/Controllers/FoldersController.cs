using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FoldersController(DmsContext context) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetFolders()
    {
        var folders = await context.Folders
            .Select(f => new
            {
                f.FolderId,
                f.Name,
                f.Description,
                f.Classification,
                f.ParentFolderId,
                f.OwnerId,
                f.CreatedAt
            })
            .ToListAsync();
        return Ok(folders);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetFolder(Guid id)
    {
        var folder = await context.Folders
            .FirstOrDefaultAsync(f => f.FolderId == id);

        if (folder == null)
            return NotFound();

        var permissions = await context.FolderPermissions
            .Where(p => p.FolderId == id)
            .Select(p => new { p.UserId, p.Role })
            .ToListAsync();

        return Ok(new
        {
            folder.FolderId,
            folder.Name,
            folder.Description,
            folder.Classification,
            folder.ParentFolderId,
            folder.OwnerId,
            Permissions = permissions,
            folder.CreatedAt
        });
    }

    [HttpPost]
    public async Task<ActionResult<object>> CreateFolder(CreateFolderRequest req)
    {
        var folder = new DmsFolder
        {
            FolderId = Guid.NewGuid(),
            ParentFolderId = req.ParentFolderId,
            Name = req.Name,
            Description = req.Description,
            Classification = req.Classification ?? "standard",
            OwnerId = req.OwnerId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        context.Folders.Add(folder);
        await context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetFolder), new { id = folder.FolderId }, new
        {
            folder.FolderId,
            folder.Name,
            folder.CreatedAt
        });
    }
}

public record CreateFolderRequest(string Name, Guid OwnerId, Guid? ParentFolderId = null, string? Description = null, string? Classification = null);
