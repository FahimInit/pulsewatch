# Pulsewatch — Development Log

## 2026-11-24 — Phase 0 & Repository Initialization
- Completed system architecture, database entity design, BullMQ worker topology, incident deduplication model, and socket-pinned SSRF security specification.
- Initialized Git repository on `master` branch.
- Added static visual specification in `design-reference/index.html` and `design-reference/styles.css`.
- Created `.env.example`, `README.md`, and core architecture documentation under `docs/`.

## 2026-11-24 — Phase 1: Foundation Completed
- Configured npm workspaces (`@pulsewatch/shared`, `@pulsewatch/server`, `@pulsewatch/worker`, `@pulsewatch/client`) and GitHub Actions CI targeting `master`.
- Authored full PostgreSQL Prisma schema (`15` models) and BOM-free SQL migration including partial unique index `idx_incidents_one_open_per_monitor`.
- Implemented Express API foundation, Pino structured redacting logger, Redis connection factory, health/readiness probes, and automated Vitest + Supertest suite against live PostgreSQL 16 and Redis.
- Initialized React + Vite + Tailwind + shadcn/ui primitive foundation matching the Pulsewatch visual specification.

## 2026-11-24 — Phase 2: Authentication & Project Management Completed
- Implemented `/api/v1/auth` (register, login, rotating `HttpOnly` refresh token cookie with family-wide replay detection, logout, `/me` profile & password rotation).
- Implemented `/api/v1/projects` multi-tenant workspace CRUD, collaborator RBAC (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), audit log recording, and anti-IDOR middleware.
- Built frontend silent refresh client, Zustand workspace store, Login/Register pages, `Sidebar` + `Topbar` + `AppShell`, and `SettingsPage`.
- Verified auth, token replay detection, RBAC, and IDOR isolation via Supertest integration suite.

## 2026-11-24 — Phase 3: Monitor Management & SSRF Guard Completed
- Implemented pre-flight SSRF URL/DNS/header validator blocking private, loopback, link-local, metadata, CGNAT, multicast, and mapped-IPv6 targets.
- Built `/api/v1/projects/:projectId/monitors` CRUD, pause/resume, manual `check-now`, check result history, quota enforcement, and BullMQ v5 `upsertJobScheduler`/`removeJobScheduler` synchronization.
- Created `MonitorTable`, `MonitorFormDialog`, `MonitorsPage`, and `MonitorDetailPage` with Recharts response-time history.
- Added unit and Supertest suites (`shared/tests/ssrf.test.ts`, `server/tests/monitors.test.ts`).

## 2026-11-25 — Phase 4: Monitoring Engine & Real-Time Gateway Completed
- Implemented socket-pinned HTTP/HTTPS checker (`worker/src/checker/http-checker.ts`) measuring DNS/TCP/TTFB/total latency, validating keywords, re-validating redirect hops against SSRF, and enforcing timeouts + `1 MB` payload limits.
- Built transactional check evaluator (`SELECT ... FOR UPDATE`), daily rollup upsert (`MonitorDailyRollup`), self-healing 5-minute scheduler reconciler, and bounded raw retention pruner.
- Attached authenticated Socket.IO gateway subscribed to Redis Pub/Sub (`pulsewatch:events`) and `useRealtimeSync` frontend hook.
