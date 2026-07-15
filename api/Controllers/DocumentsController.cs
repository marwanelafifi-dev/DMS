using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DocumentsController(DmsContext context) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetDocuments([FromQuery] Guid? folderId)
    {
        var query = context.Documents.AsQueryable();

        if (folderId.HasValue)
            query = query.Where(d => d.FolderId == folderId);

        var documents = await query
            .Select(d => new
            {
                d.DocumentId,
                d.Title,
                d.Status,
                d.TrackingCode,
                d.OwnerId,
                d.CurrentVersionId,
                d.FolderId,
                d.CreatedAt
            })
            .ToListAsync();

        return Ok(documents);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetDocument(Guid id)
    {
        var document = await context.Documents
            .FirstOrDefaultAsync(d => d.DocumentId == id);

        if (document == null)
            return NotFound();

        var versions = await context.DocumentVersions
            .Where(v => v.DocumentId == id)
            .Select(v => new { v.VersionId, v.VersionNumber, v.Status, v.CreatedAt })
            .ToListAsync();

        return Ok(new
        {
            document.DocumentId,
            document.Title,
            document.Status,
            document.TrackingCode,
            document.OwnerId,
            document.FolderId,
            document.CurrentVersionId,
            Versions = versions,
            VersionCount = versions.Count,
            document.CreatedAt
        });
    }

    [HttpPost]
    public async Task<ActionResult<object>> CreateDocument(CreateDocumentRequest req)
    {
        var document = new DmsDocument
        {
            DocumentId = Guid.NewGuid(),
            FolderId = req.FolderId,
            Title = req.Title,
            Status = "draft",
            OwnerId = req.OwnerId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        context.Documents.Add(document);
        await context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetDocument), new { id = document.DocumentId }, new
        {
            document.DocumentId,
            document.Title,
            document.Status,
            document.CreatedAt
        });
    }
}

public record CreateDocumentRequest(string Title, Guid FolderId, Guid OwnerId);
