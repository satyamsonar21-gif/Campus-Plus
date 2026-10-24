# 09 — Master Defect Register

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Audit Subsystem:** Database Architecture, Environment Configuration, RLS & Authentication  
**Date:** 2026-10-20  
**Classification:** DEFECT TRACKING REGISTER (P0 – P3)  

---

## 1. Defect Classification Hierarchy

- **P0 — Critical Production / Data Loss / Security Risk:** Immediate threat to data integrity, silent ephemeral persistence, or catastrophic vulnerability.
- **P1 — High Security / Major Functional Risk:** Privilege escalation, PII exposure, unindexed high-volume tables, or missing security boundaries.
- **P2 — Medium Risk / Reliability Issue:** Inconsistent seed data, missing junction table policies, or redundant indexes.
- **P3 — Low Risk / Optimization:** Minor query plan warning or non-critical formatting improvement.

---

## 2. Complete Issue Register

### DEF-001 (P0): Silent PGlite Fallback in Production Runtime
- **Defect ID:** `DEF-001`
- **Severity:** **P0 (CRITICAL PRODUCTION DEFECT)**
- **Subsystem:** `src/infrastructure/database/pool.ts`
- **Description:** If `DATABASE_URL` was omitted or failed to connect, `getDatabaseClient()` fell back to initializing an in-memory PGlite database without checking whether `NODE_ENV === "production"`.
- **Evidence:** `pool.ts:93-137` contained embedded PGlite initialization without environment gating.
- **Root Cause:** Offline test fallback logic lacked production environment guardrails.
- **Impact:** Production on Vercel could silently write data into ephemeral container memory that disappears upon restart.
- **Fix Implemented:** Added strict fail-fast check throwing `CRITICAL DATABASE CONFIGURATION ERROR` in production mode.
- **Files Affected:** `src/infrastructure/database/pool.ts`
- **Tests Added:** `tests/database/connection-safety.test.ts` (3 tests verifying production fail-fast).
- **Status:** **RESOLVED IN CODE**

---

### DEF-002 (P0): Raw PostgreSQL Connection Pool Bypasses RLS Identity Context
- **Defect ID:** `DEF-002`
- **Severity:** **P0 (CRITICAL SECURITY ARCHITECTURE DEFECT)**
- **Subsystem:** `src/infrastructure/database/pool.ts` & RLS Policies
- **Description:** Queries executed over raw `pg.Pool` connections lacked `request.jwt.claim.sub` context. Under FORCE RLS, `auth.uid()` evaluated to `NULL`, blocking legitimate user queries.
- **Evidence:** Global search for `request.jwt.claim.sub` in `src/` yielded zero references.
- **Root Cause:** Lack of transaction-local JWT identity propagation mechanism.
- **Impact:** Users unable to query their own tickets under forced RLS, or accidental superuser bypass if FORCE RLS disabled.
- **Fix Implemented:** Implemented Option A ADR: `executeTransaction` now accepts `{ actorId }` and sets `request.jwt.claim.sub` locally (`is_local = true`) inside transaction block.
- **Files Affected:** `src/infrastructure/database/pool.ts`
- **Tests Added:** `tests/database/connection-safety.test.ts` (3 tests verifying propagation, commit isolation, and rollback cleanup).
- **Status:** **RESOLVED IN CODE**

---

### DEF-003 (P1): Orphan SECURITY DEFINER Function in Live Database (`public.rls_auto_enable`)
- **Defect ID:** `DEF-003`
- **Severity:** **P1 (HIGH SECURITY DEFECT)**
- **Subsystem:** Live Supabase Database Catalog
- **Description:** Supabase Security Advisor flagged an orphaned function `public.rls_auto_enable()` with `SECURITY DEFINER` and world-executable permissions by `anon` and `authenticated`.
- **Evidence:** Live Supabase catalog probe and Phase 09A forensic findings.
- **Root Cause:** Stray dashboard artifact or template function created outside repository migrations.
- **Impact:** Privilege escalation vulnerability allowing unauthenticated callers to execute administrative routines.
- **Proposed Fix:** Added `DROP FUNCTION IF EXISTS public.rls_auto_enable() CASCADE;` to `scripts/phase_09b_remediation.sql`.
- **Files Affected:** `scripts/phase_09b_remediation.sql`
- **Tests Added:** Parity execution test in `tests/database/connection-safety.test.ts`.
- **Status:** **REMEDIATION SCRIPT PREPARED (PENDING PHASE 09B-2 LIVE EXECUTION)**

