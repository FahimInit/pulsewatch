# Pulsewatch — Monitoring Engine

## Execution Pipeline

Each scheduled or manual monitor check follows a deterministic 9-step workflow inside `@pulsewatch/worker`:

1. **Dequeue Job**: BullMQ `monitor-check` worker receives `{ monitorId, reason }`.
2. **Per-Monitor Mutual Exclusion**: Acquire Redis lock `lock:monitor:<monitorId>` (`NX PX <timeoutMs + 5000>`) to prevent overlapping checks when manual and scheduled triggers coincide.
3. **Load Configuration**: Fetch `Monitor` + any active `MaintenanceWindow` (`startsAt <= now <= endsAt`). If monitor is deleted or `PAUSED`, remove its BullMQ scheduler and exit cleanly.
4. **Execute Hardened HTTP Health Check**:
   - Validate URL scheme (`http:`/`https:`), port, and hostname.
   - Resolve DNS and validate all returned IPv4/IPv6 addresses against the SSRF blocklist inside the socket `lookup` hook.
   - Measure `dnsTimeMs`, `connectTimeMs`, `ttfbMs`, and total `responseTimeMs`.
   - Follow up to `5` redirects manually, re-validating each target URL and resolved IP.
   - Stream response up to `1 MB` (`MAX_RESPONSE_SIZE_BYTES`) and evaluate status code + optional keyword rule.
5. **Classify Check Outcome**:
   - `DOWN`: Network/DNS/TLS error, timeout, SSRF block, unexpected status code, or failed keyword match.
   - `DEGRADED`: Valid status & keyword, but `responseTimeMs > degradedThresholdMs`.
   - `OPERATIONAL`: Valid status & keyword, and `responseTimeMs <= degradedThresholdMs`.
6. **Atomic PostgreSQL Transaction**:
   - Lock `Monitor` row (`SELECT ... FOR UPDATE`).
   - Insert `MonitoringResult` and upsert `MonitorDailyRollup`.
   - Update `Monitor` (`status`, `consecutiveFailures`, `consecutiveSuccesses`, `lastCheckedAt`, `lastResponseTimeMs`).
   - Evaluate `Incident` creation/auto-recovery and matching `AlertRule` triggers (unless suppressed by active `MaintenanceWindow`).
7. **Dispatch Alerts**: Enqueue idempotent jobs on `notification-dispatch`.
8. **Broadcast Real-Time Telemetry**: Publish `monitor:checked`, `monitor:status_changed`, and `incident:*` events to Redis Pub/Sub.
9. **Schedule Continuity**: BullMQ `upsertJobScheduler('monitor:<id>', { every: intervalSeconds * 1000 })` maintains drift-free recurring execution, backed by a 5-minute `scheduler-reconciler` job.

## Reliability & Shutdown
- Target HTTP errors never fail the BullMQ job; BullMQ retries apply strictly to transient internal database/Redis failures.
- `SIGTERM` / `SIGINT` triggers `worker.close()`, waiting for in-flight HTTP checks to complete before closing Prisma and Redis clients.
