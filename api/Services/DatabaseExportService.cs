using System.Diagnostics;
using System.Text;
using Npgsql;

namespace DMS.Api.Services;

// The pg_dump invocation shared by the manual "Download Backup" button and
// the Scheduled Backups background job — one place owns "how do we turn the
// live database into a .sql file" so the two paths can't drift apart.
public class DatabaseExportService(IConfiguration configuration, ILogger<DatabaseExportService> logger)
{
    public async Task<(byte[]? Bytes, string? Error)> ExportSqlDumpAsync()
    {
        try
        {
            var csb = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Default"));

            var psi = new ProcessStartInfo
            {
                FileName = "pg_dump",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            psi.ArgumentList.Add("--data-only");
            psi.ArgumentList.Add("--inserts");
            psi.ArgumentList.Add("--no-owner");
            psi.ArgumentList.Add("--no-privileges");
            psi.ArgumentList.Add("--schema=public");
            psi.ArgumentList.Add("-h"); psi.ArgumentList.Add(csb.Host ?? "postgres");
            psi.ArgumentList.Add("-p"); psi.ArgumentList.Add(csb.Port.ToString());
            psi.ArgumentList.Add("-U"); psi.ArgumentList.Add(csb.Username ?? "postgres");
            psi.ArgumentList.Add(csb.Database ?? "dms");
            psi.Environment["PGPASSWORD"] = csb.Password;

            using var process = Process.Start(psi)!;
            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            var output = await outputTask;
            var error = await errorTask;

            if (process.ExitCode != 0)
            {
                logger.LogError("pg_dump exited with {Code}: {Error}", process.ExitCode, error);
                return (null, "Backup export failed — see server logs");
            }

            return (Encoding.UTF8.GetBytes(output), null);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error exporting database backup");
            return (null, ex.Message);
        }
    }
}
