# Pulsewatch — Development Roadmap

All work targets the `master` branch with incremental feature commits and automated test verification at every phase.

- [x] **Phase 0 — Planning & Architecture**: System architecture, database schema, BullMQ strategy, SSRF security model, API contract, and milestone breakdown.
- [x] **Phase 1 — Foundation**: npm-workspaces monorepo (`shared`, `server`, `worker`, `client`), `design-reference/`, Docker Compose (`postgres`, `redis`, `mailpit`), Prisma schema + SQL migration, Pino structured logging, Express health probes, React shell converting the visual prototype, and GitHub Actions CI (`master`).
- [ ] **Phase 2 — Authentication & Projects**: Registration, login, rotating refresh tokens, logout, user profile/password settings, multi-project CRUD, collaborator RBAC, audit logs, and Auth/Project integration tests.
- [ ] **Phase 3 — Monitor Management**: Shared IP/CIDR + DNS SSRF guard, Monitor CRUD + pause/resume + Check-Now endpoints, Monitor management UI & detail view, and URL/SSRF security test suite.
- [ ] **Phase 4 — Monitoring Engine**: BullMQ job schedulers, socket-pinned HTTP checker, transactional `MonitoringResult` + `MonitorDailyRollup` persistence, 5-minute schedule reconciler, retention job, and Socket.IO live telemetry updates.
- [ ] **Phase 5 — Incident Management**: Consecutive failure/recovery threshold state machine, partial-unique-index deduplication, Incident list & timeline UI, Acknowledge / Investigation Notes / Manual Resolve workflows, and incident lifecycle tests.
- [ ] **Phase 6 — Notifications**: Configurable `AlertRule` engine with cooldowns, real-time in-app notification center, and Nodemailer SMTP alert worker.
- [ ] **Phase 7 — Analytics & Public Status Pages**: SQL-backed Overview & Analytics charts (uptime, latency, health distribution) + Public Status Pages (`/status/:slug`) with 90-day uptime bars and `MaintenanceWindow` announcements.
- [ ] **Phase 8 — Testing & Production Readiness**: End-to-end Vitest + Supertest security/integration verification, production Dockerfiles, seed data, and final documentation sign-off.