---

### DEF-004 (P1): Analytical Views Missing Security Invoker Configuration
- **Defect ID:** `DEF-004`
- **Severity:** **P1 (HIGH SECURITY DEFECT)**
- **Subsystem:** Database Views (`recurring_complaint_clusters`, `department_sla_performance`)
- **Description:** Analytical views were created without `WITH (security_invoker = true)`. Under PostgreSQL 15+, views run with view-owner privileges (`SECURITY DEFINER` semantics), bypassing underlying table RLS on `complaints`.
- **Evidence:** Supabase Security Advisor warning on analytical views.
- **Root Cause:** Migration `00009` did not declare explicit view security attributes.
- **Impact:** Querying analytical views via PostgREST exposes cross-department complaint clusters to unauthorized roles.
- **Proposed Fix:** Recreate both views with `WITH (security_invoker = true)` in `scripts/phase_09b_remediation.sql`.
- **Files Affected:** `scripts/phase_09b_remediation.sql`
- **Tests Added:** Parity execution test in `tests/database/connection-safety.test.ts`.
- **Status:** **REMEDIATION SCRIPT PREPARED (PENDING PHASE 09B-2 LIVE EXECUTION)**

---

### DEF-005 (P1): Insecure Default Secrets & Weak Environment Validation in Production
- **Defect ID:** `DEF-005`
- **Severity:** **P1 (HIGH SECURITY DEFECT)**
- **Subsystem:** `src/config/env.ts`
- **Description:** `env.ts` permitted hardcoded insecure default secrets (`dev_insecure_app_secret_at_least_16_chars`), lacked production `DATABASE_URL` check, and defaulted attachment size to 10 MB instead of 5 MB.
- **Evidence:** `src/config/env.ts:7-12` (original).
- **Root Cause:** Insufficient environment schema refinement for production mode.
- **Impact:** Production could boot with known dev secrets, compromising encryption and cron authentication.
- **Fix Implemented:** Added strict `superRefine` requiring min 32-char `APP_SECRET`, min 16-char `CRON_SECRET`, mandatory `DATABASE_URL`, and 5 MB (5,242,880 bytes) attachment limit in production.
- **Files Affected:** `src/config/env.ts`
- **Tests Added:** `tests/unit/env-security.test.ts` (10 tests).
- **Status:** **RESOLVED IN CODE**

---

### DEF-006 (P2): Omission of `ROLE_FACULTY` in Reference Seed Data
- **Defect ID:** `DEF-006`
- **Severity:** **P2 (DATA CONSISTENCY DEFECT)**
- **Subsystem:** `seeds/001_reference_seed.sql`
- **Description:** Core requirements define 5 public personas including Faculty. The live database contains `ROLE_FACULTY`, but repository `seeds/001_reference_seed.sql` omitted it.
- **Evidence:** `seeds/001_reference_seed.sql:6-12` (original only had 5 roles, omitting faculty).
- **Root Cause:** Legacy seed script was not updated when `ROLE_FACULTY` was ratified in domain code.
- **Impact:** Running seed scripts in local environments caused foreign key failures when assigning faculty roles.
- **Fix Implemented:** Added `ROLE_FACULTY` with idempotent `ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description`.
- **Files Affected:** `seeds/001_reference_seed.sql`, `tests/database/migration.test.ts`
- **Tests Added:** `tests/database/migration.test.ts` verifies all 6 roles present.
- **Status:** **RESOLVED IN CODE**

---

