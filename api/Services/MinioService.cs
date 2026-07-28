using Minio;
using Minio.DataModel.Args;

namespace DMS.Api.Services;

public class MinioService
{
    private readonly IMinioClient _minioClient;
    private readonly string _bucketName;
    private readonly ILogger<MinioService> _logger;

    public MinioService(IMinioClient minioClient, IConfiguration config, ILogger<MinioService> logger)
    {
        _minioClient = minioClient;
        _bucketName = config["Minio:BucketName"] ?? "dms-documents";
        _logger = logger;
    }

    public async Task EnsureBucketExistsAsync()
    {
        try
        {
            _logger.LogInformation("Checking if bucket exists: {BucketName}", _bucketName);

            var existsArgs = new BucketExistsArgs().WithBucket(_bucketName);
            var exists = await _minioClient.BucketExistsAsync(existsArgs);

            if (!exists)
            {
                _logger.LogInformation("Creating MinIO bucket: {BucketName}", _bucketName);
                var makeBucketArgs = new MakeBucketArgs().WithBucket(_bucketName);
                await _minioClient.MakeBucketAsync(makeBucketArgs);
            }

            _logger.LogInformation("Bucket ready: {BucketName}", _bucketName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to ensure bucket exists");
            throw;
        }
    }

    public async Task<string> UploadAsync(string objectKey, Stream fileStream, string contentType = "application/octet-stream")
    {
        var tempPath = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());

        try
        {
            _logger.LogInformation("Uploading object: {ObjectKey}", objectKey);

            // Save stream to temp file
            using (var fileWriter = File.Create(tempPath))
            {
                await fileStream.CopyToAsync(fileWriter);
            }

            // Upload from file
            var fileInfo = new FileInfo(tempPath);
            var putObjectArgs = new PutObjectArgs()
                .WithBucket(_bucketName)
                .WithObject(objectKey)
                .WithContentType(contentType)
                .WithObjectSize(fileInfo.Length)
                .WithFileName(tempPath);

            await _minioClient.PutObjectAsync(putObjectArgs);

            _logger.LogInformation("Successfully uploaded: {ObjectKey}", objectKey);
            return objectKey;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to upload object: {ObjectKey}", objectKey);
            throw;
        }
        finally
        {
            if (File.Exists(tempPath))
                File.Delete(tempPath);
        }
    }

    public async Task<Stream> DownloadAsync(string objectKey)
    {
        try
        {
            _logger.LogInformation("Downloading object: {ObjectKey}", objectKey);

            var stream = new MemoryStream();

            var getObjectArgs = new GetObjectArgs()
                .WithBucket(_bucketName)
                .WithObject(objectKey)
                .WithCallbackStream(s => s.CopyTo(stream));

            await _minioClient.GetObjectAsync(getObjectArgs);

            stream.Seek(0, SeekOrigin.Begin);
            _logger.LogInformation("Successfully downloaded: {ObjectKey}", objectKey);
            return stream;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to download object: {ObjectKey}", objectKey);
            throw;
        }
    }

    public async Task<List<string>> ListAsync(string prefix = "")
    {
        try
        {
            var objects = new List<string>();

            var listObjectsArgs = new ListObjectsArgs()
                .WithBucket(_bucketName)
                .WithPrefix(prefix)
                .WithRecursive(true);

            var observable = _minioClient.ListObjectsAsync(listObjectsArgs);

            var tcs = new TaskCompletionSource<bool>();

            observable.Subscribe(
                item => objects.Add(item.Key),
                ex => tcs.TrySetException(ex),
                () => tcs.TrySetResult(true));

            await tcs.Task;

            _logger.LogInformation("Listed {Count} objects with prefix: {Prefix}", objects.Count, prefix);
            return objects;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list objects with prefix: {Prefix}", prefix);
            throw;
        }
    }

    public async Task DeleteAsync(string objectKey)
    {
        try
        {
            _logger.LogInformation("Deleting object: {ObjectKey}", objectKey);

            var removeObjectArgs = new RemoveObjectArgs()
                .WithBucket(_bucketName)
                .WithObject(objectKey);

            await _minioClient.RemoveObjectAsync(removeObjectArgs);

            _logger.LogInformation("Successfully deleted: {ObjectKey}", objectKey);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete object: {ObjectKey}", objectKey);
            throw;
        }
    }
}
