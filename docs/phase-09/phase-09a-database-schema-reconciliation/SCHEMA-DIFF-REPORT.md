# Schema Diff & Object-by-Object Reconciliation Report

**Project:** Campus Plus — Database Reconciliation  
**Target Environment:** Supabase (`gtwpxjpmwltxwjryazcu`) vs Repository (`migrations/00001`–`00010`)  
**Audit Phase:** Phase 09A  
**Total Identified Schema Mismatches:** 37 Discrete Objects / Object Classes  

---

## 1. Schema Reconciliation Matrix Overview

| Relational Object Category | Repository (Expected) | Live Supabase (Actual) | Net Variance | Reconciliation Classification |
| :--- | :---: | :---: | :---: | :--- |
| **Base Tables** | 22 | 0 | -22 | **Missing on Live** |
| **Analytical Views** | 2 | 0 | -2 | **Missing on Live** |
| **Database Sequences** | 1 | 0 | -1 | **Missing on Live** |
| **Domain ENUM Types** | 5 | 0 | -5 | **Missing on Live** |
| **Stored Functions** | 4 | 1 | -4 / +1 | **4 Missing / 1 Rogue on Live** |
| **Triggers** | 1 | 0 | -1 | **Missing on Live** |
| **Performance Indexes** | 45 | 0 | -45 | **Missing on Live** |
| **Row-Level Security Policies** | 13 | 0 | -13 | **Missing on Live** |
| **Storage Buckets** | 1 | 0 | -1 | **Missing on Live & DDL** |

---

## 2. Object-by-Object Relational Differences

### A. Enumerated Domain Types (5 Missing)
1. `complaint_status_enum`: Defines 13 canonical states (`DRAFT`, `SUBMITTED`, `REVIEWED`, `ASSIGNED`, `IN_PROGRESS`, `FORWARDED`, `ESCALATED`, `RESOLVED`, `CLOSED`, `REOPENED`, `REJECTED`, `DUPLICATE`, `CANCELLED`).
   - *Status on Live:* **MISSING**.
2. `complaint_priority_enum`: Defines 4 tiers (`LOW`, `MEDIUM`, `HIGH`, `URGENT`).
   - *Status on Live:* **MISSING**.
3. `escalation_tier_enum`: Defines 3 tiers (`TIER_1_HANDLER`, `TIER_2_DEPARTMENT_HEAD`, `TIER_3_MANAGEMENT`).
   - *Status on Live:* **MISSING**.
4. `attachment_type_enum`: Defines 2 classifications (`INITIAL_EVIDENCE`, `RESOLUTION_PROOF`).
   - *Status on Live:* **MISSING**.
5. `outbox_status_enum`: Defines 4 states (`PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`).
   - *Status on Live:* **MISSING**.

---

### B. Base Tables (22 Missing)

| Table Name | Defined in Migration | Primary Key | Foreign Key Dependencies | Status on Live |
| :--- | :---: | :---: | :--- | :---: |
| `_schema_migrations` | `00001` | `version` (VARCHAR) | None | **MISSING** |
| `departments` | `00002` | `id` (UUID) | None | **MISSING** |
| `categories` | `00002` | `id` (UUID) | `default_department_id` -> `departments` | **MISSING** |
| `locations` | `00002` | `id` (UUID) | None | **MISSING** |
| `working_calendars` | `00002` | `id` (UUID) | None | **MISSING** |
| `calendar_holidays` | `00002` | `id` (UUID) | `calendar_id` -> `working_calendars` | **MISSING** |
| `roles` | `00003` | `id` (VARCHAR) | None | **MISSING** |
| `users` | `00003` | `id` (UUID) | None | **MISSING** |
| `user_roles` | `00003` | (`user_id`, `role_id`) | `users`, `roles` | **MISSING** |
| `department_memberships` | `00003` | `id` (UUID) | `users`, `departments` | **MISSING** |
| `complaints` | `00004` | `id` (UUID) | `users`, `departments`, `categories`, `locations` | **MISSING** |
| `complaint_assignments` | `00004` | `id` (UUID) | `complaints`, `users` | **MISSING** |
| `complaint_forwards` | `00004` | `id` (UUID) | `complaints`, `departments`, `users` | **MISSING** |
| `complaint_escalations` | `00004` | `id` (UUID) | `complaints`, `users` | **MISSING** |
| `resolutions` | `00004` | `id` (UUID) | `complaints`, `users` | **MISSING** |
| `attachments` | `00005` | `id` (UUID) | `complaints`, `users` | **MISSING** |
| `internal_notes` | `00005` | `id` (UUID) | `complaints`, `users` | **MISSING** |
| `sla_policies` | `00005` | `id` (UUID) | `categories` | **MISSING** |
| `notifications` | `00005` | `id` (UUID) | `users`, `complaints` | **MISSING** |
| `action_history` | `00006` | `id` (UUID) | `complaints`, `users` | **MISSING** |
| `outbox_events` | `00006` | `id` (UUID) | None | **MISSING** |
| `idempotency_keys` | `00006` | `key` (VARCHAR) | None | **MISSING** |

