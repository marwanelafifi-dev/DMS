using System.Net;
using SMBLibrary;
using SMBLibrary.Client;

namespace DMS.Api.Services;

// Connects directly to a Windows/AD network share over SMB2/3 using
// credentials entered in the GUI (Scheduled Backups → Network Share) —
// no host-level CIFS mount required, unlike the plain "Destination Path"
// option in ScheduledBackupService. This is the one place in the app that
// takes a username/password for an external system and keeps it in the
// database (dms_app_settings, plain JSON, same pattern already used for the
// SMTP password) rather than a locked-down host-only file — a deliberate
// tradeoff for simpler setup, made explicit rather than hidden.
//
// Built against SMBLibrary from memory in an offline environment with no
// package-source access to double-check exact method signatures — this is
// the single highest-compile-risk file from this session; if
// `docker compose build api` reports a missing member/overload here, report
// the exact error and it'll be corrected against the real package API.
public record NetworkShareConfig(bool Enabled, string Host, string ShareName, string? Domain, string? Username, string? Password, string? SubPath)
{
    public static readonly NetworkShareConfig Default = new(false, "", "", null, null, null, null);
}

public static class SmbBackupService
{
    // Builds the share-relative path for a file, joining the optional
    // sub-folder — SMB paths use backslashes regardless of the host OS.
    private static string BuildRelativePath(NetworkShareConfig config, string fileName)
    {
        var subPath = (config.SubPath ?? "").Trim('/', '\\');
        return string.IsNullOrEmpty(subPath) ? fileName : $"{subPath}\\{fileName}";
    }

    private static (bool Success, string? Error, SMB2Client? Client, ISMBFileStore? FileStore) Connect(NetworkShareConfig config)
    {
        var client = new SMB2Client();
        try
        {
            IPAddress[] addresses;
            try
            {
                addresses = IPAddress.TryParse(config.Host, out var direct) ? [direct] : Dns.GetHostAddresses(config.Host);
            }
            catch (Exception ex)
            {
                return (false, $"Could not resolve host '{config.Host}': {ex.Message}", null, null);
            }
            if (addresses.Length == 0)
                return (false, $"Could not resolve host '{config.Host}'", null, null);

            if (!client.Connect(addresses[0], SMBTransportType.DirectTCPTransport))
                return (false, $"Could not connect to '{config.Host}' on port 445 — check the network path and firewall", null, null);

            var loginStatus = client.Login(config.Domain ?? string.Empty, config.Username ?? string.Empty, config.Password ?? string.Empty);
            if (loginStatus != NTStatus.STATUS_SUCCESS)
            {
                client.Disconnect();
                return (false, $"Login failed ({loginStatus}) — check the username, password, and domain", null, null);
            }

            var fileStore = client.TreeConnect(config.ShareName, out var treeStatus);
            if (treeStatus != NTStatus.STATUS_SUCCESS || fileStore == null)
            {
                client.Logoff();
                client.Disconnect();
                return (false, $"Could not connect to share '{config.ShareName}' ({treeStatus}) — check the share name and that this account has access", null, null);
            }

            return (true, null, client, fileStore);
        }
        catch (Exception ex)
        {
            try { client.Disconnect(); } catch { /* already torn down */ }
            return (false, ex.Message, null, null);
        }
    }

    private static void Disconnect(SMB2Client client, ISMBFileStore fileStore)
    {
        try { fileStore.Disconnect(); } catch { /* best-effort */ }
        try { client.Logoff(); } catch { /* best-effort */ }
        try { client.Disconnect(); } catch { /* best-effort */ }
    }

    private static (bool Success, string? Error) WriteFile(ISMBFileStore fileStore, string relativePath, byte[] bytes)
    {
        var createStatus = fileStore.CreateFile(
            out var handle, out _, relativePath,
            AccessMask.GENERIC_WRITE | AccessMask.SYNCHRONIZE,
            SMBLibrary.FileAttributes.Normal,
            ShareAccess.None,
            CreateDisposition.FILE_OVERWRITE_IF,
            CreateOptions.FILE_NON_DIRECTORY_FILE | CreateOptions.FILE_SYNCHRONOUS_IO_ALERT,
            null);
        if (createStatus != NTStatus.STATUS_SUCCESS)
            return (false, $"Could not create '{relativePath}' on the share ({createStatus})");

        try
        {
            var writeStatus = fileStore.WriteFile(out _, handle, 0, bytes);
            if (writeStatus != NTStatus.STATUS_SUCCESS)
                return (false, $"Could not write '{relativePath}' to the share ({writeStatus})");
            return (true, null);
        }
        finally
        {
            fileStore.CloseFile(handle);
        }
    }

