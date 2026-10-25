using System.IO.Compression;
using System.Text.Json;

namespace DMS.Api.Services;

// Produces a portable recovery point: the complete Postgres data export and
// every object stored by DMS (documents, all document versions, task files,
// legacy archives, and branding). The archive is deliberately created before
// it is copied to the mounted Synology path, so an interrupted copy can never
// be mistaken for a recoverable backup.
public sealed class RecoveryArchiveService(
    DatabaseExportService databaseExportService,
    MinioService minioService,
    ILogger<RecoveryArchiveService> logger)
{
    public sealed record RecoveryArchive(string Path, int ObjectCount, long DatabaseBytes, long SizeBytes);

    public async Task<(RecoveryArchive? Archive, string? Error)> CreateAsync(CancellationToken cancellationToken = default)
    {
        var (databaseBytes, databaseError) = await databaseExportService.ExportSqlDumpAsync();
        if (databaseBytes == null)
            return (null, databaseError ?? "Database export failed");

        var archivePath = Path.Combine(Path.GetTempPath(), $"dms-recovery-{Guid.NewGuid():N}.zip");
        try
        {
            // Backup archives are output, never source material. Everything
            // else in the bucket is application data and must be recoverable.
            var objectKeys = (await minioService.ListAsync())
                .Where(key => !key.StartsWith(ScheduledBackupKeys.ObjectPrefix, StringComparison.Ordinal))
                .OrderBy(key => key, StringComparer.Ordinal)
                .ToList();

            var manifestObjects = new List<object>(objectKeys.Count);
            await using (var file = new FileStream(archivePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous))
            using (var archive = new ZipArchive(file, ZipArchiveMode.Create, leaveOpen: false))
            {
                var databaseEntry = archive.CreateEntry("database/dms-data.sql", CompressionLevel.Optimal);
                await using (var destination = databaseEntry.Open())
                    await destination.WriteAsync(databaseBytes, cancellationToken);

                foreach (var objectKey in objectKeys)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    // Object keys are created by DMS and use forward slashes.
                    // Prefixing them keeps this archive's contents distinct.
                    var objectEntry = archive.CreateEntry($"objects/{objectKey}", CompressionLevel.Optimal);
                    await using var source = await minioService.DownloadAsync(objectKey);
                    await using var destination = objectEntry.Open();
                    await source.CopyToAsync(destination, cancellationToken);
                    manifestObjects.Add(new { key = objectKey, sizeBytes = source.Length });
                }

                var manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
                await using var manifest = manifestEntry.Open();
                await JsonSerializer.SerializeAsync(manifest, new
                {
                    format = "dms-recovery-v1",
                    createdAtUtc = DateTime.UtcNow,
                    database = new { path = "database/dms-data.sql", sizeBytes = databaseBytes.LongLength },
                    objects = manifestObjects,
                }, cancellationToken: cancellationToken);
            }

            var sizeBytes = new FileInfo(archivePath).Length;
            logger.LogInformation("Created complete recovery archive with {ObjectCount} objects ({SizeBytes} bytes)", objectKeys.Count, sizeBytes);
            return (new RecoveryArchive(archivePath, objectKeys.Count, databaseBytes.LongLength, sizeBytes), null);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create complete recovery archive");
            TryDelete(archivePath);
            return (null, "Recovery archive creation failed — see server logs");
        }
    }

    public static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* temp cleanup must not hide the actual backup result */ }
    }
}
