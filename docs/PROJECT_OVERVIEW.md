# Pulsewatch — Project Overview

## Mission
Pulsewatch is a developer-focused **API Monitoring and Incident Management Platform** built with the PERN stack, TypeScript, Prisma, Redis, BullMQ, and Socket.IO. It provides continuous availability verification, sub-millisecond latency tracking, deterministic incident lifecycle automation, multi-channel alerting, historical SLA analytics, and public status pages.

## Core Capabilities
1. **Multi-Project Workspaces & RBAC**: Organize monitors, incidents, alert rules, and status pages per project with role-based access (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) and plan quota tracking.
2. **Configurable HTTP/HTTPS Health Monitoring**: Support `GET`, `POST`, and `HEAD` checks with custom headers, request payloads, expected HTTP status codes, configurable intervals (`15s`–`3600s`), strict timeouts (`1s`–`30s`), and response keyword assertions.
3. **Decoupled BullMQ Background Engine**: Independent worker processes execute checks asynchronously without impacting API latency, backed by self-healing schedule reconciliation and graceful `SIGTERM`/`SIGINT` draining.
4. **Incident Lifecycle & Deduplication**: Automatic outage detection after configurable consecutive failures, database-enforced single-open-incident guarantees per monitor, acknowledgement, timeline investigation notes, automatic recovery detection, and manual resolution.
5. **Multi-Channel Alerting**: Real-time in-app notifications via Socket.IO + SMTP email dispatch with configurable alert rules, latency thresholds, cooldown windows, and idempotent delivery deduplication.
6. **Real-Time & Historical Analytics**: SQL-backed uptime percentages, period-over-period deltas, average/P95 response-time charts, and monitor health distributions.
7. **Public Status Pages & Maintenance Windows**: Shareable `/status/:slug` pages displaying selected service health, 90-day daily uptime strips, public incident timelines, and scheduled maintenance windows with optional alert suppression.
