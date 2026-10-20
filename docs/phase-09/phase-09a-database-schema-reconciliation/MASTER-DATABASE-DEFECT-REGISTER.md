# Master Database Defect Register (MDDR)

**Project:** Campus Plus — Database Reconciliation  
**Phase:** Phase 09A — Forensic Defect Logging  
**Audit Standard:** Zero Assumptions, Evidence-Based Traceability  
**Defect Status Rule:** *Defects are marked OPEN until fix implementation and automated regression testing are executed in Phase 09B.*  

---

## 1. Defect Executive Summary

| Defect ID | Severity | Category | Target Object | Current Status |
| :--- | :---: | :---: | :--- | :---: |
| **DEF-SEC-001** | **CRITICAL** | Security | Live function `public.rls_auto_enable()` | **OPEN (Blocker)** |
| **DEF-SEC-002** | **CRITICAL** | Security / RLS | Table `public.users` (Migration 00008) | **OPEN (Blocker)** |
| **DEF-ENV-001** | **CRITICAL** | Infrastructure | Repository `.env.local` | **OPEN (Blocker)** |
| **DEF-SEC-003** | **HIGH** | Security / RLS | 15 Application Tables (Migration 00008) | **OPEN** |
| **DEF-SEC-006** | **HIGH** | Security / Storage | Storage Bucket `campus-plus-attachments` | **OPEN** |
| **DEF-BIZ-001** | **HIGH** | Business / RBAC | Table `roles` / `seeds/001_reference_seed.sql` | **OPEN** |
| **DEF-BIZ-002** | **HIGH** | Business Invariant | Table `complaints` (Closed immutability trigger) | **OPEN** |
| **DEF-SEC-004** | **MEDIUM** | Security | Function `trg_enforce_action_history_immutable` | **OPEN** |
| **DEF-SEC-005** | **MEDIUM** | Security / RPC | Functions `auth_has_role`, `auth_user_dept` | **OPEN** |
| **DEF-BIZ-003** | **MEDIUM** | Business Invariant | Table `attachments` (3-file limit trigger) | **OPEN** |
| **DEF-MIG-001** | **LOW** | Portability | Migration 00008 `auth` schema creation shim | **OPEN** |

---

## 2. Granular Defect Catalog

