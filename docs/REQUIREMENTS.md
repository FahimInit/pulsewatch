# Pulsewatch — Functional & Non-Functional Requirements

## 1. Functional Requirements

### 1.1 Authentication & User Profile
- Users can register with name, email, and password (hashed with `bcryptjs`, cost factor `12`), automatically provisioning a default workspace project.
- Login returns a short-lived (`15m`) signed JWT access token and sets an `HttpOnly`, `SameSite=Strict` rotating refresh token cookie (`7d`).
- Token refresh rotates the refresh token and detects token-family replay attacks, revoking the entire session family on reuse.
- Users can log out, update profile metadata (name, timezone), and change passwords (invalidating active refresh tokens).

### 1.2 Project Management
- Create, list, update, and delete workspace projects.
- Manage project collaborators (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) and inspect project audit logs.
- Enforce per-project monitor slot limits (`monitorLimit`, default `20` on Free tier).

### 1.3 Monitor Management
- Protocols: `http:` and `https:` only.
- HTTP methods: `GET`, `POST`, `HEAD`.
- Custom headers (sanitized against hop-by-hop header injection), optional `POST` body, expected HTTP status code list, timeout (`1000ms`–`30000ms`), interval (`15s`–`3600s`), degraded latency threshold (`ms`), failure/recovery consecutive thresholds, and optional keyword (`CONTAINS` / `NOT_CONTAINS`).
- Lifecycle states: `PENDING`, `OPERATIONAL`, `DEGRADED`, `DOWN`, `PAUSED`.
- Pause, resume, and rate-limited on-demand **Check Now** actions.

### 1.4 Monitoring Engine
- Independent BullMQ workers execute checks, measure total/DNS/TCP/TTFB timings, persist `MonitoringResult` + `MonitorDailyRollup`, update `Monitor` health counters atomically, evaluate `Incident` and `AlertRule` conditions, and broadcast live updates via Redis Pub/Sub -> Socket.IO.

### 1.5 Incident Management
- Automatically open an `Incident` (`INVESTIGATING`) when `consecutiveFailures >= failureThreshold`.
- Guarantee zero duplicate open incidents per monitor during ongoing outages.
- Support incident acknowledgement, status transitions (`INVESTIGATING`, `IDENTIFIED`, `MONITORING`, `RESOLVED`), investigation notes, automatic recovery resolution (`consecutiveSuccesses >= recoveryThreshold`), and manual resolution with notes.

### 1.6 Notifications & Alert Rules
- Configurable `AlertRule` definitions scoped to a project or specific monitor (`MONITOR_DOWN`, `MONITOR_RECOVERED`, `HIGH_LATENCY`, `INCIDENT_CREATED`, `INCIDENT_RESOLVED`) with cooldown suppression.
- Dispatch both real-time in-app notifications and SMTP email alerts.

### 1.7 Analytics & Public Status Pages
- Compute real-time and historical uptime %, response-time time series, health breakdown, and period-over-period comparisons directly from PostgreSQL.
- Publish unauthenticated `/status/:slug` pages with selected monitor groups, 90-day uptime history, incident history, and `MaintenanceWindow` announcements.

---

## 2. Non-Functional Requirements
- **SSRF Immunity**: Block private, loopback, link-local, CGNAT, multicast, and cloud metadata IPs across IPv4 and IPv6 using socket-pinned DNS resolution and manual redirect re-validation.
- **Tenant Isolation (Anti-IDOR)**: Every project-scoped resource verifies `ProjectMember` membership and role before reading or mutating data.
- **Fault Isolation**: API server and background worker run as independent OS processes/containers communicating strictly through PostgreSQL and Redis.
- **Observability**: Structured JSON logging via Pino, health/readiness probes, and immutable `AuditLog` entries for sensitive mutations.
