using DMS.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/audits")]
public class AuditPacksController(DmsContext context) : BaseController
{
    [HttpGet("{id:guid}/pack.pdf")]
    public async Task<IActionResult> DownloadPdf(Guid id)
    {
        var audit = await context.AuditRecords.AsNoTracking().FirstOrDefaultAsync(item => item.AuditRecordId == id);
        if (audit == null) return NotFound(new { success = false, error = "Audit record not found" });
        var pcars = await context.Tasks.AsNoTracking().Where(task => task.AuditRecordId == id && task.TaskType == "pcar").OrderBy(task => task.FindingNumber).ToListAsync();
        var packNumber = $"AUD-{audit.AuditDate:yyyy}-{audit.AuditRecordId.ToString()[..8].ToUpperInvariant()}";
        var generatedAt = DateTime.UtcNow;
        var pdf = Document.Create(document => document.Page(page =>
        {
            page.Margin(36); page.Size(PageSizes.A4); page.DefaultTextStyle(style => style.FontSize(9));
            page.Header().Column(column => { column.Item().Text("Si-Ware Systems").FontSize(18).Bold().FontColor(Colors.Blue.Darken3); column.Item().Text("Controlled Audit Pack").FontSize(12).SemiBold(); column.Item().Text($"Pack {packNumber} · Generated {generatedAt:dd MMM yyyy HH:mm} UTC").FontSize(8).FontColor(Colors.Grey.Darken1); });
            page.Content().PaddingVertical(18).Column(column =>
            {
                column.Spacing(8); column.Item().Text(audit.Title).FontSize(15).Bold();
                column.Item().Text($"Standard: {audit.Standard}   |   Cycle: {audit.AuditCycleId}   |   Type: {audit.AuditType}   |   Status: {audit.Status}");
                column.Item().Text($"Audit date: {audit.AuditDate:dd MMM yyyy}   |   Scope: {audit.Scope}");
                column.Item().Text($"Audit team: {(audit.AuditTeam.Length == 0 ? "Not assigned" : string.Join(", ", audit.AuditTeam))}");
                column.Item().PaddingTop(10).Text("Findings and PCARs").FontSize(12).Bold();
                if (pcars.Count == 0) column.Item().Text("No PCAR findings are linked to this audit.");
                foreach (var pcar in pcars) column.Item().Border(1).BorderColor(Colors.Grey.Lighten1).Padding(6).Column(item => { item.Item().Text($"{pcar.FindingNumber ?? pcar.TaskNumber ?? "PCAR"} — {pcar.Title}").Bold(); item.Item().Text($"Severity: {pcar.FindingSeverity ?? "Not assessed"} · Clause: {pcar.StandardClause ?? "Not stated"} · Status: {pcar.Status}"); item.Item().Text(pcar.AuditorNotes ?? pcar.Description ?? "No objective evidence note recorded."); });
                column.Item().PaddingTop(10).Text("Controlled documents").FontSize(12).Bold();
                column.Item().Text($"Audit Plan document ID: {audit.AuditPlanDocumentId?.ToString() ?? "Not selected"}");
                column.Item().Text($"Audit Report document ID: {audit.AuditReportDocumentId?.ToString() ?? "Not selected"}");
            });
            page.Footer().AlignCenter().Text(text => { text.Span("Controlled DMS export · "); text.CurrentPageNumber(); text.Span(" / "); text.TotalPages(); });
        })).GeneratePdf();
        return File(pdf, "application/pdf", $"{packNumber}.pdf");
    }
}