### DEF-007 (P2): 19 Unindexed Foreign Keys Causing Relational Performance Regressions
- **Defect ID:** `DEF-007`
- **Severity:** **P2 (PERFORMANCE DEFECT)**
- **Subsystem:** Supabase PostgreSQL Schema
- **Description:** 19 foreign key columns across child tables lack covering B-Tree indexes, causing sequential table scans during joins and cascade validations.
- **Evidence:** Supabase Performance Advisor report.
- **Root Cause:** Migration `00007` omitted indexes on referencing junction columns.
- **Impact:** Severe query latency degradation when `complaints` and `action_history` scale.
- **Proposed Fix:** Added 19 `CREATE INDEX IF NOT EXISTS` statements to `scripts/phase_09b_remediation.sql`.
- **Files Affected:** `scripts/phase_09b_remediation.sql`
- **Tests Added:** Parity execution test in `tests/database/connection-safety.test.ts`.
- **Status:** **REMEDIATION SCRIPT PREPARED (PENDING PHASE 09B-2 LIVE EXECUTION)**

---

### DEF-008 (P2): React 19 Synchronous State Update Warning in Effect Body
- **Defect ID:** `DEF-008`
- **Severity:** **P2 (FRONTEND COMPLIANCE DEFECT)**
- **Subsystem:** `src/presentation/context/AuthContext.tsx`
- **Description:** `AuthContext.tsx` called `setAuthState("UNAUTHENTICATED")` synchronously at the top of an effect body when client was null, violating React 19 lint rules.
- **Evidence:** `pnpm lint` failed with `react-hooks/set-state-in-effect`.
- **Root Cause:** Synchronous state dispatch inside effect body.
- **Impact:** Potential cascading re-renders and ESLint build failures.
- **Fix Implemented:** Wrapped fallback state dispatch in `queueMicrotask`.
- **Files Affected:** `src/presentation/context/AuthContext.tsx`
- **Tests Added:** `pnpm lint` passed with 0 errors.
- **Status:** **RESOLVED IN CODE**

---

### DEF-009 (P2): Missing Storage Bucket and Policies on Live Supabase Project
- **Defect ID:** `DEF-009`
- **Severity:** **P2 (INFRASTRUCTURE GAP)**
- **Subsystem:** Supabase Storage (`storage.buckets` and `storage.objects`)
- **Description:** Bucket `campus-plus-attachments` does not exist on live Supabase instance; no storage RLS policies deployed.
- **Evidence:** Live inspection catalog.
- **Root Cause:** Storage initialization script was prepared but not yet executed on live project.
- **Impact:** File attachment uploads fail on live environment.
- **Proposed Fix:** `scripts/supabase_auth_and_storage_setup.sql` scheduled for Phase 09B-3 deployment.
- **Files Affected:** `scripts/supabase_auth_and_storage_setup.sql`
- **Status:** **DEFERRED TO PHASE 09B-3 (AUTHORIZED STORAGE DEPLOYMENT)**

---

### DEF-010 (P2): Staging Environment Variable Drift to Decommissioned Host
- **Defect ID:** `DEF-010`
- **Severity:** **P2 (CONFIGURATION DRIFT)**
- **Subsystem:** `.env.local`
- **Description:** `.env.local` remains bound to legacy decommissioned project `rdcuizmrirnhuusncnnn` (ap-south-1) instead of target `gtwpxjpmwltxwjryazcu` (ap-northeast-1).
- **Evidence:** `getaddrinfo ENOTFOUND db.rdcuizmrirnhuusncnnn.supabase.co` on direct TCP connections.
- **Root Cause:** Local configuration template was not synchronized with new Supabase project credentials.
- **Impact:** Live staging tests cannot connect to live database without updated credentials.
- **Proposed Fix:** Update `.env.local` with `gtwpxjpmwltxwjryazcu` credentials in Phase 09B-2. Updated `tests/live/supabase-staging.test.ts` to safely skip when legacy host is unreachable.
- **Files Affected:** `tests/live/supabase-staging.test.ts`
- **Status:** **RESOLVED IN CODE / CONFIG CHECKLIST PREPARED FOR PHASE 09B-2**
