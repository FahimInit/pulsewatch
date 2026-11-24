# Pulsewatch — Security Architecture

## 1. SSRF Prevention (Defense-in-Depth)
- **Protocol Restriction**: Only `http:` and `https:` URLs are accepted; credentials in URLs (`user:pass@host`) and dangerous internal service ports (`22`, `25`, `5432`, `6379`, `27017`) are rejected.
- **IPv4/IPv6 CIDR Blocklist**: Blocks loopback (`127.0.0.0/8`, `::1`), RFC 1918 private ranges (`10/8`, `172.16/12`, `192.168/16`), link-local and cloud metadata (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), IPv6 ULA (`fc00::/7`), multicast, broadcast, and unwrapped IPv4-mapped IPv6 (`::ffff:0:0/96`) / NAT64 (`64:ff9b::/96`) addresses.
- **Socket-Pinned DNS**: Outbound worker checks validate all DNS `A`/`AAAA` answers inside a custom `http.Agent`/`https.Agent` `lookup` callback and connect directly to the validated IP, defeating DNS Rebinding (TOCTOU).
- **Manual Redirect Re-Validation**: Redirects (`301/302/303/307/308`, max `5` hops) are never followed automatically; every hop undergoes full URL + pinned-DNS validation.
- **Timeouts & Payload Caps**: Strict `AbortController` timeouts (`<= 30s`) and streaming `1 MB` response size limits protect workers from slowloris and memory-exhaustion responses.

## 2. Authentication, Session & Brute-Force Controls
- Passwords hashed with `bcryptjs` (`12` rounds).
- Short-lived (`15m`) JWT access tokens + rotating `HttpOnly`, `SameSite=Strict` refresh token cookies stored as `SHA-256` hashes in PostgreSQL with family-wide replay revocation.
- Dedicated rate limiters on `/auth/login`, `/auth/register`, `/auth/refresh`, `/monitors/:id/check-now`, and public status page routes.

## 3. Authorization & Tenant Isolation (Anti-IDOR)
- Every `/projects/:projectId/*` route runs `requireProjectMembership` middleware verifying the caller's `ProjectMember` record and minimum role (`VIEWER`, `MEMBER`, `ADMIN`, `OWNER`), scoping all subsequent Prisma queries by `projectId`.

## 4. Injection, XSS & Information Leakage Protections
- All database access uses parameterized Prisma queries (`$queryRaw` tagged templates where analytical SQL is used—never string concatenation).
- All request bodies, params, and query strings are validated and stripped of unknown keys via Zod schemas.
- `helmet` HTTP security headers, strict CORS origin allowlisting, redacted error responses (never leaking stack traces or secrets in production), and header sanitization in audit logs.
