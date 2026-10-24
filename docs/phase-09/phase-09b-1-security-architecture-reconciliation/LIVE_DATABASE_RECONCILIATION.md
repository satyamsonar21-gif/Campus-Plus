# 02 — Live Database Reconciliation & Catalog Inventory

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Target Infrastructure:** Supabase Cloud (`gtwpxjpmwltxwjryazcu` / Tokyo `ap-northeast-1` / PostgreSQL 17)  
**Safety Protocol:** STRICT READ-ONLY FORENSIC COMPARISON — ZERO LIVE MUTATIONS PERFORMED  

---

## 1. Executive Catalog Comparison

This document establishes a read-only architectural comparison between four distinct sources of truth:
1. **Repository Migration History:** `migrations/00001` through `00010`.
2. **Consolidated Schema Definition:** `scripts/supabase_consolidated_schema.sql`.
3. **Live Supabase Production Database:** Supabase managed instance (`gtwpxjpmwltxwjryazcu`).
4. **Custom Migration Ledger vs Platform History:** `public._schema_migrations` vs `supabase_migrations.schema_migrations`.

### Quantitative Reality Baseline

| Catalog Entity | Repository Migrations (`migrations/`) | Consolidated Script (`scripts/`) | Live Supabase Instance (`gtwpxjpmwltxwjryazcu`) | Variance / Status |
| :--- | :---: | :---: | :---: | :--- |
| **Physical Base Tables** | 22 | 22 | 22 | **Matched (22/22 present)** |
| **Analytical Views** | 2 | 2 | 2 | **Matched (2/2 present; requires invoker update)** |
| **Domain Sequences** | 1 (`tracking_code_seq`) | 1 (`tracking_code_seq`) | 1 (`tracking_code_seq`) | **Matched (1/1 present)** |
| **Custom ENUM Types** | 5 | 5 | 5 | **Matched (5/5 present)** |
| **Custom Migration Ledger Records** | 10 (target) | 10 (seed) | 10 | **Matched (10/10 present in `_schema_migrations`)** |
| **Supabase Platform Migrations** | 0 | 0 | 0 | **0 in `supabase_migrations` (manual migration pattern)** |
| **Tables with RLS Enabled** | 6 (`00008` migration) | 22 | 22 | **22/22 Protected in live database** |
| **Tables with FORCE RLS** | 6 | 12 | 12 | **10 Tables lack FORCE RLS** |
| **Public RLS Policies** | 13 | 25 | 25 | **25 Policies active on live instance** |
| **Tables Missing Explicit Policies** | 16 | 6 | 6 | **6 Tables in default-deny state** |
| **Orphan Functions Flagged** | 0 | 0 (dropped in script) | 1 (`public.rls_auto_enable`) | **SEC-001 Open Security Defect** |
| **System Roles Seeded** | 5 (legacy seed) | 6 | 6 | **`ROLE_FACULTY` present on live; repository seed corrected** |
| **Private Storage Buckets** | 0 in migrations | 1 (`campus-plus-attachments`) | 0 (unprovisioned in storage) | **Storage Setup Pending Phase 09B-3** |

---

## 2. Comprehensive Reconciliation Matrix

