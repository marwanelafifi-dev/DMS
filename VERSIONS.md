# Enterprise DMS — Environment & Version Reference

Snapshot of every runtime, database, and major dependency version currently used by the app, taken directly from the live running containers and the actual dependency manifests (not just assumed from documentation). Last verified: 2026-08-12.

---

## Database

| Item | Value |
| :-- | :-- |
| **Database engine** | PostgreSQL |
| **Version (image)** | `postgres:16-alpine` |
| **Version (live server)** | PostgreSQL **16.14** on x86_64-pc-linux-musl (Alpine build) |
| **ORM / driver** | Entity Framework Core via `Npgsql.EntityFrameworkCore.PostgreSQL` **8.0.4** |
| **Migrations** | Plain versioned SQL files in `infra/db/init/` (currently `001` → `074`), applied automatically on a brand-new volume, or manually via `psql` against an existing one |
| **Background job storage** | Hangfire jobs (reminders, auto-unlock, calendar sync, etc.) are persisted in the same Postgres database via `Hangfire.PostgreSql` **1.20.8** — no separate job-storage database |

**Other data stores used alongside Postgres (not relational databases, but part of the data layer):**

| Item | Value |
| :-- | :-- |
| **Object storage** (uploaded files/attachments/logos/backups) | MinIO — image `minio/minio:latest`, live version `RELEASE.2025-09-07T16-13-09Z` (S3-compatible API) |
| **Cache** | Redis — image `redis:7-alpine`, live version **7.4.10** |

---

## Backend (API)

| Item | Value |
| :-- | :-- |
| **Language / framework** | C# / ASP.NET Core |
| **Target framework** | `.NET 8.0` (`net8.0`) |
| **Live runtime version** | `Microsoft.AspNetCore.App` / `Microsoft.NETCore.App` **8.0.30** |
| **Build image** | `mcr.microsoft.com/dotnet/sdk:8.0` |
| **Runtime image** | `mcr.microsoft.com/dotnet/aspnet:8.0` |

**Key NuGet packages:**

| Package | Version |
| :-- | :-- |
| Npgsql.EntityFrameworkCore.PostgreSQL | 8.0.4 |
| Microsoft.EntityFrameworkCore.Design | 8.0.11 |
| Minio (client SDK) | 6.0.2 |
| Hangfire.Core / Hangfire.AspNetCore | 1.8.14 |
| Hangfire.PostgreSql | 1.20.8 |
| System.IdentityModel.Tokens.Jwt | 8.1.2 |
| Google.Apis.Auth | 1.68.0 |
| Google.Apis.Calendar.v3 | 1.68.0.3430 |
| ClosedXML (Excel export) | 0.104.1 |

**OCR / document-parsing sidecar (`ocr-rag/`):** separate Python service — FastAPI + Docling, used for local, offline document-to-Markdown/PDF conversion (Word/PowerPoint/Excel/OCR text extraction). Runs alongside the .NET API as its own container, not part of the ASP.NET Core app itself.

---

## Frontend (Web)

| Item | Value |
| :-- | :-- |
| **Language / framework** | TypeScript / React |
| **App version** (`package.json`) | `1.0.0-phase2` |
| **React** | 18.3.1 |
| **Build tool** | Vite **5.4.21** |
| **TypeScript** | **5.9.3** (resolved from `^5.5.4`) |
| **Node.js** (build image) | `node:20-alpine` — live-resolved Node **20.20.2**, npm **10.8.2** |
| **Runtime / server image** | `nginx:alpine` — live version **nginx/1.31.3** |

**Key frontend libraries:**

| Package | Version |
| :-- | :-- |
| react / react-dom | ^18.3.1 |
| react-router-dom | ^6.20.0 |
| axios | ^1.6.2 |
| zustand | ^4.4.1 |
| pdfjs-dist | ^4.10.38 |
| xlsx | ^0.18.5 |
| docx | ^9.7.1 |
| react-markdown | ^10.1.0 |
| @radix-ui/react-* (dialog, dropdown, popover, select, tabs, tooltip) | 1.x |
| tailwindcss | ^3.3.6 |
| vitest (test runner) | ^3.2.7 |

---

## Container orchestration

| Service | Image |
| :-- | :-- |
| `postgres` | `postgres:16-alpine` |
| `minio` | `minio/minio:latest` |
| `redis` | `redis:7-alpine` |
| `api` | built from `api/Dockerfile` → `mcr.microsoft.com/dotnet/aspnet:8.0` |
| `web` | built from `web/Dockerfile` → `nginx:alpine` |
| `cloudflared` (production tunnel only) | `cloudflare/cloudflared:latest` |

Defined in `docker-compose.yml` at the repo root; local development runs on Windows Docker Desktop, production targets Ubuntu + Cloudflare Tunnel (same compose file, no code changes between environments).
