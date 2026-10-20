# Database Security Findings & Vulnerability Assessment

**Project:** Campus Plus  
**Phase:** Phase 09A — Database Security Audit  
**Classification:** HIGH CONFIDENCE FORENSIC AUDIT  
**Audit Scope:** Repository SQL Migrations (`00001`–`00010`), Seed Scripts, and Live Supabase Catalog  

---

## 1. Security Findings Summary Matrix

| ID | Finding Title | Severity | Location | Risk Impact | Recommended Remediation |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **SEC-001** | Rogue `SECURITY DEFINER` Function `rls_auto_enable` | **CRITICAL** | Live Supabase `public` | Unauthenticated Privilege Escalation / Schema Tampering | Revoke execute from `PUBLIC`, drop function |
| **SEC-002** | Complete Omission of RLS on `users` Table | **CRITICAL** | `migrations/00008` | Mass PII Data Leakage via PostgREST `anon` endpoint | Enable RLS, FORCE RLS, add self-read & admin policies |
| **SEC-003** | Missing RLS on 15 Application Tables | **HIGH** | `migrations/00008` | Exposure of Resolutions, Outbox, and Internal Metadata | Enable RLS across all remaining 15 tables |
| **SEC-004** | Missing `search_path` on Trigger Function | **HIGH** | `migrations/00006` | Search Path Hijacking Attack | Add `SET search_path = public, pg_temp` |
| **SEC-005** | Default Public Execute Grants on Helper Functions | **MEDIUM** | `migrations/00008` | Unauthorized RPC invocation by anonymous roles | `REVOKE EXECUTE FROM PUBLIC`, grant only to `authenticated` |
| **SEC-006** | Storage Bucket DDL & RLS Completely Absent | **HIGH** | SQL Migrations | Attachment storage unprovisioned or publicly exposed | Add migration creating private bucket & `storage.objects` policies |

---

## 2. In-Depth Vulnerability Analysis & Proof of Concept

### Finding SEC-001: Rogue `SECURITY DEFINER` Function `public.rls_auto_enable()` (CRITICAL)
- **Vulnerability Description:**  
  The target Supabase database contains a pre-existing function `public.rls_auto_enable()`. It is flagged by the Supabase Security Advisor because it executes with `SECURITY DEFINER` (super-user or function creator privileges) and grants execute permissions to the default `PUBLIC` pseudo-role.
- **Threat Vector:**  
  Because PostgREST automatically exposes public functions as RPC endpoints (`/rest/v1/rpc/rls_auto_enable`), an anonymous external caller with the Supabase `anon` publishable key could potentially trigger this function or exploit search-path weaknesses to alter RLS configurations.
- **Root Cause:**  
  Orphaned template function or manual SQL console artifact present on the initial project setup before Campus Plus codebase deployment.
- **Remediation SQL:**
  ```sql
  REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  DROP FUNCTION IF EXISTS public.rls_auto_enable();
  ```

---

### Finding SEC-002: Complete Omission of RLS on `users` Table (CRITICAL)
- **Vulnerability Description:**  
  Migration `00008_row_level_security_policies.sql` enables and forces RLS on 6 tables: `complaints`, `internal_notes`, `attachments`, `action_history`, `notifications`, and `user_roles`.  
  It **completely ignores table `users`**.
- **Threat Vector:**  
  In Supabase, any table in `public` without RLS is directly accessible via the auto-generated PostgREST HTTP REST API. If the `anon` role possesses `SELECT` grants on schema `public` (Supabase standard default), an unauthenticated attacker can execute:
  ```http
  GET https://gtwpxjpmwltxwjryazcu.supabase.co/rest/v1/users?select=*
  apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>
  ```
  This immediately dumps the entire institution directory, including:
  - Student names (`full_name`)
  - Email addresses (`email`)
  - Personal phone numbers (`phone_number`)
  - Roll numbers / PRN (`roll_or_prn`)
- **Remediation SQL:**
  ```sql
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE users FORCE ROW LEVEL SECURITY;

  -- 1. Users can view their own profile
  CREATE POLICY p_users_self_select ON users
  FOR SELECT TO PUBLIC
  USING (id = auth.uid());

  -- 2. Staff and management can view user names and emails for grievance workflow
  CREATE POLICY p_users_staff_select ON users
  FOR SELECT TO PUBLIC
  USING (
      auth_has_role('ROLE_HANDLER')
      OR auth_has_role('ROLE_DEPT_HEAD')
      OR auth_has_role('ROLE_MANAGEMENT')
      OR auth_has_role('ROLE_ADMIN')
  );

  -- 3. Users can update only their own phone number / profile fields (never roles or emails)
  CREATE POLICY p_users_self_update ON users
  FOR UPDATE TO PUBLIC
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
  ```

---

