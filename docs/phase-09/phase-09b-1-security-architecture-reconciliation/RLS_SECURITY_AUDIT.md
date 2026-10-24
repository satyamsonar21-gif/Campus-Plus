# 03 — Row-Level Security (RLS) & Database Security Audit

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Target Infrastructure:** Supabase PostgreSQL 17 (`gtwpxjpmwltxwjryazcu` / `ap-northeast-1`)  
**Safety Protocol:** STRICT READ-ONLY SECURITY AUDIT — ZERO LIVE MUTATIONS PERFORMED  

---

## 1. Executive Summary

This security audit performs an exhaustive, table-by-table inspection of the Row-Level Security (RLS) architecture of Campus Plus across all 22 public tables, 2 views, and 2 database helper functions.

Key Findings:
1. **RLS Activation:** 100% of all 22 public tables have `ENABLE ROW LEVEL SECURITY` declared.
2. **FORCE RLS:** 12 tables have `FORCE ROW LEVEL SECURITY` active; 10 tables have `ENABLE` without `FORCE`.
3. **Policy Inventory:** Exactly 25 public RLS policies are deployed on the live database.
4. **Policy Coverage Gaps:** 6 tables have RLS enabled with 0 explicit policies, enforcing a strict PostgreSQL default-deny behavior for non-superusers.
5. **Security Definer Functions:** Helper functions `auth_has_role()` and `auth_user_department_id()` have `SET search_path = public, pg_temp;`, but currently permit world execution by `anon` and `PUBLIC`.
6. **Analytical Views:** Views `recurring_complaint_clusters` and `department_sla_performance` lack `WITH (security_invoker = true)`, running with view-owner privileges rather than enforcing the querying user's RLS.

---

## 2. Table-by-Table RLS Architecture Matrix

| # | Table Name | RLS Enabled | FORCE RLS | Policy Count | Intended Access Level | Default-Deny Behavior | Security Recommendation |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :--- |
| 1 | `users` | YES | YES | 2 | Authenticated users (Self Read/Update) + Staff (Read) | Active for other users' PII | Keep forced RLS and policies. |
| 2 | `complaints` | YES | YES | 6 | Complainant (Self), Department Staff, Management/Admin | Active for cross-student / cross-dept | Keep forced RLS and policies. |
| 3 | `internal_notes` | YES | YES | 2 | Department Staff, Management, Admin (Zero Student) | Active for students (INV-012) | Keep forced RLS and policies. |
| 4 | `attachments` | YES | YES | 2 | Complainant & Assigned Department Staff | Active for unauthorized users | Keep forced RLS and policies. |
| 5 | `notifications` | YES | YES | 2 | Recipient Only (`recipient_id = auth.uid()`) | Active for other users | Keep forced RLS and policies. |
| 6 | `action_history` | YES | YES | 1 | Complainant & Assigned Staff (Read-Only) | Active for unauthorized users | Keep forced RLS and policies. |
| 7 | `resolutions` | YES | YES | 1 | Complainant & Assigned Staff (Read-Only) | Active for unauthorized users | Keep forced RLS and policies. |
| 8 | `user_roles` | YES | YES | 1 | Self Read (`user_id = auth.uid()`) + Admin Read | Active for unauthorized users | Keep forced RLS and policies. |
| 9 | `department_memberships` | YES | YES | 1 | Self Read + HOD + Admin Read | Active for unauthorized users | Keep forced RLS and policies. |
| 10 | `complaint_assignments` | YES | YES | 0 | Department Staff, Management, Admin | **BLOCKED (Default Deny)** | Add read policy for department staff. |
| 11 | `complaint_forwards` | YES | YES | 0 | Department Staff (From/To), Management, Admin | **BLOCKED (Default Deny)** | Add read policy for involved staff. |
| 12 | `complaint_escalations` | YES | YES | 0 | Department Staff, Management, Admin | **BLOCKED (Default Deny)** | Add read policy for department staff. |
| 13 | `departments` | YES | NO | 1 | Public Read-Only (`USING (true)`) | Inactive (Public Read) | Retain read policy; mutations restricted to server. |
| 14 | `categories` | YES | NO | 1 | Public Read-Only (`USING (true)`) | Inactive (Public Read) | Retain read policy; mutations restricted to server. |
| 15 | `locations` | YES | NO | 1 | Public Read-Only (`USING (true)`) | Inactive (Public Read) | Retain read policy; mutations restricted to server. |
| 16 | `working_calendars` | YES | NO | 1 | Public Read-Only (`USING (true)`) | Inactive (Public Read) | Retain read policy; mutations restricted to server. |
| 17 | `calendar_holidays` | YES | NO | 1 | Public Read-Only (`USING (true)`) | Inactive (Public Read) | Retain read policy; mutations restricted to server. |
| 18 | `roles` | YES | NO | 1 | Public Read-Only (`USING (true)`) | Inactive (Public Read) | Retain read policy; mutations restricted to server. |
| 19 | `sla_policies` | YES | NO | 1 | Public Read-Only (`USING (true)`) | Inactive (Public Read) | Retain read policy; mutations restricted to server. |
| 20 | `outbox_events` | YES | NO | 0 | Internal Backend Worker Only | **BLOCKED (Default Deny)** | **Intentional Default Deny**; service-role only. |
| 21 | `idempotency_keys` | YES | NO | 0 | Internal Backend API Middleware Only | **BLOCKED (Default Deny)** | **Intentional Default Deny**; service-role only. |
| 22 | `_schema_migrations` | YES | NO | 0 | Migration Runner / DevOps Only | **BLOCKED (Default Deny)** | **Intentional Default Deny**; superuser only. |

---

## 3. Analysis of the Six Tables Without Explicit Policies

