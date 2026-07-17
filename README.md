# Enterprise DMS v7.4

On-premises Document Management System (QMS + ISMS) for ISO 9001:2015 / ISO 27001:2022 compliance.
See [docs/PRD.md](docs/PRD.md) for requirements and [docs/DEV_PLAN.md](docs/DEV_PLAN.md) for architecture and roadmap.

## Monorepo layout

```
DMS/
├── docker-compose.yml     # portable stack (Windows local → Ubuntu unchanged)
├── .env.example           # copy to .env
├── api/                   # .NET 8 Web API — auth, RBAC, workflows, vault
├── ocr-rag/               # Python FastAPI sidecar — OCR + local RAG
├── web/                   # React + TypeScript (Vite) frontend
├── infra/db/init/         # Postgres init SQL (WORM roles, schema)
└── docs/                  # PRD + development plan
```

## Services

| Service   | Purpose                     | Local URL                    |
| :-------- | :-------------------------- | :--------------------------- |
| web       | Frontend (nginx)            | http://localhost:5173        |
| api       | .NET 8 API                  | http://localhost:8080/health |
| ocr-rag   | OCR/RAG sidecar             | http://localhost:8100/health |
| postgres  | Database                    | localhost:5432               |
| minio     | Object storage + console    | http://localhost:9001        |
| redis     | Cache / job state           | localhost:6379               |

## Prerequisites

- Docker Desktop with the **WSL2 backend** working (needs CPU virtualization enabled in BIOS
  and the *Virtual Machine Platform* Windows feature). Verify with `wsl --status`.

## Run locally (Stage 1 — Windows)

```bash
cp .env.example .env      # then edit passwords
docker compose up --build
```

Open http://localhost:5173 — the page shows the API health as a connectivity check.

## Expose (Stage 2 — Ubuntu + Cloudflare Tunnel)

1. Copy the repo to the Ubuntu host, set `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.
2. `docker compose --profile tunnel up -d --build`

The same compose file runs unchanged; `cloudflared` dials out to Cloudflare (no inbound ports).

## Phase status

✅ **Phase 0** — Foundations complete (scaffold + Docker stack)
✅ **Phase 1** — Core API + RBAC + Audit logging complete
✅ **Phase 2 Backend** — Document checkout, approvals, tasks complete
✅ **Phase 2 Frontend** — Professional UI, multi-format viewer, state management complete

**Next:** Phase 3 — OCR integration + Workflow templates