### Finding SEC-003: Missing RLS on 15 Application Tables (HIGH)
- **Vulnerability Description:**  
  Out of 22 base tables, 15 lack RLS:
  1. `resolutions` (contains resolution notes, student dispute rationale, settlement proofs)
  2. `complaint_assignments` (handler triage and assignment history)
  3. `complaint_forwards` (inter-departmental conflict transfer notes and rationale)
  4. `complaint_escalations` (managerial escalation reasons)
  5. `department_memberships` (staff organizational structure)
  6. `outbox_events` (internal transactional domain event payloads)
  7. `idempotency_keys` (cached API responses containing sensitive payload bodies)
  8. `sla_policies` (internal operational thresholds)
  9. `departments`, `categories`, `locations`, `working_calendars`, `calendar_holidays`, `roles`, `_schema_migrations`.
- **Threat Vector:**  
  Unauthenticated querying of `resolutions` leaks private grievance dispute details. Unauthenticated querying of `outbox_events` leaks domain event JSON.
- **Remediation:**  
  Apply `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` across all application tables. Reference tables (`departments`, `categories`, `locations`, `working_calendars`, `calendar_holidays`, `roles`) should receive read-only `SELECT` policies for authenticated users, while workflow tables (`resolutions`, `complaint_assignments`, `complaint_forwards`, `complaint_escalations`) must mirror the grievance viewing permissions of `complaints`.

---

### Finding SEC-004: Missing `search_path` on Trigger Function (HIGH)
- **Vulnerability Description:**  
  In `00006_audit_and_outbox_tables.sql`:
  ```sql
  CREATE OR REPLACE FUNCTION trg_enforce_action_history_immutable()
  RETURNS TRIGGER AS $$
  BEGIN
      RAISE EXCEPTION 'SECURITY VIOLATION: action_history is an immutable append-only journal. UPDATE and DELETE are prohibited.'
          USING ERRCODE = '55000';
  END;
  $$ LANGUAGE plpgsql;
  ```
  The function does not declare `SET search_path = public, pg_temp` or `SET search_path = ''`.
- **Threat Vector:**  
  In PostgreSQL, functions without a fixed `search_path` are vulnerable to object resolution hijacking if an attacker creates temporary tables or objects in a schema that precedes `public` in the runtime search path.
- **Remediation SQL:**
  ```sql
  CREATE OR REPLACE FUNCTION trg_enforce_action_history_immutable()
  RETURNS TRIGGER AS $$
  BEGIN
      RAISE EXCEPTION 'SECURITY VIOLATION: action_history is an immutable append-only journal. UPDATE and DELETE are prohibited.'
          USING ERRCODE = '55000';
  END;
  $$ LANGUAGE plpgsql SET search_path = public, pg_temp;
  ```

---

### Finding SEC-005: Stored Functions Have Default Public Execute Grants (MEDIUM)
- **Vulnerability Description:**  
  In `00008_row_level_security_policies.sql`, `auth_has_role(required_role VARCHAR)` and `auth_user_department_id()` are marked `SECURITY DEFINER`, but PostgreSQL by default grants `EXECUTE` on new functions to `PUBLIC`.
- **Remediation SQL:**
  ```sql
  REVOKE EXECUTE ON FUNCTION auth_has_role(VARCHAR) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION auth_has_role(VARCHAR) TO authenticated, service_role;

  REVOKE EXECUTE ON FUNCTION auth_user_department_id() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION auth_user_department_id() TO authenticated, service_role;
  ```

---

### Finding SEC-006: Storage Bucket DDL & Storage RLS Missing from Repository Migrations (HIGH)
- **Vulnerability Description:**  
  The application interacts with Supabase Storage bucket `campus-plus-attachments` via `SupabaseStorageAdapter.ts`. However, **zero migration files create this bucket or configure storage RLS policies in `storage.objects`**.
- **Threat Vector:**  
  If the bucket is manually created as `public`, all student grievance attachments (medical records, harassment evidence, room damage photos) become publicly crawlable and indexable by search engines via signed/unsigned URLs.
- **Remediation SQL:**
  Add a dedicated migration or storage setup script in Phase 09B:
  ```sql
  -- Ensure bucket exists and is strictly private
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
      'campus-plus-attachments',
      'campus-plus-attachments',
      FALSE,
      5242880,
      ARRAY['image/jpeg', 'image/png', 'application/pdf']
  ) ON CONFLICT (id) DO UPDATE SET
      public = FALSE,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];

  -- Storage RLS: Download only if authorized on the associated complaint
  CREATE POLICY p_storage_complaint_attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
      bucket_id = 'campus-plus-attachments'
      AND (
          -- Owner upload or staff member with jurisdictional access
          EXISTS (
              SELECT 1 FROM attachments a
              JOIN complaints c ON a.complaint_id = c.id
              WHERE a.storage_key = storage.objects.name
              AND (
                  c.complainant_id = auth.uid()
                  OR (c.department_id = auth_user_department_id() AND (auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD')))
                  OR auth_has_role('ROLE_MANAGEMENT')
                  OR auth_has_role('ROLE_ADMIN')
              )
          )
      )
  );
  ```