| Component | Repository Expected State (`migrations/` & `scripts/`) | Live Database State (`gtwpxjpmwltxwjryazcu`) | Difference | Risk Level | Proposed Resolution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Base Tables (22)** | 22 tables defined in 3NF structure (`departments`, `categories`, `locations`, `working_calendars`, `calendar_holidays`, `roles`, `users`, `user_roles`, `department_memberships`, `complaints`, `complaint_assignments`, `complaint_forwards`, `complaint_escalations`, `resolutions`, `attachments`, `internal_notes`, `sla_policies`, `notifications`, `action_history`, `outbox_events`, `idempotency_keys`, `_schema_migrations`). | All 22 physical base tables exist in `public` schema. | None. Schema structural parity is 100%. | LOW (None) | Preserve all 22 tables without modification. |
| **Primary Keys** | All 22 tables have primary keys (`id UUID` or composite `(user_id, role_id)`, `version VARCHAR`). | All 22 tables have declared PK constraints. | None. PK integrity is verified. | LOW (None) | Preserve existing PK definitions. |
| **Foreign Keys** | 21 foreign key constraints enforcing relational integrity across complaints, departments, categories, users, roles, etc. | 21 foreign keys present in live catalog. | None. FK integrity is verified. | LOW (None) | Retain constraints. Note: 19 FKs lack covering indexes (addressed in PERF-001). |
| **Custom ENUMs (5)** | `complaint_status_enum` (13 values), `complaint_priority_enum` (4 values), `escalation_tier_enum` (3 values), `attachment_type_enum` (2 values), `outbox_status_enum` (3 values). | All 5 ENUM types exist in `public` with matching value sets. | None. Domain ENUMs are identical. | LOW (None) | Retain existing ENUM definitions. |
| **Database Views (2)** | `recurring_complaint_clusters`, `department_sla_performance` defined with default view ownership. | Views exist on live database with `security_definer` execution semantics. | Supabase Security Advisor flags views running as view owner instead of invoker. | HIGH (SEC-007) | Update views with `WITH (security_invoker = true)` in `scripts/phase_09b_remediation.sql`. |
| **Sequence (1)** | `tracking_code_seq` starting at 1, cache 1, increment 1. | Exists in live database. | None. | LOW (None) | Retain sequence. |
| **Audit Trigger (1)** | `trg_action_history_no_mutation` on `action_history` calling `trg_enforce_action_history_immutable()` to reject UPDATE/DELETE. | Exists and active on `action_history`. | None. Immutability trigger is verified. | LOW (None) | Retain trigger without alteration. |
| **Helper Functions (3)** | `auth.uid()`, `auth_has_role()`, `auth_user_department_id()`. | `auth_has_role()` and `auth_user_department_id()` present in `public`. | Live functions lack strict ACLs (accessible to `anon` and `PUBLIC`). | HIGH (SEC-004, SEC-005) | Apply `REVOKE ALL FROM PUBLIC, anon; GRANT TO authenticated;` via remediation script. |
| **Orphan Function (1)** | Not present in repository codebase or migrations. | `public.rls_auto_enable()` exists in live catalog with `SECURITY DEFINER` and world-execute permissions. | Rogue/orphan function created outside repository migrations. | CRITICAL (SEC-001) | Add `DROP FUNCTION IF EXISTS public.rls_auto_enable() CASCADE;` to remediation script. |
| **RLS Enabled State** | RLS enabled on all 22 public tables. | RLS enabled on all 22 public tables in `pg_tables`. | None. Baseline RLS activation is satisfied. | LOW (None) | Preserve RLS enabled state on all 22 tables. |
| **FORCE RLS State** | FORCE RLS required on sensitive domain tables to enforce policies even against table owner. | FORCE RLS active on 12 of 22 tables (`complaints`, `internal_notes`, `attachments`, `action_history`, `notifications`, `users`, `user_roles`, `department_memberships`, `complaint_assignments`, `complaint_forwards`, `complaint_escalations`, `resolutions`). | 10 reference and internal tables do not have FORCE RLS (`departments`, `categories`, `locations`, `working_calendars`, `calendar_holidays`, `roles`, `sla_policies`, `_schema_migrations`, `idempotency_keys`, `outbox_events`). | MEDIUM | Reference tables are public read-only; internal tables are accessed exclusively by server. Documented in RLS audit. |
| **RLS Policies** | 25 public policies active covering users, complaints, internal notes, attachments, notifications, action history, resolutions, and reference catalogs. | 25 public policies active on live instance. | `migrations/00008` had only 13 policies; live database was updated to 25 via consolidated schema. | LOW (Parity) | Verified. 6 tables remain without explicit policies (default deny). |
| **Unprotected Tables (6)** | `_schema_migrations`, `complaint_assignments`, `complaint_escalations`, `complaint_forwards`, `idempotency_keys`, `outbox_events`. | All 6 tables have RLS enabled with 0 explicit policies. | Default-deny blocks all non-superuser / non-service-role access. | MEDIUM | Add read policies for staff on `assignments`, `escalations`, `forwards`. Keep `migrations`, `idempotency`, `outbox` strictly default-deny. |
| **System Roles Seed Data** | Documented requirement specifies 5 primary roles: Student, Faculty, HOD, Director, Institutional Management. | Live `roles` table contains 6 records: `ROLE_STUDENT`, `ROLE_FACULTY`, `ROLE_HANDLER`, `ROLE_DEPT_HEAD`, `ROLE_MANAGEMENT`, `ROLE_ADMIN`. | Repository `seeds/001_reference_seed.sql` omitted `ROLE_FACULTY`. | HIGH (DEF-001) | Corrected repository `seeds/001_reference_seed.sql` to include `ROLE_FACULTY` with idempotent `ON CONFLICT` updates. |
| **Migration Tracking** | Custom table `public._schema_migrations` tracking versions `00001` through `00010`. | `public._schema_migrations` exists with 10 records. `supabase_migrations.schema_migrations` has 0 records. | Platform CLI migrations were not used; custom ledger is authoritative. | MEDIUM | Document dual-ledger architecture. Do not overwrite or drop `_schema_migrations`. |
| **Storage Buckets** | Private bucket `campus-plus-attachments` with 5 MB limit and JPEG/PNG/PDF MIME enforcement. | `storage.buckets` contains 0 records on live instance. | Attachments bucket unprovisioned in live Supabase Storage. | HIGH (SEC-006) | Execute `scripts/supabase_auth_and_storage_setup.sql` in Phase 09B-3 under authorized deployment. |
| **Auth User Sync Trigger** | Trigger `on_auth_user_created` on `auth.users` to automatically populate `public.users` and assign `ROLE_STUDENT`. | Trigger does not exist on live `auth.users`. | New user signups in Supabase Auth do not automatically sync to public domain model. | HIGH (BCR-AUTH-001) | Deploy `handle_new_auth_user()` trigger in Phase 09B-3. |

