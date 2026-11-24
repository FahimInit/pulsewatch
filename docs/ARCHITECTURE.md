# Pulsewatch — System Architecture

## Process Topology

Pulsewatch separates concerns into four workspace packages sharing a single PostgreSQL + Redis backbone:

1. **`@pulsewatch/shared` (`shared/`)**:
   - Pure TypeScript Zod schemas, API DTO types, Socket.IO typed event contracts, BullMQ job payload definitions, and zero-dependency IPv4/IPv6 CIDR classification utilities.
2. **`@pulsewatch/server` (`server/`)**:
   - Express 4 REST API mounted at `/api/v1` + Socket.IO WebSocket gateway.
   - Enforces JWT authentication, rotating refresh cookies, RBAC authorization, Zod input validation, rate limiting, and audit logging.
   - Acts as a **BullMQ Producer** (registering/removing monitor job schedulers and manual checks) and **Redis Pub/Sub Subscriber** (forwarding worker events to authorized `project:<id>` and `user:<id>` WebSocket rooms).
3. **`@pulsewatch/worker` (`worker/`)**:
   - Standalone Node.js background service hosting BullMQ workers (`monitor-check`, `notification-dispatch`, `system-maintenance`).
   - Executes outbound HTTP checks through a custom socket-pinned HTTP/HTTPS agent, runs transactional state evaluations in PostgreSQL, dispatches emails via Nodemailer, and publishes domain events to Redis Pub/Sub.
4. **`@pulsewatch/client` (`client/`)**:
   - React + TypeScript + Vite SPA styled to the Pulsewatch visual specification (`#f7f8fc` background, `#7657e8` purple primary, `#ffffff` cards, Inter typography, Lucide icons).
   - Uses TanStack Query for server state caching, Socket.IO for instant cache invalidation and live indicators, Zustand for active workspace/auth state, and Recharts for time-series visualization.

## Inter-Process Event Flow

```text
[BullMQ Timer] -> [worker: monitor-check]
                      |--> Hardened HTTP/HTTPS Check (Pinned IP, 1MB Cap)
                      |--> PostgreSQL Tx (Result + Rollup + Monitor + Incident)
                      |--> [BullMQ: notification-dispatch] --> In-App DB + SMTP Email
                      +--> [Redis Pub/Sub: pulsewatch:events]
                                  |
                                  v
                        [server: Socket.IO] --> Room `project:<projectId>` --> [client SPA]
```
