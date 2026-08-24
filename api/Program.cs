using DMS.Api;
using DMS.Api.Data;
using DMS.Api.Middleware;
using DMS.Api.Services;
using Hangfire;
using Hangfire.Dashboard;
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

builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddScoped<MinioService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<CheckoutService>();
builder.Services.AddScoped<ApprovalService>();
builder.Services.AddScoped<TaskService>();
builder.Services.AddScoped<ReminderService>();
builder.Services.AddScoped<AuditCalendarService>();
builder.Services.AddScoped<UserGoogleCalendarService>();
builder.Services.AddScoped<AccessOverrideService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddHttpClient("OcrRag", client =>
{
    var baseUrl = builder.Configuration["OcrRag:BaseUrl"] ?? "http://ocr-rag:8000";
    client.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(100);
});
// Falls back to a clear "not configured" error at runtime (IsConfigured
// false) if Google:ClientSecret/CalendarRedirectUri aren't set — see
// IGoogleOAuthCalendarClient.cs for what configuring it involves.
builder.Services.AddSingleton<IGoogleOAuthCalendarClient, GoogleOAuthCalendarClient>();
// Falls back to a clear "not configured" no-op (IsConfigured false) if
// Smtp:User/Password aren't set — see EmailService.cs.
builder.Services.AddSingleton<EmailService>();
builder.Services.AddScoped<GoogleMeetingReminderService>();
builder.Services.AddScoped<AnnouncementService>();
builder.Services.AddScoped<DatabaseExportService>();
builder.Services.AddScoped<ScheduledBackupService>();
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

// Health endpoints (before RBAC middleware — skip auth)
app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy",
    service = "dms-api",
    timestamp = DateTime.UtcNow
}));

// Hangfire Dashboard (readonly for now)
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new NoAuthorizationFilter() }
});

// Login session validation — runs before RBAC and forwards the authenticated
// user id into the X-User-Id header RBACMiddleware already trusts.
app.UseMiddleware<JwtAuthMiddleware>();

// RBAC Middleware — permission check
app.UseMiddleware<RBACMiddleware>();

app.MapControllers();

// Configure Hangfire recurring jobs
using (var scope = app.Services.CreateScope())
{
    var recurringJobManager = scope.ServiceProvider.GetRequiredService<IRecurringJobManager>();
    app.ConfigureBackgroundJobs(recurringJobManager);
}

app.MapGet("/", () => Results.Ok(new
{
    message = "Enterprise DMS v7.4 — API (Phase 1: Core Vault + RBAC + MinIO)",
    version = "1.0.0-phase1",
    docs = "/swagger or /health",
    minioStatus = "Ready"
}));

app.Run();
