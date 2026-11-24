# Pulsewatch

**Pulsewatch** is a production-grade API Monitoring and Incident Management Platform built on the **PERN** stack (PostgreSQL, Express, React, Node.js) with **TypeScript**, **Prisma**, **Redis**, **BullMQ**, and **Socket.IO**.

It enables engineering teams to continuously monitor HTTP/HTTPS endpoints, measure response-time percentiles and uptime SLAs, detect outages automatically without alert flapping, coordinate incident triage timelines, dispatch real-time and email notifications, and publish public service status pages.

---

## Architecture Highlights

- **Decoupled Multi-Process Runtime**:
  - `server`: Stateless Express REST API (`/api/v1`) + Socket.IO real-time gateway subscribed to Redis Pub/Sub events.
  - `worker`: Independent BullMQ worker processes running `monitor-check`, `notification-dispatch`, and `system-maintenance` (self-healing scheduler reconciliation + bounded data retention).
  - `client`: React + TypeScript + Vite + Tailwind CSS + Recharts + TanStack Query + Zustand dashboard and public status page SPA.
  - `shared`: Shared Zod validation contracts, DTO types, and pure IPv4/IPv6 CIDR security classifiers.
- **Socket-Pinned SSRF Defense-in-Depth**:
  - Blocks RFC 1918 private networks, loopback, link-local/cloud metadata (`169.254.169.254`), CGNAT, multicast, IPv6 ULA/link-local, and unwrapped IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1`).
  - Eliminates DNS Rebinding (TOCTOU) by validating resolved DNS records inside a custom socket `lookup` hook and pinning the TCP connection directly to the verified IP, re-validating every redirect hop manually, enforcing strict timeouts, and capping streamed response payloads at `1 MB`.
- **Database-Enforced Incident Deduplication**:
  - Combines per-monitor Redis execution locks, PostgreSQL `SELECT ... FOR UPDATE` row locking, consecutive failure/recovery thresholds, and a partial unique index (`UNIQUE (monitor_id) WHERE status <> 'RESOLVED'`) so concurrent outages never spawn duplicate open incidents.

---

## Repository Structure

```text
pulsewatch/
├── client/             # React + Vite + Tailwind + TanStack Query + Recharts SPA
├── server/             # Express REST API + Socket.IO real-time gateway
├── worker/             # Independent BullMQ monitoring & notification workers
├── shared/             # Shared Zod schemas, DTOs, and IP/SSRF classifiers
├── prisma/             # PostgreSQL Prisma schema, SQL migrations, and seed script
├── design-reference/   # Original visual design specification (HTML/CSS)
├── docs/               # Comprehensive architecture, security, and lifecycle docs
├── scripts/            # Local infrastructure & seed orchestration scripts
└── docker-compose.yml  # PostgreSQL 16, Redis 7, Mailpit, API, Worker, and Web
```

---

## Quick Start

### Option A: Docker Compose (Recommended Infrastructure)

```bash
cp .env.example .env
docker compose up -d postgres redis mailpit
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

### Option B: Zero-Docker Local Development (Embedded Postgres + Redis)

If Docker Desktop is not running locally, Pulsewatch includes an embedded local infrastructure runner (`embedded-postgres` + `redis-memory-server`) for development and integration tests:

```bash
cp .env.example .env
npm install
npm run dev:local
```

### Running Tests

```bash
npm test
```

---

## Documentation

Detailed engineering documentation is maintained in [`docs/`](./docs):

- [`docs/PROJECT_OVERVIEW.md`](./docs/PROJECT_OVERVIEW.md)
- [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- [`docs/DATABASE_DESIGN.md`](./docs/DATABASE_DESIGN.md)
- [`docs/MONITORING_ENGINE.md`](./docs/MONITORING_ENGINE.md)
- [`docs/INCIDENT_LIFECYCLE.md`](./docs/INCIDENT_LIFECYCLE.md)
- [`docs/SECURITY.md`](./docs/SECURITY.md)
- [`docs/DEVELOPMENT_ROADMAP.md`](./docs/DEVELOPMENT_ROADMAP.md)
- [`docs/DEVELOPMENT_LOG.md`](./docs/DEVELOPMENT_LOG.md)