### DEF-SEC-001: Rogue `SECURITY DEFINER` Function `public.rls_auto_enable()`
- **Defect ID:** `DEF-SEC-001`
- **Severity:** **CRITICAL**
- **Affected Object:** Live Supabase Database (`public.rls_auto_enable()`)
- **Root Cause:** Orphaned database function present on live instance prior to repository migration deployment.
- **Business Impact:** High operational risk; unauthorized callers could tamper with RLS status.
- **Security Impact:** Unauthenticated public callers with anon key can invoke this function via PostgREST RPC, creating privilege escalation vectors.
- **Recommended Correction:** Revoke execute permissions from PUBLIC and DROP function in Phase 09B pre-deployment step.
- **Required Regression Test:** Query `pg_proc` for `rls_auto_enable` on live database and assert row count is 0.
- **Dependencies:** None.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-SEC-002: Complete Omission of RLS on Table `users`
- **Defect ID:** `DEF-SEC-002`
- **Severity:** **CRITICAL**
- **Affected Object:** `migrations/00008_row_level_security_policies.sql` (Table `users`)
- **Root Cause:** Table `users` was omitted from `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in migration 00008.
- **Business Impact:** Violation of student and faculty privacy compliance; mass exposure of campus institutional directory.
- **Security Impact:** Unauthenticated `anon` key can query `/rest/v1/users?select=*` to dump names, emails, phone numbers, and student roll numbers.
- **Recommended Correction:** Add `ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;` and policies restricting read access to self and authorized staff.
- **Required Regression Test:** Test `tests/database/rls-authorization.test.ts` querying `users` under unprivileged user identity and asserting other users' PII is blocked.
- **Dependencies:** Migration 00003, Migration 00008.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-ENV-001: Environment Variable Drift to Legacy Staging Instance
- **Defect ID:** `DEF-ENV-001`
- **Severity:** **CRITICAL (DEPLOYMENT BLOCKER)**
- **Affected Object:** `d:\Deparment Project\department project\.env.local`
- **Root Cause:** Repository `.env.local` is hardcoded to legacy staging project `rdcuizmrirnhuusncnnn` (ap-south-1).
- **Business Impact:** Application cannot connect to or operate on target Supabase project `gtwpxjpmwltxwjryazcu` (ap-northeast-1).
- **Security Impact:** Potential accidental transmission of credentials or requests to wrong cloud infrastructure.
- **Recommended Correction:** Update `.env.local` with target project URL, anon key, service role key, and pooler database URL for `gtwpxjpmwltxwjryazcu`.
- **Required Regression Test:** Verify direct TCP/SSL connection and `SELECT current_database()` matches target instance.
- **Dependencies:** Provisioning of credentials for target project.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-SEC-003: Missing Row-Level Security on 15 Application Tables
- **Defect ID:** `DEF-SEC-003`
- **Severity:** **HIGH**
- **Affected Object:** `migrations/00008_row_level_security_policies.sql`
- **Root Cause:** RLS was only enabled on 6 tables, omitting `departments`, `categories`, `locations`, `working_calendars`, `calendar_holidays`, `roles`, `department_memberships`, `complaint_assignments`, `complaint_forwards`, `complaint_escalations`, `resolutions`, `sla_policies`, `outbox_events`, `idempotency_keys`, and `_schema_migrations`.
- **Business Impact:** Internal escalation notes, dispute resolutions, and operational outbox event streams exposed to unauthorized queries.
- **Security Impact:** Data exposure via PostgREST endpoints.
- **Recommended Correction:** Enable and force RLS on all 15 tables with appropriate role policies.
- **Required Regression Test:** Automated RLS query probe across all 22 tables asserting zero unprotected tables in `pg_tables`.
- **Dependencies:** Migration 00008.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-SEC-006: Storage Bucket `campus-plus-attachments` Missing in Migrations
- **Defect ID:** `DEF-SEC-006`
- **Severity:** **HIGH**
- **Affected Object:** Repository Migrations (`migrations/`)
- **Root Cause:** Storage bucket creation and storage RLS policies in `storage.objects` were not scripted as SQL migrations.
- **Business Impact:** File uploads fail in new environments or bucket is manually created with public visibility, leaking grievance evidence.
- **Security Impact:** Unsigned public access to sensitive attachments.
- **Recommended Correction:** Create migration adding private bucket `campus-plus-attachments` and complaint-linked download policies.
- **Required Regression Test:** Attempt unauthenticated direct GET on storage object URL and assert 403 Forbidden.
- **Dependencies:** Supabase storage extension.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-BIZ-001: Missing `ROLE_FACULTY` in Reference Seed
- **Defect ID:** `DEF-BIZ-001`
- **Severity:** **HIGH**
- **Affected Object:** `seeds/001_reference_seed.sql`, Table `roles`
- **Root Cause:** `ROLE_FACULTY` is declared in TypeScript domain definitions (`ComplaintTypes.ts`), but was omitted from SQL seed script.
- **Business Impact:** Faculty accounts cannot be created or assigned in the database, breaking the 5-role institutional governance requirement.
- **Security Impact:** Low (Integrity/Constraint failure).
- **Recommended Correction:** Add `ROLE_FACULTY` to `seeds/001_reference_seed.sql`.
- **Required Regression Test:** Seed database and verify `SELECT * FROM roles WHERE id = 'ROLE_FACULTY';` returns 1 row.
- **Dependencies:** Migration 00003.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-BIZ-002: Missing PostgreSQL Trigger for Closed Complaint Immutability
- **Defect ID:** `DEF-BIZ-002`
- **Severity:** **HIGH**
- **Affected Object:** Migration 00004 (Table `complaints`)
- **Root Cause:** Closed complaint immutability was implemented solely in application TypeScript (`BusinessInvariants.ts`), without a backing database trigger.
- **Business Impact:** Risk of retrospective tampering with closed grievance records via direct SQL or external integrations.
- **Security Impact:** Audit integrity violation.
- **Recommended Correction:** Implement `trg_enforce_complaint_closed_immutable()` BEFORE UPDATE on `complaints`.
- **Required Regression Test:** Execute `UPDATE complaints SET title = 'New' WHERE status = 'CLOSED';` and assert exception code 55000.
- **Dependencies:** Migration 00004.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-SEC-004: Missing Fixed `search_path` on Audit Trigger Function
- **Defect ID:** `DEF-SEC-004`
- **Severity:** **MEDIUM**
- **Affected Object:** `migrations/00006_audit_and_outbox_tables.sql` (`trg_enforce_action_history_immutable`)
- **Root Cause:** Function was created without explicit `SET search_path = public, pg_temp`.
- **Business Impact:** Potential instability in multi-tenant or schema-switching configurations.
- **Security Impact:** Vulnerable to search path hijacking in PostgreSQL.
- **Recommended Correction:** Add `SET search_path = public, pg_temp` to function declaration.
- **Required Regression Test:** Inspect `proconfig` column in `pg_proc` for `trg_enforce_action_history_immutable`.
- **Dependencies:** Migration 00006.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-SEC-005: Stored Functions Have Default Public Execute Privileges
- **Defect ID:** `DEF-SEC-005`
- **Severity:** **MEDIUM**
- **Affected Object:** `migrations/00008_row_level_security_policies.sql` (`auth_has_role`, `auth_user_department_id`)
- **Root Cause:** PostgreSQL default behavior grants `EXECUTE` on new public functions to `PUBLIC`.
- **Business Impact:** Unnecessary exposure of internal security RPCs.
- **Security Impact:** Public callers can execute RPCs.
- **Recommended Correction:** Add explicit `REVOKE EXECUTE ... FROM PUBLIC` and grant only to `authenticated, service_role`.
- **Required Regression Test:** Verify `has_function_privilege('anon', 'auth_has_role(varchar)', 'execute')` returns FALSE.
- **Dependencies:** Migration 00008.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-BIZ-003: Missing Database Constraint for 3-Attachment Limit
- **Defect ID:** `DEF-BIZ-003`
- **Severity:** **MEDIUM**
- **Affected Object:** Migration 00005 (Table `attachments`)
- **Root Cause:** 3-file limit is checked only in application Zod schemas.
- **Business Impact:** Direct database inserts or batch scripts can attach an arbitrary number of files to a complaint.
- **Security Impact:** Storage bloat / DoS.
- **Recommended Correction:** Add trigger `trg_enforce_attachment_count_limit()` BEFORE INSERT on `attachments`.
- **Required Regression Test:** Attempt inserting 4th attachment to a complaint and assert check exception.
- **Dependencies:** Migration 00005.
- **Closure Evidence:** None (Defect is OPEN).

---

### DEF-MIG-001: Portability Shim Schema Creation Privileges
- **Defect ID:** `DEF-MIG-001`
- **Severity:** **LOW**
- **Affected Object:** `migrations/00008_row_level_security_policies.sql` (Line 9: `CREATE SCHEMA auth;`)
- **Root Cause:** Migration attempts to create schema `auth` if not exists. On Supabase Cloud, `auth` already exists and non-superuser roles lack permissions to create schemas.
- **Business Impact:** Migration will log a notice or handle via `insufficient_privilege` exception, but standardizing to skip on managed instances is cleaner.
- **Security Impact:** None.
- **Recommended Correction:** Ensure block is safely wrapped in `EXCEPTION WHEN duplicate_schema OR insufficient_privilege THEN NULL;`.
- **Dependencies:** Migration 00008.
- **Closure Evidence:** None (Defect is OPEN).