    // Writes a real, tiny probe file and immediately overwrites it with
    // nothing to prove write access — used both by "Save Schedule" (so a
    // wrong host/credential/share surfaces immediately) and could be reused
    // for a dedicated "Test Connection" button later.
    public static (bool Success, string? Error) TestConnection(NetworkShareConfig config)
    {
        var (connected, connectError, client, fileStore) = Connect(config);
        if (!connected || client == null || fileStore == null)
            return (false, connectError);

        try
        {
            var probeName = BuildRelativePath(config, $".dms-write-test-{Guid.NewGuid():N}.tmp");
            var (writeOk, writeError) = WriteFile(fileStore, probeName, []);
            if (!writeOk)
                return (false, writeError);

            // Best-effort cleanup of the probe file — a leftover empty
            // .dms-write-test-*.tmp file is harmless, so failure here doesn't
            // turn a genuinely-successful write test into a failure.
            try
            {
                var deleteStatus = fileStore.CreateFile(
                    out var deleteHandle, out _, probeName,
                    AccessMask.DELETE | AccessMask.SYNCHRONIZE,
                    SMBLibrary.FileAttributes.Normal,
                    ShareAccess.None,
                    CreateDisposition.FILE_OPEN,
                    CreateOptions.FILE_NON_DIRECTORY_FILE | CreateOptions.FILE_DELETE_ON_CLOSE | CreateOptions.FILE_SYNCHRONOUS_IO_ALERT,
                    null);
                if (deleteStatus == NTStatus.STATUS_SUCCESS)
                    fileStore.CloseFile(deleteHandle);
            }
            catch { /* best-effort cleanup only */ }

            return (true, null);
        }
        finally
        {
            Disconnect(client, fileStore);
        }
    }

    public static (bool Success, string? Error) SaveBackup(NetworkShareConfig config, string fileName, byte[] bytes)
    {
        var (connected, connectError, client, fileStore) = Connect(config);
        if (!connected || client == null || fileStore == null)
            return (false, connectError);

        try
        {
            return WriteFile(fileStore, BuildRelativePath(config, fileName), bytes);
        }
        finally
        {
            Disconnect(client, fileStore);
        }
    }

    // Mirrors ScheduledBackupService's MinIO/local-path retention — lists
    // every dms-backup-*.sql file directly under the configured sub-path and
    // deletes everything past the newest keepLastN (file names embed a
    // sortable timestamp, so a plain descending sort is newest-first).
    public static void EnforceRetention(NetworkShareConfig config, int keepLastN)
    {
        var (connected, _, client, fileStore) = Connect(config);
        if (!connected || client == null || fileStore == null)
            return;

        try
        {
            var directoryPath = (config.SubPath ?? "").Trim('/', '\\');
            var openStatus = fileStore.CreateFile(
                out var dirHandle, out _, directoryPath,
                AccessMask.GENERIC_READ | AccessMask.SYNCHRONIZE,
                SMBLibrary.FileAttributes.Directory,
                ShareAccess.Read | ShareAccess.Write,
                CreateDisposition.FILE_OPEN,
                CreateOptions.FILE_DIRECTORY_FILE | CreateOptions.FILE_SYNCHRONOUS_IO_ALERT,
                null);
            if (openStatus != NTStatus.STATUS_SUCCESS)
                return;

            fileStore.QueryDirectory(out var fileList, dirHandle, "dms-backup-*.sql", FileInformationClass.FileDirectoryInformation);
            fileStore.CloseFile(dirHandle);

            var fileNames = fileList
                .OfType<FileDirectoryInformation>()
                .Select(f => f.FileName)
                .OrderByDescending(name => name)
                .Skip(keepLastN)
                .ToList();

            foreach (var name in fileNames)
            {
                try
                {
                    var relativePath = string.IsNullOrEmpty(directoryPath) ? name : $"{directoryPath}\\{name}";
                    var deleteStatus = fileStore.CreateFile(
                        out var handle, out _, relativePath,
                        AccessMask.DELETE | AccessMask.SYNCHRONIZE,
                        SMBLibrary.FileAttributes.Normal,
                        ShareAccess.None,
                        CreateDisposition.FILE_OPEN,
                        CreateOptions.FILE_NON_DIRECTORY_FILE | CreateOptions.FILE_DELETE_ON_CLOSE | CreateOptions.FILE_SYNCHRONOUS_IO_ALERT,
                        null);
                    if (deleteStatus == NTStatus.STATUS_SUCCESS)
                        fileStore.CloseFile(handle);
                }
                catch { /* best-effort — one bad file shouldn't stop the rest */ }
            }
        }
        catch { /* best-effort retention only — never allowed to affect the backup itself */ }
        finally
        {
            Disconnect(client, fileStore);
        }
    }
}
