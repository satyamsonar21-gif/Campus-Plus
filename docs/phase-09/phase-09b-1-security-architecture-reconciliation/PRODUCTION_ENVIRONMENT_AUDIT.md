# 06 — Production Environment & Database Connection Safety Audit

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Subsystem:** Environment Configuration, Runtime Validation & Database Connection Safety  
**Audit Date:** 2026-10-20  
**Classification:** PRODUCTION INFRASTRUCTURE AUDIT  

---

## 1. Executive Summary

This audit assesses the runtime connection safety and environment variable validation mechanisms in Campus Plus.

Prior to Phase 09B-1:
1. `src/infrastructure/database/pool.ts` contained a critical vulnerability: if `DATABASE_URL` was omitted or unconfigured, the application silently fell back to an in-memory embedded PGlite instance. In a cloud environment like Vercel, this created the severe risk that production would write complaints into an ephemeral container filesystem that vanished upon container recycle.
2. `src/config/env.ts` permitted hardcoded insecure default secrets (`dev_insecure_app_secret_at_least_16_chars` and `dev_cron_secret_min_8_chars`), lacked production `DATABASE_URL` validation, and defaulted attachment size to 10 MB instead of the required 5 MB institutional limit.

During Phase 09B-1, both vulnerabilities were resolved in code, verified with automated tests, and validated across local production builds.

---

## 2. Database Connection Safety Remediation (`src/infrastructure/database/pool.ts`)

### A. The Defect: Silent Ephemeral Fallback
- **Mechanism:** In `getDatabaseClient()`, the code checked `if (dbUrl) { ... }`. If `dbUrl` was undefined, execution fell through to `// 2. Embedded PGlite Mode`, creating `new PGlite()` and executing migrations and seeds in memory.
- **Root Cause:** PGlite was integrated for offline unit testing, but the initialization logic failed to differentiate between test/dev runtimes and production runtimes (`process.env.NODE_ENV === "production"`).
- **Production Impact:** A deployed Vercel application missing `DATABASE_URL` would appear to function normally in demo walkthroughs, returning HTTP 200/201 responses while persisting records to volatile container memory.

### B. The Code Fix: Mandatory Fail-Fast Enforcement
In `src/infrastructure/database/pool.ts`:
```typescript
export async function getDatabaseClient(): Promise<DatabaseQueryInterface> {
  const dbUrl = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === "production";

  // 1. Mandatory Production Database Configuration (Fail-Fast Section 10)
  if (isProduction && (!dbUrl || dbUrl.trim() === "")) {
    throw new Error(
      "CRITICAL DATABASE CONFIGURATION ERROR: DATABASE_URL environment variable is mandatory in production mode. Silent fallback to embedded PGlite is strictly forbidden."
    );
  }

  // 2. Live PostgreSQL Mode (Supabase / Production / Staging)
  if (dbUrl) {
    ...
  }

  // 3. Embedded PGlite Mode (Strictly restricted to local development & test environments)
  if (isProduction) {
    throw new Error(
      "CRITICAL SECURITY VIOLATION: Embedded PGlite cannot be initialized in production runtime."
    );
  }
  ...
}
```

### C. Test Verification
Verified via `tests/database/connection-safety.test.ts`:
- `fails fast with an explicit error in production when DATABASE_URL is missing`: **PASS**
- `strictly prohibits initializing embedded PGlite fallback in production runtime`: **PASS**
- `permits embedded PGlite in test and development environments`: **PASS**

---

## 3. Environment Security Hardening (`src/config/env.ts`)

### A. Secret Validation Hardening
- **`APP_SECRET`**:
  - In production (`NODE_ENV === "production"` and `NEXT_PUBLIC_APP_ENV === "production"`), the default insecure string `dev_insecure_app_secret_at_least_16_chars` is strictly forbidden.
  - Must be explicitly configured via environment.
  - Minimum length enforced: **32 characters** (for cryptographically secure AES-256 / HMAC operations).
- **`CRON_SECRET`**:
  - In production, the default `dev_cron_secret_min_8_chars` is strictly forbidden.
  - Minimum length enforced: **16 characters**.
- **`STORAGE_MAX_FILE_SIZE_BYTES`**:
  - Corrected default value from `10485760` (10 MB) to **`5242880` (5 MB)**, matching product requirements (FR-004) and `SupabaseStorageAdapter`.
- **`DATABASE_URL`**:
  - Added to `serverSchema` with mandatory presence validation in production.
- **Sanitized Error Reporting**:
  - Zod validation issues report descriptive error messages without printing actual secret values in logs or exception traces.

### B. Test Verification
Verified via `tests/unit/env-security.test.ts`:
- 10/10 tests passed covering production validation, secret strength rejection, sanitized errors, and development backward compatibility.

---

## 4. Phase 09B-2 Vercel Environment Configuration Checklist

The following environment variables must be configured in the Vercel Dashboard (`Project Settings -> Environment Variables`) prior to Phase 09B-2 production deployment:

| Variable Name | Environment Scope | Required Value / Format | Security Classification | Notes |
| :--- | :---: | :--- | :---: | :--- |
| `NODE_ENV` | Production, Preview | `production` | Public | Node.js production runtime flag. |
| `NEXT_PUBLIC_APP_ENV` | Production | `production` | Public | Enforces strict secret validation in `env.ts`. |
| `NEXT_PUBLIC_APP_URL` | Production | `https://campus-plus.vercel.app` | Public | Canonical web application origin. |
| `NEXT_PUBLIC_SUPABASE_URL` | All | `https://gtwpxjpmwltxwjryazcu.supabase.co` | Public | Supabase API gateway URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | `eyJhbGciOi...` (from Supabase Dashboard) | Public | Publishable client anon key. |
| `DATABASE_URL` | Production | `postgresql://postgres.gtwpxjpmwltxwjryazcu:[PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres` | **SECRET** | **CRITICAL:** Use Supavisor transaction pooler URL (Port 6543) for serverless compatibility. |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | `eyJhbGciOi...` (from Supabase Dashboard) | **SECRET** | Administrative service role key (server-only). |
| `SUPABASE_JWT_SECRET` | Production | `[JWT Secret from API Settings]` | **SECRET** | For direct JWT signature verification. |
| `APP_SECRET` | Production | Cryptographic random string (min 32 chars) | **SECRET** | Generate with `openssl rand -base64 32`. |
| `CRON_SECRET` | Production | Cryptographic random string (min 16 chars) | **SECRET** | Bearer token for scheduled SLA monitoring. |
| `STORAGE_BUCKET_ATTACHMENTS`| All | `campus-plus-attachments` | Public | Target attachment bucket. |
| `STORAGE_MAX_FILE_SIZE_BYTES`| All | `5242880` | Public | 5 MB file size limit. |
