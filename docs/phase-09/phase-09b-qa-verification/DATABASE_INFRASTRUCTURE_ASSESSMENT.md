# Phase 09B — Database & Infrastructure Resilience Assessment

**Classification:** Database Reliability Engineering (DRE) & Infrastructure Security  
**Target:** PostgreSQL 17 (Supabase) & Node.js Serverless Pool Architecture  
**Component:** `src/infrastructure/database/`, `src/infrastructure/container.ts`, `src/config/env.ts`  

---

## 1. Architectural Integrity Review

### 1.1 Strict Production Fail-Fast Verification
Campus Plus enforces an explicit fail-fast policy in `src/infrastructure/database/pool.ts`:
```typescript
// 1. Mandatory Production Database Configuration (Fail-Fast Section 10)
if (isProduction && (!dbUrl || dbUrl.trim() === "")) {
  throw new Error(
    "CRITICAL DATABASE CONFIGURATION ERROR: DATABASE_URL environment variable is mandatory in production mode. Silent fallback to embedded PGlite is strictly forbidden."
  );
}

// 2. Embedded PGlite Mode (Local Dev & Unit/Offline Testing)
if (isProduction) {
  throw new Error(
    "CRITICAL SECURITY VIOLATION: Embedded PGlite cannot be initialized in production runtime."
  );
}
```
**Verification Finding:**
- **Zero Silent Fallback:** In production mode (`NODE_ENV === "production"`), the application will *never* instantiate an in-memory PGlite database or silently discard writes.
- **Automated Verification:** Verified via `tests/database/connection-safety.test.ts` (3/3 unit tests strictly confirming fail-fast behavior).

---

## 2. Supabase Connection Modes & Pooler Compatibility

### 2.1 Connection String Topology
Supabase provides two primary PostgreSQL connection interfaces:

| Parameter | Direct Connection | Transaction Pooler (Recommended) | Session Pooler |
| :--- | :--- | :--- | :--- |
| **Port** | `5432` | `6543` | `5432` |
| **Hostname** | `db.<ref>.supabase.co` | `aws-0-<region>.pooler.supabase.com` | `aws-0-<region>.pooler.supabase.com` |
| **Protocol** | Direct TCP | PgBouncer Transaction Mode | PgBouncer Session Mode |
| **IP Addressing** | **IPv6 Only** | **IPv4 Compatible** | **IPv4 Compatible** |
| **Serverless Fit** | ❌ Fails on Vercel AWS nodes | ✅ Optimized for Serverless | ⚠️ Limited Connection Capacity |

### 2.2 Production Configuration Defect
In `.env.local` and early staging templates:
`DATABASE_URL="postgresql://postgres:[password]@db.rdcuizmrirnhuusncnnn.supabase.co:5432/postgres"`
- **Vulnerability:** Direct connection to `db.<ref>.supabase.co:5432` fails in AWS Lambda serverless execution environments due to lack of outbound IPv6 routing.
- **Mandatory Remediation:** Production Vercel environments must strictly use:
  `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true`

---

## 3. Connection Pool Tuning for Serverless Lambdas

### 3.1 Current Code Parameters (`src/infrastructure/database/pool.ts`)
```typescript
liveDbPool = new PgPool({
  connectionString: dbUrl,
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 2000,
});
```

### 3.2 Reliability Defects & Recommended Values
1. **`connectionTimeoutMillis`:**
   - *Current:* `2000` (2s)
   - *Defect:* During a serverless cold-start across regions, TLS handshake + DNS lookup often takes 2.2s–3.5s, triggering spurious connection failures.
   - *Target:* `10000` (10s) with exponential backoff on retries.
2. **`max` (Pool Size per Lambda):**
   - *Current:* Unspecified (defaults to `10` per serverless instance).
   - *Defect:* If 20 concurrent Vercel serverless functions spin up, they attempt to open 200 simultaneous database connections, risking pooler saturation.
   - *Target:* Explicitly set `max: 1` or `max: 2` per serverless instance. PgBouncer on port 6543 handles multiplexing.
3. **`idleTimeoutMillis`:**
   - *Target:* `15000` (15s) to allow idle connections to close promptly when a serverless container freezes.

---

## 4. Environment Variable Security & Validation (`src/config/env.ts`)

### 4.1 Production Invariants
`src/config/env.ts` implements Zod validation with environment refinement:
- **`APP_SECRET`:** Required to be ≥32 characters in production. Insecure default `"dev_insecure_app_secret_at_least_16_chars"` is strictly rejected in production.
- **`CRON_SECRET`:** Required to be ≥16 characters in production. Insecure default `"dev_cron_secret_min_8_chars"` is strictly rejected in production.
- **`STORAGE_MAX_FILE_SIZE_BYTES`:** Strictly enforced at `5242880` (5MB).
- **Client Bundling Safeguard:** Uses a JavaScript Proxy on the client to throw runtime errors if server-only keys (such as `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`) are accessed by client-side code.

### 4.2 Identified Refinement Flaw
Line 20 of `src/config/env.ts`:
```typescript
const isStrictProduction = data.NODE_ENV === "production" && data.NEXT_PUBLIC_APP_ENV === "production";
```
- **Vulnerability:** If Vercel sets `NODE_ENV="production"` but the developer forgets to configure `NEXT_PUBLIC_APP_ENV="production"`, `isStrictProduction` defaults to `false`. As a consequence, `env.ts` permits the insecure development defaults for `APP_SECRET` and does not reject missing `DATABASE_URL` during bootstrap.
- **Remediation:** Refine the condition so that `data.NODE_ENV === "production"` alone triggers mandatory production security rules.

---

## 5. Migration Pipeline & Schema Drift Reconciliation

### 5.1 Existing Migration Inventory
The repository contains 10 declarative SQL migration files in `migrations/`:
1. `00001_initial_types_and_extensions.sql` (UUID, Citext, Enums)
2. `00002_core_institutional_tables.sql` (Departments, Locations, Categories)
3. `00003_identity_and_access_tables.sql` (Users, User Roles, Department Memberships)
4. `00004_complaint_aggregate_tables.sql` (Complaints Aggregate, SLA Tracking)
5. `00005_supporting_workflow_tables.sql` (Attachments, Action History, Internal Notes)
6. `00006_audit_and_outbox_tables.sql` (Audit Ledger, Outbox Events)
7. `00007_indexes_and_performance.sql` (Performance B-Tree & Partial Indexes)
8. `00008_row_level_security_policies.sql` (RLS Policies on Core Tables)
9. `00009_analytical_views.sql` (Institutional Intelligence Views)
10. `00010_tracking_code_sequence.sql` (Atomic Tracking Code Generator Sequence)

### 5.2 Verification Evidence
- Verified via `tests/database/migration.test.ts`: All 10 migrations apply cleanly in sequential order onto a fresh database with 100% checksum verification on subsequent idempotent runs.
- **Crucial Rule:** In production, migrations must never be blindly re-executed or tables dropped. Schema updates must use additive, idempotent reconciliation scripts (e.g. `scripts/phase_09b_remediation.sql`).
