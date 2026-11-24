# Pulsewatch — Incident Lifecycle

## States & Severity

- **Statuses**: `INVESTIGATING` -> `IDENTIFIED` -> `MONITORING` -> `RESOLVED`
- **Severities**: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`

## Lifecycle Transitions

1. **Detection (`INVESTIGATING`)**:
   - Triggered automatically when a monitor's `consecutiveFailures` reaches `failureThreshold` (default `2`) outside a suppressed maintenance window.
   - Creates `Incident` + `IncidentEvent(type = DETECTED)` with failure diagnostics (HTTP status, error type, latency).
2. **Duplicate Prevention**:
   - During an ongoing outage (`status != 'RESOLVED'`), subsequent failed checks increment `consecutiveFailures` on the `Monitor` without creating additional `Incident` rows.
   - Enforced at three levels: Redis per-monitor lock, transactional `SELECT ... FOR UPDATE` check, and PostgreSQL partial unique index `idx_incidents_one_open_per_monitor`.
3. **Human Triage (`IDENTIFIED` / `MONITORING`)**:
   - **Acknowledge**: Records `acknowledgedAt`, `acknowledgedById`, and `IncidentEvent(type = ACKNOWLEDGED)`.
   - **Status Change**: Engineers update status to `IDENTIFIED` or `MONITORING`, recording `IncidentEvent(type = STATUS_CHANGED)`.
   - **Investigation Notes**: Engineers append timestamped markdown/plain-text notes (`IncidentEvent(type = INVESTIGATION_NOTE)`).
4. **Automatic Recovery (`RESOLVED`)**:
   - When the monitor achieves `consecutiveSuccesses >= recoveryThreshold` (default `2`), the worker automatically transitions the open incident to `RESOLVED`, sets `resolvedAt`, appends `RECOVERY_DETECTED` and `RESOLVED` timeline events, and dispatches recovery notifications.
5. **Manual Resolution (`RESOLVED`)**:
   - Authorized project members can manually resolve an incident with `resolutionNotes`, recording `resolvedById` and `IncidentEvent(type = RESOLVED)`.
