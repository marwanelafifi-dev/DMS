# --- build stage ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

# Fix SSL/TLS certificate issues - update certificates FIRST
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Configure NuGet with multiple sources and longer timeout
RUN mkdir -p /root/.nuget/NuGet && cat > /root/.nuget/NuGet/NuGet.Config << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="microsoft" value="https://packages.microsoft.com/nuget/static/index.json" />
  </packageSources>
  <config>
    <add key="repositoryPath" value="/root/.nuget/packages" />
    <add key="http_timeout" value="300" />
  </config>
</configuration>
EOF

COPY *.csproj ./
RUN dotnet restore --source https://api.nuget.org/v3/index.json --source https://packages.microsoft.com/nuget/static/index.json || \
    dotnet restore --source https://packages.microsoft.com/nuget/static/index.json
COPY . ./
RUN dotnet publish -c Release -o /app --no-restore

# --- runtime stage ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
# curl is used by the compose healthcheck; postgresql-client-16 provides
# pg_dump, used by DatabaseBackupController to export a real data-only SQL
# backup — pg_dump refuses to dump from a server newer than itself, and
# Debian bookworm's default postgresql-client package is v15 while the
# compose Postgres image is v16, so the PGDG apt repo is needed for a
# matching client version.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg lsb-release \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && update-ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app ./
EXPOSE 8080
ENTRYPOINT ["dotnet", "DMS.Api.dll"]
