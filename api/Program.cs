using DMS.Api.Data;
using DMS.Api.Middleware;
using DMS.Api.Services;
using Hangfire;
using Hangfire.PostgreSql;
using Minio;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Database
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Connection string 'Default' not found.");
builder.Services.AddDbContext<DmsContext>(options =>
    options.UseNpgsql(connectionString));

// MinIO — Object Storage
var minioEndpoint = builder.Configuration["Minio:Endpoint"] ?? "minio:9000";
var minioAccessKey = builder.Configuration["Minio:AccessKey"] ?? "dms_minio";
var minioSecretKey = builder.Configuration["Minio:SecretKey"] ?? "change_me_dev_only";
var minioUseSSL = builder.Configuration.GetValue<bool>("Minio:UseSSL");

builder.Services.AddSingleton<IMinioClient>(sp =>
{
    var minioClient = new MinioClient()
        .WithEndpoint(minioEndpoint)
        .WithCredentials(minioAccessKey, minioSecretKey);

    if (minioUseSSL)
        minioClient = minioClient.WithSSL();

    return minioClient.Build();
});

builder.Services.AddScoped<MinioService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<CheckoutService>();
builder.Services.AddScoped<ApprovalService>();
builder.Services.AddScoped<TaskService>();
builder.Services.AddScoped<ReminderService>();
builder.Services.AddBackgroundJobs();

// Hangfire — Background job processing
builder.Services.AddHangfire(config =>
    config.UsePostgreSqlStorage(connectionString));
builder.Services.AddHangfireServer();

// CORS — allow web frontend
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(p => p
        .WithOrigins("http://localhost:5173", "http://localhost:80")
        .AllowAnyHeader()
        .AllowAnyMethod()));

// Controllers
builder.Services.AddControllers();

// Health checks
builder.Services.AddHealthChecks();

var app = builder.Build();

// Initialize MinIO bucket on startup
using (var scope = app.Services.CreateScope())
{
    var minioService = scope.ServiceProvider.GetRequiredService<MinioService>();
    await minioService.EnsureBucketExistsAsync();
}

app.UseCors();

// Hangfire Dashboard (readonly for now)
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new NoAuthorizationFilter() }
});

// RBAC Middleware — التحقق من الصلاحيات
app.UseMiddleware<RBACMiddleware>();

app.MapControllers();

// Configure Hangfire recurring jobs
using (var scope = app.Services.CreateScope())
{
    var recurringJobManager = scope.ServiceProvider.GetRequiredService<IRecurringJobManager>();
    app.ConfigureBackgroundJobs(recurringJobManager);
}

// Health endpoints
app.MapHealthChecks("/health");

app.MapGet("/", () => Results.Ok(new
{
    message = "Enterprise DMS v7.4 — API (Phase 1: Core Vault + RBAC + MinIO)",
    version = "1.0.0-phase1",
    docs = "/swagger or /health",
    minioStatus = "Ready"
}));

app.Run();