### A. Intentional Default-Deny Tables (Internal Infrastructure Only)
1. **`_schema_migrations`**:
   - **Purpose:** Custom migration ledger recording applied version strings, names, checksums, and timestamps.
   - **Access Pattern:** Only the migration deployment runner writes to this table.
   - **Decision:** **DO NOT CREATE PUBLIC POLICIES.** The absence of explicit policies guarantees that anonymous and authenticated client connections cannot inspect or alter migration ledger records.
2. **`idempotency_keys`**:
   - **Purpose:** Server-side request deduplication cache storing hashed mutation payloads and cached HTTP responses (BR-004).
   - **Access Pattern:** Read and written exclusively by backend API routes (`src/infrastructure/database/PostgresComplaintRepository.ts`) during atomic mutations.
   - **Decision:** **DO NOT CREATE PUBLIC POLICIES.** The table is strictly internal backend infrastructure. Direct client access via PostgREST must remain denied.
3. **`outbox_events`**:
   - **Purpose:** Transactional outbox event stream for guaranteed at-least-once notification publishing.
   - **Access Pattern:** Written by backend repository within the complaint transaction; read by background outbox dispatchers.
   - **Decision:** **DO NOT CREATE PUBLIC POLICIES.** No client should ever read raw outbox events directly.

### B. Workflow Junction Tables Requiring Explicit Read Policies
4. **`complaint_assignments`**:
   - **Vulnerability:** Currently, authenticated handlers cannot query assignment history through client PostgREST endpoints.
   - **Remediation:** Add policy `p_complaint_assignments_staff_select` allowing assigned department staff and management to view assignment records for department complaints.
5. **`complaint_escalations`**:
   - **Vulnerability:** Escalation records are inaccessible via PostgREST to staff investigating escalated complaints.
   - **Remediation:** Add policy `p_complaint_escalations_staff_select` allowing department staff and executive management to inspect escalation tiers.
6. **`complaint_forwards`**:
   - **Vulnerability:** Department transfer audit records cannot be queried by staff in either the originating or receiving department.
   - **Remediation:** Add policy `p_complaint_forwards_staff_select` permitting read access if the user's active department matches either `from_department_id`, `to_department_id`, or if the user is management/admin.

---

## 4. FORCE ROW LEVEL SECURITY (FORCE RLS) Architecture

In PostgreSQL:
- By default, table owners and superusers (`postgres`) bypass RLS policies.
- When `FORCE ROW LEVEL SECURITY` is enabled, RLS policies are strictly evaluated **even for the table owner**.
- **Current Architecture:**
  - 12 tables have `FORCE RLS` enabled.
  - 10 tables do not have `FORCE RLS`.
- **Engineering Assessment:**
  - For domain tables containing sensitive user data (`users`, `complaints`, `internal_notes`, `attachments`, `notifications`, `resolutions`), `FORCE RLS` provides crucial defense-in-depth against accidental data leakage when queries execute under table-owner connections.
  - For master reference tables (`departments`, `categories`, `locations`, `working_calendars`, `calendar_holidays`, `roles`, `sla_policies`), read access is universal (`USING (true)`), so FORCE RLS provides no meaningful additional protection.
  - For internal tables (`_schema_migrations`, `idempotency_keys`, `outbox_events`), enabling FORCE RLS would block server-side backend operations that execute without JWT context. Therefore, keeping FORCE RLS disabled on these 3 internal tables is technically correct.

---

## 5. SECURITY DEFINER Functions & Views Audit

### A. Functions: `auth_has_role()` & `auth_user_department_id()`
- **Vulnerability Assessment:**
  - Both functions are declared with `SECURITY DEFINER SET search_path = public, pg_temp;`. This protects against search path injection.
  - However, default PostgreSQL grants award `EXECUTE` on new functions to `PUBLIC` and `anon`.
  - An anonymous user could potentially invoke `auth_has_role('ROLE_ADMIN')` (though it safely returns `FALSE` when `auth.uid()` is null).
- **Remediation in `scripts/phase_09b_remediation.sql`:**
  ```sql
  REVOKE ALL ON FUNCTION public.auth_has_role(VARCHAR) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.auth_has_role(VARCHAR) TO authenticated, service_role;

  REVOKE ALL ON FUNCTION public.auth_user_department_id() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.auth_user_department_id() TO authenticated, service_role;
  ```

### B. Views: `recurring_complaint_clusters` & `department_sla_performance`
- **Vulnerability Assessment:**
  - Under PostgreSQL 15+, views created without explicit security attributes run under the permissions of the view owner (`SECURITY DEFINER` semantics).
  - This allows a querying user to bypass underlying table RLS policies on `complaints` when querying through the view.
- **Remediation in `scripts/phase_09b_remediation.sql`:**
  - Recreate both views with `WITH (security_invoker = true)`:
  ```sql
  DROP VIEW IF EXISTS public.recurring_complaint_clusters CASCADE;
  CREATE VIEW public.recurring_complaint_clusters
  WITH (security_invoker = true) AS ...
  ```

---

## 6. Multiple Permissive Policies Evaluation

Supabase Security Advisor notes 10 instances of "multiple permissive policies" on `complaints`:
- `p_complaints_student_select`
- `p_complaints_dept_staff_select`
- `p_complaints_management_select`

**Evaluation:**
- In PostgreSQL RLS, multiple permissive policies for the same action (`SELECT`) are combined using boolean `OR`.
- This is **deliberate and intentional** in the Campus Plus multi-role domain model:
  - A user who is both a complainant and a department handler should be able to see their own submitted complaint OR complaints assigned to their department.
  - Management users should see all complaints.
- Combining these policies into a single monolithic policy would increase code complexity and degrade maintainability without altering authorization semantics.
- **Conclusion:** Retain existing separate permissive policies.
