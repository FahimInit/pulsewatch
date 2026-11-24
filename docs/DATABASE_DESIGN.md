# Pulsewatch — Database Design

## Storage Engine & ORM
- **Database**: PostgreSQL 16
- **ORM & Migrations**: Prisma 6 (`prisma/schema.prisma` + versioned SQL migrations)

## Core Entities
1. **`User` & `RefreshToken`**: Identity, password hash, preferences, and hashed rotating refresh sessions with `familyId` replay detection.
2. **`Project` & `ProjectMember`**: Multi-tenant workspace boundaries, plan quotas (`monitorLimit`), and RBAC roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`).
3. **`Monitor`**: Target endpoint configuration, HTTP method/headers/body, status expectations, keyword assertions, consecutive failure/recovery thresholds, and live health snapshot (`status`, `consecutiveFailures`, `consecutiveSuccesses`, `lastCheckedAt`, `lastResponseTimeMs`).
4. **`MonitoringResult`**: Append-only check execution log (`BigInt` PK, `checkedAt`, `status`, `statusCode`, `responseTimeMs`, `dnsTimeMs`, `connectTimeMs`, `ttfbMs`, `responseSizeBytes`, `errorType`, `resolvedIp`).
5. **`MonitorDailyRollup`**: Daily aggregated metrics per monitor (`(monitorId, day)` composite PK: `totalChecks`, `upChecks`, `degradedChecks`, `downChecks`, `avgLatencyMs`, `p95LatencyMs`) enabling sub-5ms 90-day uptime queries.
6. **`Incident` & `IncidentEvent`**: Outage lifecycle tracking with immutable timeline entries (`DETECTED`, `ACKNOWLEDGED`, `STATUS_CHANGED`, `INVESTIGATION_NOTE`, `ALERT_SENT`, `RECOVERY_DETECTED`, `RESOLVED`).
7. **`AlertRule` & `Notification`**: Alert routing rules with cooldown tracking and persisted in-app/email delivery records guarded by unique `dedupeKey`.
8. **`StatusPage`, `StatusPageMonitor`, & `MaintenanceWindow`**: Public status page configuration, ordered service groups, and scheduled maintenance windows with alert suppression.
9. **`AuditLog`**: Security and configuration audit trail per project.

## Key Constraints & Indexes
- **Single Open Incident Constraint**:
  ```sql
  CREATE UNIQUE INDEX "idx_incidents_one_open_per_monitor"
  ON "incidents" ("monitor_id")
  WHERE "status" <> 'RESOLVED';
  ```
- **Time-Series Query Indexes**:
  - `monitoring_results (monitor_id, checked_at DESC)`
  - `monitoring_results (monitor_id, status, checked_at)`
  - `monitoring_results (checked_at)`
- **Retention Policy**:
  - Raw `MonitoringResult` records older than `RAW_RESULT_RETENTION_DAYS` (default `30` days) are deleted in bounded batches by the `system-maintenance` worker, while `MonitorDailyRollup` preserves `365` days of daily history.
