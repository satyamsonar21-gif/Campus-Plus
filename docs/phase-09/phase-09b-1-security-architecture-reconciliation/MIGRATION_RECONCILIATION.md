# 05 — Migration History Reconciliation Report

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Target Infrastructure:** Supabase Managed PostgreSQL 17 (`gtwpxjpmwltxwjryazcu` / `ap-northeast-1`)  
**Safety Protocol:** STRICT READ-ONLY AUDIT — ZERO MIGRATIONS EXECUTED — ZERO RECORDS ALTERED  

---

## 1. Dual-Ledger Migration Architecture

In Campus Plus, two distinct migration tracking mechanisms exist:
1. **Repository Custom Migration Ledger (`public._schema_migrations`):**
   - Implemented via `src/infrastructure/database/migrator.ts`.
   - Tracks `version VARCHAR(255)`, `name VARCHAR(255)`, `checksum VARCHAR(64)`, and `applied_at TIMESTAMPTZ`.
   - Contains exactly **10 records** corresponding to migrations `00001` through `00010`.
2. **Supabase Platform Migration History (`supabase_migrations.schema_migrations`):**
   - Native Supabase CLI migration tracking ledger.
   - Currently contains **0 records**.
   - This occurs because the initial live database schema was applied via the consolidated SQL execution pattern (`scripts/supabase_consolidated_schema.sql`) through the Supabase Dashboard SQL Editor rather than using `supabase db push`.

### Preservation Policy Invariant
- **The custom migration ledger must NEVER be deleted, truncated, or replaced.**
- **The Supabase CLI must NOT execute `supabase db reset` or blind `supabase db push`**, as this would attempt to replay initial migrations from scratch against populated tables, causing catastrophic table recreation failures.

---

## 2. Migration Reconciliation Report Table

| Migration Version & Name | Repository Status | Custom Ledger Status (`_schema_migrations`) | Platform History Status (`supabase_migrations`) | Live Schema Evidence (`gtwpxjpmwltxwjryazcu`) | Replay Safety | Recommended Action |
| :--- | :---: | :---: | :---: | :--- | :---: | :--- |
| **00001_initial_types_and_extensions.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | Extensions `pgcrypto` active; ENUMs `complaint_status_enum`, `complaint_priority_enum`, `escalation_tier_enum`, `attachment_type_enum`, `outbox_status_enum` exist. | SAFE IF GUARDED | Mark as applied. Do not re-run blindly. |
| **00002_core_institutional_tables.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | Tables `departments`, `categories`, `locations`, `working_calendars`, `calendar_holidays` exist with PKs, FKs, and constraints. | UNSAFE (CREATE TABLE without IF NOT EXISTS) | Retain existing tables. Do not replay. |
| **00003_identity_and_access_tables.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | Tables `roles`, `users`, `user_roles`, `department_memberships` exist. | UNSAFE | Retain existing tables. User data is live. |
| **00004_complaint_aggregate_tables.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | Tables `complaints`, `internal_notes`, `attachments`, `notifications`, `action_history`, `resolutions` exist. | UNSAFE | Retain existing tables. High risk of data loss if dropped. |
| **00005_supporting_workflow_tables.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | Tables `complaint_assignments`, `complaint_forwards`, `complaint_escalations`, `sla_policies` exist. | UNSAFE | Retain existing tables. Do not replay. |
| **00006_audit_and_outbox_tables.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | Tables `outbox_events`, `idempotency_keys` exist. Immutability trigger on `action_history` exists. | UNSAFE | Retain existing tables. |
| **00007_indexes_and_performance.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | 45 indexes on status, category, department, timestamps, etc. exist. | SAFE (CREATE INDEX IF NOT EXISTS) | Retain existing indexes. Add 19 FK covering indexes via remediation script. |
| **00008_row_level_security_policies.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | 25 RLS policies active on live instance. Note: live instance has 25 policies (consolidated schema) vs 13 in original `00008` migration. | SAFE IF IDEMPOTENT | Add missing policies for workflow tables via additive remediation script. |
| **00009_analytical_views.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | Views `recurring_complaint_clusters` and `department_sla_performance` exist. | SAFE IF REPLACED | Recreate views with `WITH (security_invoker = true)` in Phase 09B-2. |
| **00010_tracking_code_sequence.sql** | Present in `migrations/` | Recorded as applied | Absent (0 records) | Sequence `tracking_code_seq` exists and is linked to complaint tracking numbers. | SAFE (CREATE SEQUENCE IF NOT EXISTS) | Retain sequence. |

---

## 3. Discrepancy Analysis

1. **`00008_row_level_security_policies.sql` Variance:**
   - In `migrations/00008`, only 6 tables had RLS enabled (`complaints`, `internal_notes`, `attachments`, `action_history`, `notifications`, `user_roles`) with 13 policies.
   - In the live database (`gtwpxjpmwltxwjryazcu`), all 22 tables have RLS enabled, and 25 policies exist (matching `scripts/supabase_consolidated_schema.sql`).
   - This variance arose during Phase 09A when critical PII vulnerabilities (SEC-002 on `users`) were resolved in the consolidated deployment script.
2. **Platform Migration Ledger Incongruence:**
   - The Supabase CLI `supabase db push` command relies on `supabase_migrations.schema_migrations`.
   - Running `supabase db push` against `gtwpxjpmwltxwjryazcu` right now would attempt to apply all 10 migrations from scratch because the platform ledger is empty.
   - **Resolution:** A baseline migration synchronization script must be created in Phase 09B-2 to record versions `00001` through `00010` in `supabase_migrations.schema_migrations` without re-executing DDL statements.

---

## 4. Controlled Future Migration Protocol

Any future database migration (including Phase 09B-2 remediation) must adhere to these non-negotiable rules:
1. **Idempotency:** Every statement must use `IF EXISTS`, `IF NOT EXISTS`, or procedural exception handling (`EXCEPTION WHEN duplicate_object THEN NULL`).
2. **Precondition Checks:** Check existing table definitions, column types, and constraints before applying modifications.
3. **Transaction-Bounded:** All statements must execute within a strict `BEGIN; ... COMMIT;` transaction block.
4. **Zero Destructive Schema Replacement:** Never drop public application tables or truncate records.
5. **Rollback Procedures:** Every proposed change must be paired with an exact, tested rollback script.
