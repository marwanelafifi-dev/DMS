using System.Net.Http.Headers;
using System.Net.Http.Json;
using DMS.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public sealed class OcrIndexService(DmsContext context, MinioService minioService, IHttpClientFactory httpClientFactory, ILogger<OcrIndexService> logger)
{
    public Task<bool> ReindexJobAsync(Guid documentId) => ReindexAsync(documentId);

    [Hangfire.DisableConcurrentExecution(7200)]
    public async Task ReindexBatchJobAsync(List<Guid> documentIds)
    {
        foreach (var documentId in documentIds.Distinct())
        {
            try { await ReindexAsync(documentId); }
            catch (Exception exception) { logger.LogError(exception, "Batch OCR indexing failed for {DocumentId}", documentId); }
        }
    }

    public async Task<List<OcrIndexStatus>> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var inventory = await GetIndexInventoryAsync(cancellationToken);
        var rows = await (from document in context.Documents.AsNoTracking()
            join version in context.DocumentVersions.AsNoTracking() on document.CurrentVersionId equals (Guid?)version.VersionId into versions
            from version in versions.DefaultIfEmpty()
            where document.DeletedAt == null && document.CurrentVersionId != null
            orderby document.Title
            select new { document.DocumentId, document.Title, FileName = version == null ? "" : version.FileName, VersionId = version == null ? (Guid?)null : version.VersionId })
            .ToListAsync(cancellationToken);
        return rows.Select(row => new OcrIndexStatus(row.DocumentId, row.Title, row.FileName, row.VersionId,
            row.VersionId.HasValue && inventory.TryGetValue(row.DocumentId.ToString(), out var indexedVersion) && indexedVersion == row.VersionId.Value.ToString())).ToList();
    }

    public async Task<bool> ReindexAsync(Guid documentId, CancellationToken cancellationToken = default)
    {
        var row = await (from document in context.Documents.AsNoTracking()
            join version in context.DocumentVersions.AsNoTracking() on document.CurrentVersionId equals (Guid?)version.VersionId
            where document.DocumentId == documentId && document.DeletedAt == null
            select new { document.DocumentId, version.VersionId, version.FileName, version.MimeType, version.S3ObjectKey }).FirstOrDefaultAsync(cancellationToken);
        if (row == null || string.IsNullOrWhiteSpace(row.S3ObjectKey)) return false;

        await using var source = await minioService.DownloadAsync(row.S3ObjectKey);
        using var multipart = new MultipartFormDataContent();
        using var fileContent = new StreamContent(source);
        if (MediaTypeHeaderValue.TryParse(row.MimeType, out var contentType)) fileContent.Headers.ContentType = contentType;
        multipart.Add(fileContent, "file", row.FileName);
        multipart.Add(new StringContent(row.DocumentId.ToString()), "document_id");
        multipart.Add(new StringContent(row.VersionId.ToString()), "version_id");
        var client = httpClientFactory.CreateClient("OcrRag");
        using var response = await client.PostAsync("api/documents/upload", multipart, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Automatic OCR indexing failed for {DocumentId}: {Status} {Detail}", documentId, response.StatusCode, await response.Content.ReadAsStringAsync(cancellationToken));
            return false;
        }
        logger.LogInformation("OCR index rebuilt for document {DocumentId}, version {VersionId}", documentId, row.VersionId);
        return true;
    }

    [Hangfire.DisableConcurrentExecution(1800)]
    public async Task AutoIndexMissingAsync()
    {
        var missing = (await GetStatusAsync()).Where(item => !item.IsIndexed).Take(10).ToList();
        foreach (var item in missing)
        {
            try { await ReindexAsync(item.DocumentId); }
            catch (Exception exception) { logger.LogError(exception, "Automatic OCR indexing failed for {DocumentId}", item.DocumentId); }
        }
        logger.LogInformation("Automatic OCR scan processed {Count} missing documents", missing.Count);
    }

    private async Task<Dictionary<string, string?>> GetIndexInventoryAsync(CancellationToken cancellationToken)
    {
        try
        {
            var client = httpClientFactory.CreateClient("OcrRag");
            var rows = await client.GetFromJsonAsync<List<IndexInventoryRow>>("api/documents/index-inventory", cancellationToken) ?? [];
            return rows.ToDictionary(row => row.DocumentId, row => row.VersionId, StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            logger.LogWarning(exception, "Could not read OCR index inventory");
            return new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        }
    }
}

public sealed record OcrIndexStatus(Guid DocumentId, string Title, string FileName, Guid? VersionId, bool IsIndexed);
public sealed record IndexInventoryRow(
    [property: System.Text.Json.Serialization.JsonPropertyName("document_id")] string DocumentId,
    [property: System.Text.Json.Serialization.JsonPropertyName("version_id")] string? VersionId);