---

### C. Analytical Views (2 Missing)
1. `recurring_complaint_clusters`:
   - Aggregates complaints by department, category, and location where incident count >= 3 in the trailing 30 days.
   - *Status on Live:* **MISSING**.
2. `department_sla_performance`:
   - Summarizes total, resolved, overdue, and escalated grievances grouped by department.
   - *Status on Live:* **MISSING**.

---

### D. Sequences (1 Missing)
1. `tracking_code_seq`:
   - Sequence allocated starting at 1 with increment 1 for format `CP-YYYY-XXXXX`.
   - *Status on Live:* **MISSING**.

---

### E. Stored Functions & Triggers (4 Missing, 1 Rogue)
1. `trg_enforce_action_history_immutable()`:
   - Blocks UPDATE and DELETE on `action_history`.
   - *Status on Live:* **MISSING**.
2. Trigger `trg_action_history_no_mutation`:
   - Bound to `action_history`.
   - *Status on Live:* **MISSING**.
3. `auth.uid()`:
   - Portability shim extracting user UUID from JWT claims or session variables.
   - *Status on Live:* Supabase native `auth.uid()` exists in schema `auth`.
4. `auth_has_role(required_role VARCHAR)`:
   - Evaluates RBAC role membership for the active user.
   - *Status on Live:* **MISSING**.
5. `auth_user_department_id()`:
   - Resolves active department membership for the active user.
   - *Status on Live:* **MISSING**.
6. **Rogue Function on Live:** `public.rls_auto_enable()`:
   - Exists on live database with `SECURITY DEFINER` and execute granted to `anon`/`authenticated`.
   - Absent from repository migrations.
   - *Status:* **EXTRA / DRIFT / CRITICAL SECURITY VULNERABILITY (SEC-001)**.

---

### F. Row-Level Security Policies (13 Missing)
1. `p_complaints_student_select` on `complaints` (MISSING)
2. `p_complaints_dept_staff_select` on `complaints` (MISSING)
3. `p_complaints_management_select` on `complaints` (MISSING)
4. `p_complaints_student_insert` on `complaints` (MISSING)
5. `p_complaints_handler_update` on `complaints` (MISSING)
6. `p_complaints_dept_head_update` on `complaints` (MISSING)
7. `p_internal_notes_staff_select` on `internal_notes` (MISSING)
8. `p_internal_notes_staff_insert` on `internal_notes` (MISSING)
9. `p_attachments_select` on `attachments` (MISSING)
10. `p_attachments_insert` on `attachments` (MISSING)
11. `p_notifications_select` on `notifications` (MISSING)
12. `p_notifications_update` on `notifications` (MISSING)
13. `p_action_history_select` on `action_history` (MISSING)

---

### G. Supabase Storage Buckets (1 Missing)
- `campus-plus-attachments`:
  - Required for complaint evidence and resolution proof documents.
  - *Status on Live:* **MISSING**.
  - *Status in Repo DDL:* **MISSING** (Referenced only in `.env.local` and application code, zero DDL declared).

---

## 3. Schema Reconciliation Conclusions

The target database `gtwpxjpmwltxwjryazcu` represents a completely unprovisioned PostgreSQL 17 instance with no application tables, views, or migrations applied.
Before deployment can proceed:
1. The rogue function `public.rls_auto_enable()` must be purged.
2. Migrations `00001` through `00010` must be sequenced and executed in strict numerical order.
3. Identified security flaws in migration `00008` (unprotected `users` table) must be patched prior to deployment.
