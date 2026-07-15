using DMS.Api.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Database
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Connection string 'Default' not found.");
builder.Services.AddDbContext<DmsContext>(options =>
    options.UseNpgsql(connectionString));

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

app.UseCors();
app.MapControllers();

// Health endpoints
app.MapHealthChecks("/health");

app.MapGet("/", () => Results.Ok(new
{
    message = "Enterprise DMS v7.4 — API (Phase 1: Core Vault + RBAC)",
    version = "1.0.0-phase1",
    docs = "/swagger or /health"
}));

app.Run();