---

## 3. Detailed Component Catalog Verification

### A. Column Specifications and Constraints
- Table `users`:
  - Columns: `id UUID PK`, `email VARCHAR(255) NOT NULL UNIQUE`, `full_name VARCHAR(255) NOT NULL`, `phone_number VARCHAR(32)`, `roll_or_prn VARCHAR(64)`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`.
  - PII Protection: RLS enabled and forced. Self-select policy `p_users_self_select` prevents unauthenticated user dumps.
- Table `complaints`:
  - Columns: `id UUID PK`, `ref_id VARCHAR(32) NOT NULL UNIQUE`, `title VARCHAR(120) NOT NULL`, `description TEXT NOT NULL`, `complainant_id UUID NOT NULL FK`, `department_id UUID NOT NULL FK`, `category_id UUID NOT NULL FK`, `location_id UUID FK`, `location_details TEXT NOT NULL`, `status complaint_status_enum NOT NULL`, `suggested_priority complaint_priority_enum NOT NULL`, `official_priority complaint_priority_enum NOT NULL`, `assigned_handler_id UUID FK`, `escalation_tier escalation_tier_enum NOT NULL`, `is_escalated BOOLEAN NOT NULL`, `version INTEGER NOT NULL DEFAULT 1`, `sla_due_at TIMESTAMPTZ`, `resolved_at TIMESTAMPTZ`, `closed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`.
  - Invariants: Verified that `ref_id` matches regex `^CP-[0-9]{4}-[0-9]{5}$`.
- Table `internal_notes`:
  - Columns: `id UUID PK`, `complaint_id UUID NOT NULL FK`, `author_id UUID NOT NULL FK`, `author_role VARCHAR(64) NOT NULL`, `note TEXT NOT NULL`, `created_at TIMESTAMPTZ`.
  - Student Exclusion: Verified policy `p_internal_notes_staff_select` excludes students completely (INV-012).

---

## 4. Certification of Non-Mutation

**I explicitly certify:**  
**"NO LIVE DATABASE MODIFICATIONS WERE PERFORMED DURING THIS RECONCILIATION."**  
All catalog inspections, schema comparisons, and gap analyses were conducted strictly via read-only observation and local PostgreSQL 18.3 parity environments.
