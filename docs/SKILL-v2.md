# Universal Production-Grade Backend Engineering Skill & Readiness Audit Guide (`SKILL.md`)

This `SKILL.md` is a universal, stack-agnostic guideline, blueprint, and checklist for software engineers and AI Coding Agents (such as Claude, Gemini, GPT-4, Cursor, and custom agentic frameworks). It defines the exact architectural patterns, security controls, database optimizations, fault-tolerance mechanisms, and production-readiness criteria required to build, audit, refactor, or maintain any backend codebase regardless of programming language (Node.js, Go, Python, Java, Rust, C#, PHP) or framework.

---

## 1. System Architecture & Layered Separation of Concerns

A production-ready backend strictly enforces **Separation of Concerns** across clean architectural boundaries. Every repository must follow a layered architecture (or Clean Architecture / Hexagonal Architecture) to isolate transport mechanisms from domain logic and persistence.

```
[ HTTP Request ] ---> [ Controller / Handler Layer ]
                             | (Decodes HTTP, validates syntax, maps response)
                             v
                      [ Service / Domain Layer ]
                             | (Orchestrates business logic, DDD domain rules)
                             v
                      [ Repository / Data Layer ]
                             | (Constructs DB queries, maps entities)
                             v
                      [ Database / Storage ]
```

### 1.1 Architectural Layers & Responsibilities
*   **Presentation / Controller Layer (HTTP Interface)**:
    *   *Sole Responsibility*: Extract data from HTTP requests (headers, path params, query string, request body), bind payload to typed structs/schemas, run syntactic validation, pass typed domain DTOs to the Service layer, and map domain results/errors to explicit HTTP status codes and standardized JSON responses.
    *   *Rule*: Controllers MUST NOT contain business logic, direct SQL/NoSQL queries, ORM calls, or external HTTP requests.
*   **Business Logic / Service Layer (Core Domain Orchestration)**:
    *   *Sole Responsibility*: Pure business orchestration, domain model manipulation, domain validation (e.g., checking account balance before debit), and coordinating multiple repositories, background workers, or external services.
    *   *Rule*: Services MUST be completely decoupled from HTTP constructs (no request/response objects, no HTTP status code references, no cookie management). Service methods accept typed domain primitives or structs and return domain models or domain errors. This ensures 100% unit-testability without spinning up HTTP servers.
*   **Data Access / Repository Layer (Persistence Isolation)**:
    *   *Sole Responsibility*: Construct and execute database queries (SQL queries, ORM operations, key-value lookups), map raw database rows/documents into typed domain entities, and translate database-specific exceptions into domain storage errors.
    *   *Rule*: Repositories follow the Single Responsibility Principle—one repository method performs one atomic storage operation. Repositories MUST NOT invoke business logic or cross-repository orchestration.
*   **Middleware & Request Context Pipeline**:
    *   *Execution Sequence*: Inbound HTTP Request -> CORS -> Rate Limiting -> Body Parsing / Size Limit -> Security Headers -> Request ID Generation -> Logging & Tracing -> Authentication -> Authorization -> Route Handler -> Global Error Handling -> Response Compression.
    *   *Rule*: Share request-scoped metadata (e.g., `user_id`, `tenant_id`, `trace_id`, `roles`, `cancellation_signal`) via a thread-safe / execution-scoped **Request Context**. Never store request state in global variables or singleton service instances.

---

## 2. API Design, REST Semantics & OpenAPI 3.1 Contracts

### 2.1 RESTful Resource Conventions
*   **Resource Nouns**: Use plural nouns for path segments (`/api/v1/organizations`, `/api/v1/projects`). Never use verbs in path URLs (e.g., avoid `/api/v1/getOrganizations` or `/api/v1/createProject`).
*   **Hierarchical Paths**: Express parent-child ownership explicitly (`/api/v1/organizations/{org_id}/projects/{project_id}`). Limit nesting depth to a maximum of 2 levels to prevent unwieldy URLs; use query filters for deeper relationships.
*   **Custom RPC Actions**: When an action cannot be expressed via standard CRUD, append a clear verb with a POST method (`/api/v1/organizations/{org_id}/archive` or `/api/v1/invoices/{invoice_id}/pay`).

### 2.2 Standard HTTP Methods & Idempotency Matrix
| Method | Intent | Safe | Idempotent | Success Code | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | Read Resource | **Yes** | **Yes** | `200 OK` | Fetch single entity or paginated list |
| `POST` | Create / Action | No | No | `201 Created` / `200 OK` | Create entity or trigger RPC action |
| `PUT` | Full Replace | No | **Yes** | `200 OK` / `204 No Content` | Complete replacement of target resource |
| `PATCH` | Partial Update | No | **Yes** | `200 OK` | Modifying specific fields of an entity |
| `DELETE` | Remove Resource | No | **Yes** | `204 No Content` | Soft or hard deletion of an entity |

### 2.3 HTTP Status Code Mapping Taxonomy
*   `200 OK`: Successful read, update, or RPC action returning payload.
*   `201 Created`: Successful resource creation. MUST include the newly created entity in the response body (and optionally a `Location` header).
*   `204 No Content`: Successful request where no response body is returned (e.g., `DELETE` or `PUT`).
*   `400 Bad Request`: Syntactic or semantic client validation failure (invalid JSON, missing required fields).
*   `401 Unauthorized`: Missing or invalid authentication credentials (JWT expired, session cookie invalid).
*   `403 Forbidden`: Authenticated user lacks explicit permission/role to access the target resource.
*   `404 Not Found`: Specific entity ID does not exist. *Rule*: Paginated list endpoints with zero results MUST return `200 OK` with an empty array `[]`, NOT a `404`.
*   `409 Conflict`: Resource state conflict (e.g., duplicate unique constraint violation like email already exists).
*   `422 Unprocessable Entity`: Semantic validation failure where payload syntax is valid but violates domain rules.
*   `429 Too Many Requests`: Client exceeded rate limits. MUST include `Retry-After` header in seconds.
*   `500 Internal Server Error`: Unhandled server exception. Stack traces MUST be redacted in production.
*   `502 Bad Gateway` / `504 Gateway Timeout`: Upstream service or DB connection failure or execution timeout.

### 2.4 Pagination Protocols
*   **Offset/Limit Pagination**:
    *   *Query Params*: `?page=1&limit=20` or `?offset=0&limit=20`.
    *   *Use Case*: Static data sets with small total row counts (< 10,000) requiring explicit page jumping.
    *   *Performance Flaw*: As offset grows (`OFFSET 100000`), the DB must scan and discard 100,000 rows, leading to heavy I/O latency. Also susceptible to missed or duplicated items if rows are inserted/deleted during pagination.
*   **Cursor / Continuation Token Pagination**:
    *   *Query Params*: `?cursor=eyJpZCI6MTUwfQ==&limit=20`.
    *   *Use Case*: High-throughput, real-time, infinite-scroll lists, or large datasets.
    *   *Mechanism*: The cursor is an opaque, Base64-encoded representation of the primary ordering key(s) (e.g., `created_at` + `id`). The SQL query uses indexed range evaluation (`WHERE created_at < $1 AND id < $2 ORDER BY created_at DESC, id DESC LIMIT 21`).
*   **Standard Envelope Structure**:
    ```json
    {
      "data": [
        { "id": "018f3a2b-1000-7000-8000-000000000001", "name": "Project Alpha" }
      ],
      "pagination": {
        "limit": 20,
        "has_more": true,
        "next_cursor": "eyJjcmVhdGVkX2F0IjoxNzEwMDAwMDAwLCJpZCI6MTUwfQ=="
      }
    }
    ```

### 2.5 Contract-First OpenAPI 3.1 Enforcement
*   Maintain a single source of truth OpenAPI spec (`openapi.yaml`).
*   Integrate contract validation middleware that matches inbound request bodies and query parameters against the OpenAPI schema prior to controller execution.
*   Ensure default values are documented and applied for optional params (`sort_by="created_at"`, `order="desc"`).

---

## 3. Validation, Serialization & Input Sanitization

### 3.1 Validation Architecture
*   **Syntactic Validation (Controller Layer)**: Validate structural correctness immediately upon entry using schema libraries (Zod, Pydantic, Joi, Validator). Check data types, string lengths, regex patterns (email, UUIDv4/ULID, ISO-8601 dates), array bounds, and JSON structure.
*   **Semantic Validation (Service Layer)**: Validate domain rules that require state or business context (e.g., checking if `end_date > start_date`, verifying if item stock is greater than requested quantity).
*   **Fail-Fast Principle**: Terminate request processing at the earliest possible stage before executing expensive database queries or third-party API calls.

### 3.2 Data Transformation & Serialization
*   **Case Consistency**: Accept payload keys in standard camelCase or snake_case as defined by team standards, but enforce strict consistency across all endpoints.
*   **Input Normalization**: Trim whitespace from string fields, convert emails to lowercase, strip invalid control characters, and normalize dates to UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`).
*   **Protection Against Injection**:
    *   Never concatenate raw user strings into SQL queries. Always use parameterized queries / prepared statements.
    *   Sanitize string inputs meant for HTML display to prevent Cross-Site Scripting (XSS).
    *   Enforce request body size limits (`Content-Length` caps, e.g., max 1MB for JSON payloads) at the reverse proxy or body parser middleware to block Denial of Service (DoS) memory exhaustion.

---

## 4. Authentication, Authorization & Security Hardening

### 4.1 Authentication Strategies
*   **Stateful Sessions (Web Applications)**:
    *   Generate a cryptographically secure random session ID (128-bit min, e.g., `crypto.randomBytes(32)`).
    *   Store session state server-side in Redis or Postgres (recording `user_id`, `ip_address`, `user_agent`, `created_at`, `expires_at`).
    *   Transmit session ID via `HttpOnly`, `Secure`, `SameSite=Strict` (or `Lax`) HTTP cookies.
*   **Stateless JWTs (Distributed APIs / Mobile Backends)**:
    *   *Access Token*: Short-lived (5–15 minutes), signed via asymmetric algorithms (RS256/EdDSA) or HMAC-SHA256 (HS256). Passed in header: `Authorization: Bearer <token>`.
    *   *Refresh Token*: Longer-lived (1–7 days), stored securely (HttpOnly cookie or encrypted DB store). Enforce **Refresh Token Rotation**: every time a refresh token is used, invalidate it and issue a new pair. If a revoked refresh token is re-used, trigger security revocation for all tokens belonging to that user family.
    *   *JWT Payload Hygiene*: Store only essential identifiers (`sub`, `tenant_id`, `roles`, `iat`, `exp`). NEVER store sensitive values (passwords, secrets, PII) inside JWT payloads as they are base64-decoded publicly.
*   **Machine-to-Machine API Keys**:
    *   Format API keys with identifiable prefixes (`sk_live_...` or `pk_test_...`).
    *   Store API keys **hashed** in the database using SHA-256 (similar to passwords) so a DB compromise does not reveal raw keys.

### 4.2 Authorization & Access Control
*   **Role-Based Access Control (RBAC)**: Check high-level role memberships in routing middleware (`requireRole('admin')`).
*   **Attribute-Based / Permission Access Control (ABAC)**: Check granular permissions (`permissions: ['invoices:read', 'invoices:write']`).
*   **Broken Object-Level Authorization (BOLA / IDOR) Prevention**:
    *   *Mandatory Rule*: NEVER query an entity by `id` alone. ALWAYS scope persistence operations to the authenticated user or tenant ID:
        ```sql
        SELECT * FROM invoices 
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3;
        ```
    *   Return `404 Not Found` (or generic `403 Forbidden`) when accessing a non-owned resource to prevent attacker enumeration.
*   **Broken Function-Level Authorization (BFLA) Prevention**: Enforce administrative authorization checks explicitly on every admin route handler, independent of URL hiding or client-side UI toggles.
*   **Opaque Identifiers**: Use UUIDv4 or ULID (Universally Unique Lexicographically Sortable Identifier) for external IDs to prevent sequential ID enumeration attacks.

### 4.3 Security Defense Checklist
*   **Password Hashing**: Use memory-hard key derivation functions: Argon2id (preferred) or bcrypt with cost factor >= 12.
*   **Timing Attack Mitigation**: Use constant-time byte comparison (`crypto.timingSafeEqual`) for HMAC signature checks, secret key comparisons, and token validations.
*   **Authentication Error Redaction**: Return generic error messages ("Invalid email or password") for both invalid username and invalid password attempts to prevent account harvesting.
*   **Rate Limiting**: Apply sliding-window rate limiting via Redis (`ratelimit:ip:route`).
    *   Auth Endpoints (`/login`, `/reset-password`): Max 5 requests / minute.
    *   General APIs: Max 100–1000 requests / minute depending on tier.

---

## 5. Fault Tolerance, Error Handling & Graceful Shutdown

### 5.1 Global Exception Handling
*   Wrap the application in a centralized error middleware.
*   Differentiate between **Recoverable Errors** (network timeouts, rate limits -> trigger retries) and **Non-Recoverable Errors** (validation failures, database constraint violations -> fail gracefully).
*   Format error payloads strictly according to RFC 7807 (Problem Details for HTTP APIs) or a unified JSON schema:
    ```json
    {
      "error": {
        "code": "RESOURCE_NOT_FOUND",
        "message": "The requested invoice does not exist.",
        "details": [],
        "trace_id": "018f3a2b-9999-7000-8000-000000000099"
      }
    }
    ```
*   *Security Isolation*: In production (`NODE_ENV=production` or `ENV=prod`), NEVER expose internal stack traces, DB connection strings, table names, or raw driver exceptions in response payloads.

### 5.2 Resiliency Patterns
*   **Exponential Backoff with Jitter**: For outbound HTTP or remote service calls, retry transient failures using exponential backoff with randomized jitter to prevent the "thundering herd" problem:
    $$	ext{Sleep Time} = 2^{	ext{attempt}} 	imes 	ext{Base Delay} + 	ext{Random Jitter}$$
*   **Circuit Breakers**: Wrap external dependencies (payment gateways, third-party APIs) in a Circuit Breaker (e.g., Cockatiel, Resilience4j, Go-breaker).
    *   *Closed*: Normal operation.
    *   *Open*: When error threshold exceeds 50% over a 10s window, trip circuit to immediately return fallback errors without hitting downstream service.
    *   *Half-Open*: Periodically send canary requests to check if upstream service has recovered.

### 5.3 Graceful Shutdown Protocol
Upon receiving OS signals (`SIGTERM`, `SIGINT`):
1.  **Signal Trap**: Catch `SIGTERM` issued by Docker, Kubernetes, or OS.
2.  **Health Probe Update**: Instantly flag `/health/ready` probe as `530 Service Unavailable` so load balancers stop sending new inbound traffic.
3.  **Stop Accepting Requests**: Stop the HTTP server listener (`server.close()`).
4.  **In-Flight Request Drain**: Allow active HTTP requests to complete within a configurable shutdown timeout window (default: 30 seconds).
5.  **Shutdown Background Workers**: Stop queue consumers and background workers from picking up new jobs.
6.  **Close Backing Services in Reverse Order**: Close connections in reverse order of acquisition:
    1. HTTP Server
    2. Redis Pub/Sub & Queue Consumers
    3. Database Connection Pools
    4. HTTP Outbound Client Sessions
7.  **Exit**: Terminate process with code `0`.

---

## 6. Database Engineering, Optimization & Indexing

### 6.1 Schema Integrity & Migration Discipline
*   All DB schema modifications MUST be version-controlled using explicit SQL migration tools (Flyway, Liquibase, golang-migrate, Prisma, Knex). Never allow ORMs to auto-sync schemas in production (`synchronize: true` is strictly prohibited).
*   Enforce constraints at the database level: Foreign Keys, NOT NULL constraints, Unique Indexes, and Check Constraints.

### 6.2 Query Optimization & Indexing Strategy
*   **Index Selection Rules**:
    *   Index all Foreign Key columns used in `JOIN` clauses.
    *   Index columns frequently filtered in `WHERE` clauses or ordered in `ORDER BY`.
    *   Use **Composite Indexes** for multi-column queries (`WHERE tenant_id = $1 AND status = $2`), keeping high-cardinality columns first.
    *   Use **Covering Indexes** (`INCLUDE (column_name)`) to allow Index-Only Scans without reading table heaps.
*   **N+1 Query Elimination**: Strictly eliminate N+1 queries by using SQL `JOIN` clauses, eager loading (`INCLUDE`/`JOIN FETCH`), or batch dataloader utilities (e.g., DataLoader pattern).
*   **Execution Plan Analysis**: Always run `EXPLAIN ANALYZE` on queries taking > 50ms. Target sequential scans on large tables and convert them to Index Scans or Bitmap Index Scans.

### 6.3 Connection Pooling & Scaling
*   **Connection Pool Sizing**: Configure pool size based on DB hardware:
    $$	ext{Max Connections} = (	ext{CPU Cores} 	imes 2) + 	ext{Effective Spindle Count}$$
*   **Pooler Deployment**: Use dedicated connection proxies (e.g., PgBouncer) in transaction-pooling mode when using serverless computing or scaled microservices to prevent connection exhaustion.
*   **Read-Write Separation**: Direct write operations (`INSERT`, `UPDATE`, `DELETE`) to Primary DB instance. Route read operations (`SELECT`) to Read Replicas, handling potential replication lag gracefully.
*   **Sharding / Horizontal Partitioning**: Partition massive datasets (> 100M rows) by tenant or hash range across discrete physical tables or database nodes.

---

## 7. Caching Architecture, Invalidation & Topologies

### 7.1 Caching Patterns
*   **Cache-Aside (Lazy Loading)**:
    1. Application checks cache for key (`service:entity:id`).
    2. *Cache Hit*: Return cached data immediately.
    3. *Cache Miss*: Read from primary Database -> Write retrieved data to Cache with TTL -> Return data.
*   **Write-Through**: Application writes data to Database and Cache simultaneously in a single atomic transaction/operation.
*   **Write-Behind (Write-Back)**: Application writes to Cache instantly; background worker asynchronously flushes updates to Database in batches.

### 7.2 Invalidation & Stampede Protections
*   **Mandatory TTL**: Every cached item MUST have an explicit Time-To-Live (TTL) set.
*   **Event-Driven Invalidation**: Mutating API calls (`PUT`, `PATCH`, `DELETE`) MUST explicitly invalidate or update corresponding cache keys.
*   **Cache Stampede (Thundering Herd) Mitigation**: When a popular cache key expires, thousands of concurrent requests hit the DB simultaneously.
    *   *Solution*: Implement Mutex Locks (Singleflight in Go, Redis Distributed Lock) or Probabilistic Early Expiration (XFetch algorithm) so only one process recomputes the cache while others wait or receive stale data.
*   **Structured Key Namespacing**: Format keys deterministically: `<environment>:<service>:<entity>:<id>` (e.g., `prod:user_service:user:018f3a2b:profile`).
*   **Tiered Caching**: Use L1 In-Memory Local Cache (fastest, small size) backed by L2 Distributed Redis Cache (fast, shared across nodes).

---

## 8. Asynchronous Processing & Task Queues

### 8.1 Architecture & Separation
*   Offload non-blocking, heavy operations (email dispatch, video rendering, PDF generation, webhook notifications, data sync) from the synchronous HTTP request-response cycle to background Task Queues (BullMQ, Celery, RabbitMQ, Redis Streams, AWS SQS).

```
[ Client ] -> HTTP POST -> [ API Server ] -> Enqueue Job -> [ Queue Broker ]
                             | (Returns 202 Accepted)            |
                                                                 v
                                                        [ Worker Process ]
```

### 8.2 Task Design Principles
*   **Idempotency**: Tasks MUST be safe to re-execute multiple times without duplicating side effects. Use unique idempotency keys stored in DB/Redis within a database transaction.
*   **Payload Minimization**: Never pass massive binary blobs or complex objects inside queue messages. Pass lightweight reference IDs (`{ "job_type": "GENERATE_PDF", "invoice_id": "inv_12345" }`) and let the worker fetch fresh state from DB.
*   **Exponential Backoff & Retries**: Configure job retries with exponential backoff (e.g., 5 attempts).
*   **Dead-Letter Queue (DLQ)**: Tasks that fail after maximum retry attempts MUST be moved to a DLQ for manual inspection and alert notifications.
*   **Visibility Timeout**: Set visibility timeouts higher than maximum expected task execution duration to prevent duplicate processing by competing workers.

---

## 9. Object Storage & Large File Architecture

*   **Direct-to-Storage Uploads (Pre-Signed URLs)**:
    *   Server MUST NOT buffer large uploads in memory or local disk.
    *   Client requests upload permission -> Server generates a short-lived S3/GCS **Pre-Signed Upload URL** or **Pre-Signed POST Policy** with strict bounds -> Client uploads payload directly from browser/app to Object Storage.
*   **Policy Boundary Enforcement**: Restrict Pre-Signed POST policies with:
    *   `content-length-range` (e.g., min 1KB, max 50MB).
    *   Exact `Content-Type` restriction (e.g., `image/jpeg`, `application/pdf`).
*   **Metadata Separation**: Store file binary blobs in Object Storage; store file metadata (filename, file_size, mime_type, storage_key, uploaded_by) in the relational database.
*   **Structured Key Namespacing**: Use key prefixes: `tenants/{tenant_id}/users/{user_id}/{ulid}_{filename}`.
*   **Multipart Uploads**: Use S3 Multipart Upload API for files exceeding 100MB to enable parallel chunk uploads and cheap chunk retries.

---

## 10. Real-Time Systems, Webhooks & Event-Driven Architecture

### 10.1 Real-Time Protocol Selection Matrix
*   **WebSockets**: Full-duplex, bi-directional persistent connections. Ideal for interactive apps (collaborative editing, live gaming, chat). Must scale horizontally using a distributed Pub/Sub backplane (e.g., Redis Pub/Sub or NATS) to broadcast messages across multiple server instances.
*   **Server-Sent Events (SSE)**: Unidirectional server-to-client HTTP streaming (`text/event-stream`). Ideal for live dashboards, stock tickers, and AI text streaming. Built-in browser reconnection handling via `Last-Event-ID` header.
*   **Long Polling**: Fallback option where client polls with long timeouts. Use only when WS/SSE are unavailable.

### 10.2 Webhook Integration Standards
*   **Inbound Webhooks (Receiver)**:
    *   *HMAC Signature Verification*: Calculate expected HMAC-SHA256 signature from raw body bytes using shared secret; compare against request header (`X-Signature-256`) using constant-time comparison. Reject invalid signatures with `401 Unauthorized`.
    *   *Quick Ack Pattern*: Verify signature, enqueue raw body payload to background task queue, and immediately respond with `202 Accepted` / `200 OK` within < 2 seconds. Process business logic asynchronously.
    *   *Idempotency Handling*: Store provider's `delivery_id` in DB table with a UNIQUE constraint to discard duplicate retries.
*   **Outbound Webhooks (Sender)**:
    *   *Transactional Outbox Pattern*: Write outbound event payloads into a database `outbox` table in the *same local database transaction* as the entity mutation. A background worker polls or streams the `outbox` table and dispatches HTTP POST requests. This guarantees **At-Least-Once Delivery** without losing events if HTTP calls fail during primary mutations.
    *   *Signatures & Timestamps*: Sign outbound webhooks with HMAC-SHA256 and include an `X-Webhook-Timestamp` header to allow receivers to prevent replay attacks.

---

## 11. Full-Text Search Engines (Elasticsearch / Postgres FTS)

*   **Inverted Index Mechanics**: Use inverted indexes for unstructured text search. Convert text fields into normalized tokens using analyzers (lowercasing, stemming, stop-word removal).
*   **Relevance Scoring (BM25 / TF-IDF)**: Rank search results based on Term Frequency (TF) and Inverse Document Frequency (IDF). Apply **Field Boosting** (e.g., title match weight = 3x, description match weight = 1x).
*   **Search Features**: Implement Fuzzy Search (Levenshtein distance) for typo tolerance, Type-Ahead (Prefix queries), and Faceted Aggregations.
*   **Database vs. Search Engine Coexistence**:
    *   Relational DB remains the Primary Source of Truth.
    *   Sync changes to Elasticsearch asynchronously via DB CDC (Change Data Capture) or background queue tasks. Never execute synchronous external search indexing inside HTTP DB transactions.

---

## 12. Configuration Management & The 12-Factor App

*   **Factor 1: Codebase**: One repository tracked in revision control, many deploys.
*   **Factor 2: Dependencies**: Explicitly declare and isolate dependencies using exact lockfiles (`package-lock.json`, `go.sum`, `Cargo.lock`, `poetry.lock`).
*   **Factor 3: Config**: Store all environment-specific configs and secrets in **Environment Variables**. NEVER commit credentials, private keys, or `.env` files to source control. Validate startup config against strict schemas (e.g., Envalid, Zod).
*   **Factor 4: Backing Services**: Treat databases, queues, caches, and SMTP servers as attached resources reachable via URL handles.
*   **Factor 5: Build, Release, Run**: Strictly separate build (compiling code + assets), release (combining build + environment config), and run (executing process) stages.
*   **Factor 6: Processes**: Execute app as stateless, share-nothing processes. Persist state in attached backing services.
*   **Factor 7: Port Binding**: Export services via explicit port binding (e.g., listening on `0.0.0.0:8080`).
*   **Factor 8: Concurrency**: Scale out horizontally via the process model (adding web containers or worker nodes).
*   **Factor 9: Disposability**: Fast startup (< 5s) and graceful shutdown (`SIGTERM`).
*   **Factor 10: Dev/Prod Parity**: Keep development, staging, and production environments as identical as possible (use containers for DBs/caches locally).
*   **Factor 11: Logs**: Treat logs as unbuffered event streams emitted to `stdout`/`stderr`.
*   **Factor 12: Admin Processes**: Run database migrations and one-off administrative tasks as ephemeral tasks in identical environments.

---

## 13. Logging, Monitoring & Observability

### 13.1 The Three Pillars of Observability
1.  **Structured JSON Logging**: Emit unbuffered JSON logs to `stdout`.
    *   *Mandatory Attributes*: `timestamp` (ISO-8601), `level` (`debug`, `info`, `warn`, `error`, `fatal`), `message`, `trace_id`, `span_id`, `user_id`, `method`, `path`, `status_code`, `latency_ms`.
    *   *Log Redaction*: Automatically scrub sensitive fields (`password`, `token`, `card_number`, `ssn`) prior to emission.
2.  **Metrics (Prometheus Format)**:
    *   *RED Method (APIs)*: Rate (requests/sec), Errors (failed requests/sec), Duration (latency histograms: p50, p95, p99).
    *   *USE Method (Infrastructure)*: Utilization (% busy), Saturation (queue depth), Errors.
3.  **Distributed Tracing (OpenTelemetry)**:
    *   Propagate standard W3C Trace Context headers (`traceparent`) across HTTP boundaries.
    *   Instrument HTTP handlers, service calls, DB queries, Redis operations, and outbound HTTP clients to visualize full execution lifecycles in Jaeger/Zipkin/Grafana Tempo.

### 13.2 Health Check Endpoints
*   `/health/live` (Liveness Probe): Returns `200 OK` if HTTP server process is responsive.
*   `/health/ready` (Readiness Probe): Returns `200 OK` ONLY if active ping checks to critical backing services (Postgres connection pool, Redis ping) succeed. Returns `530 Service Unavailable` if backing services are unreachable.

---

## 14. Testing Strategy & Code Quality Assurance

### 14.1 The Testing Pyramid
*   **Unit Tests (70%)**: Test isolated business logic in service domain models using fast in-memory mocks/stubs for external dependencies. Executed in milliseconds.
*   **Integration Tests (20%)**: Test HTTP controllers, SQL repositories, and queue consumers against real, ephemeral containerized dependencies using **Testcontainers** (spinning up real Postgres and Redis instances in Docker). Avoid in-memory fakes (like H2 or fake DBs) as they miss real DB constraint bugs and SQL syntax incompatibilities.
*   **End-to-End (E2E) Tests (10%)**: Test end-to-end user journeys across deployed staging environments.

### 14.2 Code Quality & Coverage Standards
*   Maintain > 80% line coverage on Service domain business logic.
*   Enforce static analysis, linter checks (ESLint, golangci-lint, Flake8/Ruff), and formatting rules in pre-commit hooks and CI pipelines.
*   Enforce Cyclomatic Complexity limits (< 10 per function) to ensure code maintainability.

---

## 15. DevOps, Containerization & CI/CD Pipelines

### 15.1 Production Multi-Stage Dockerfile Blueprint
```dockerfile
# Stage 1: Build Environment
FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/server ./cmd/server

# Stage 2: Minimal Ephemeral Runtime
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=builder /app/server /server
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]
```
*   *Dockerfile Best Practices*:
    1. Multi-stage builds to produce tiny runtime footprints (< 30MB).
    2. Run as a non-root user (`USER nonroot` / `USER node`).
    3. Pin base image tags to exact immutable SHAs or versions.
    4. Include `.dockerignore` to exclude node_modules, `.git`, `.env`, and local build artifacts.

### 15.2 CI/CD Pipeline Automation Guardrails
Every Pull Request MUST automatically execute:
1.  **Code Linting & Formatting Verification**.
2.  **Static Application Security Testing (SAST)** & Vulnerability Scans (Trivy, Snyk, Dependency-Check).
3.  **Unit & Integration Test Suites**.
4.  **OpenAPI Spec Breaking Change Check**.
5.  **Build Immutable Container Image** tagged with Git Commit SHA.
6.  **Zero-Downtime Deployment**: Execute Rolling Updates, Canary Deployments, or Blue/Green Deployments with automated rollback on elevated HTTP 5xx rates.

---

## 16. AI Agent Production-Readiness Repository Audit Protocol

When assigned to audit, refactor, or build a repository for production readiness, an AI Coding Agent MUST systematically evaluate the codebase against this 20-point checklist and output a structured compliance gap report:

### 20-Point Operational Readiness Audit Matrix

- [ ] **1. Architecture Layering**: Strict separation between Presentation (Controllers), Business (Services), and Persistence (Repositories). No raw SQL/ORM calls in controllers.
- [ ] **2. REST & Routing**: Plural resource URLs, correct HTTP verbs, semantic status codes (`200`, `201`, `204`, `400`, `401`, `403`, `404`, `422`, `429`, `500`).
- [ ] **3. OpenAPI Contract**: Valid `openapi.yaml` or auto-generated spec matching code handlers.
- [ ] **4. Input Validation**: Syntactic request body/param validation schema on all endpoints before service layer execution.
- [ ] **5. BOLA/IDOR Protection**: All persistence read/update/delete queries strictly scoped by `tenant_id` and/or `user_id`.
- [ ] **6. Authentication Security**: Stateful session cookie security (`HttpOnly`, `Secure`, `SameSite`) OR stateless JWT access (5-15m) + refresh token rotation.
- [ ] **7. Password & Cryptographic Hygiene**: Passwords hashed with Argon2id or bcrypt (cost >= 12). Token/HMAC comparisons use constant-time functions.
- [ ] **8. Global Error Middleware**: Unified error response JSON schema; zero stack traces or internal DB info leaked in production.
- [ ] **9. Graceful Shutdown**: OS signal handlers (`SIGTERM`/`SIGINT`) close HTTP listener, drain connections, and close DB pools in reverse order within timeout limits.
- [ ] **10. Database Migrations**: Version-controlled SQL migration scripts present. Zero auto-synchronize in production.
- [ ] **11. Database Indexing & N+1**: Foreign keys indexed. Eager loading / Dataloaders used to prevent N+1 query loops.
- [ ] **12. Connection Pooling**: DB connection pool sizes explicitly configured with proxies (PgBouncer) for high scale.
- [ ] **13. Caching & Invalidation**: Redis caching uses structured key namespaces (`env:service:entity:id`), explicit TTLs, and cache stampede mitigations.
- [ ] **14. Asynchronous Queues**: Heavy jobs offloaded to background task queues with exponential backoff retries, DLQ, and idempotent consumers.
- [ ] **15. Object Storage Direct Uploads**: Uploads use Pre-Signed URLs/Policies with strict `content-length-range` bounds.
- [ ] **16. Webhook Security**: Inbound webhooks verify HMAC signatures and use `delivery_id` de-duplication. Outbound webhooks use Transactional Outbox pattern.
- [ ] **17. 12-Factor Compliance**: Configs/secrets loaded strictly from Environment Variables. Lockfiles committed.
- [ ] **18. Observability**: Structured JSON logging to `stdout`, RED metrics exported, OpenTelemetry tracing initialized, `/health/live` and `/health/ready` endpoints present.
- [ ] **19. Testing Infrastructure**: Unit tests cover core domain logic; integration tests use Testcontainers against real Postgres/Redis instances.
- [ ] **20. Containerization & CI/CD**: Multi-stage, non-root Dockerfile present; CI pipeline automates linting, testing, vulnerability scanning, and Docker builds on PRs.
