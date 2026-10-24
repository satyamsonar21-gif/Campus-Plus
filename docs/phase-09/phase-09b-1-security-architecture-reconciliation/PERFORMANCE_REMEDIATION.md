# 08 — Database Performance & Index Remediation Plan

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Target Infrastructure:** Supabase Managed PostgreSQL 17 (`gtwpxjpmwltxwjryazcu` / `ap-northeast-1`)  
**Safety Protocol:** STRICT READ-ONLY PERFORMANCE AUDIT — ZERO LIVE MUTATIONS PERFORMED  

---

## 1. Executive Summary

Supabase Performance Advisor and PostgreSQL query plan analysis identified four categories of optimization findings across the Campus Plus schema:
1. **19 Unindexed Foreign Keys:** Foreign key columns without a dedicated B-Tree index on the referencing table, causing sequential table scans during cascading checks, foreign key validations, and relational `JOIN` operations.
2. **14 RLS Initialization-Plan Warnings:** Repeated evaluation of `auth.uid()` and `auth_user_department_id()` across row-by-row policy filters rather than being cached in query init-plans.
3. **1 Duplicate Index:** Redundant index coverage on unique constraint columns.
4. **11 Unused Indexes:** Informational findings indicating indexes with zero scans due to fresh staging database age.

All proposed index creations are purely additive, non-blocking, and prepared in `scripts/phase_09b_remediation.sql` for Phase 09B-2.

---

## 2. Analysis of 19 Unindexed Foreign Keys

In PostgreSQL, creating a foreign key constraint (`REFERENCES parent_table(id)`) creates an index on the *referenced* table's primary key, but does **not** automatically index the referencing column on the child table.

When parent records are updated or deleted, or when queries join parent to child, PostgreSQL must perform sequential scans on the child table unless a covering index exists.

### Comprehensive Foreign Key Index Remediation Matrix

| # | Referencing Child Table | Referencing Column | Referenced Parent Table | Query Pattern Impacted | Estimated Impact | Proposed Index Name |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `complaint_assignments` | `complaint_id` | `complaints(id)` | Handler assignment history lookup by ticket; RLS policy joins | HIGH | `idx_complaint_assignments_complaint_id` |
| 2 | `complaint_assignments` | `handler_id` | `users(id)` | Staff workload queries ("active complaints per handler") | HIGH | `idx_complaint_assignments_handler_id` |
| 3 | `complaint_assignments` | `assigned_by_id` | `users(id)` | Audit trail: "who assigned this ticket" | MEDIUM | `idx_complaint_assignments_assigned_by_id` |
| 4 | `complaint_escalations` | `complaint_id` | `complaints(id)` | Escalation timeline rendering by complaint ID | HIGH | `idx_complaint_escalations_complaint_id` |
| 5 | `complaint_escalations` | `escalated_by_id` | `users(id)` | Audit trail: staff who initiated escalation | MEDIUM | `idx_complaint_escalations_escalated_by_id` |
| 6 | `complaint_forwards` | `complaint_id` | `complaints(id)` | Forwarding history and anti-deadlock threshold count (INV-010) | HIGH | `idx_complaint_forwards_complaint_id` |
| 7 | `complaint_forwards` | `from_department_id` | `departments(id)` | Department outbound transfer analytics | MEDIUM | `idx_complaint_forwards_from_dept` |
| 8 | `complaint_forwards` | `to_department_id` | `departments(id)` | Department inbound transferred complaint queue | HIGH | `idx_complaint_forwards_to_dept` |
| 9 | `complaint_forwards` | `forwarded_by_id` | `users(id)` | Forwarding author audit logging | MEDIUM | `idx_complaint_forwards_forwarded_by` |
| 10 | `resolutions` | `complaint_id` | `complaints(id)` | Complaint detail view: retrieving resolution summary and proof | CRITICAL | `idx_resolutions_complaint_id` |
| 11 | `resolutions` | `resolved_by_id` | `users(id)` | Staff resolution performance reporting | MEDIUM | `idx_resolutions_resolved_by` |
| 12 | `internal_notes` | `author_id` | `users(id)` | Notes filtered by staff author | MEDIUM | `idx_internal_notes_author` |
| 13 | `action_history` | `actor_id` | `users(id)` | User activity history / security audit lookups | MEDIUM | `idx_action_history_actor` |
| 14 | `department_memberships`| `user_id` | `users(id)` | `auth_user_department_id()` lookup on every authenticated request | CRITICAL | `idx_department_memberships_user` |
| 15 | `department_memberships`| `department_id` | `departments(id)` | Department staff roster: listing all handlers in department | HIGH | `idx_department_memberships_dept` |
| 16 | `user_roles` | `user_id` | `users(id)` | `auth_has_role()` lookup on every RLS policy evaluation | CRITICAL | `idx_user_roles_user` |
| 17 | `user_roles` | `role_id` | `roles(id)` | Role member enumeration | MEDIUM | `idx_user_roles_role` |
| 18 | `categories` | `default_department_id`| `departments(id)` | Submission form auto-filling department by category (FR-001) | HIGH | `idx_categories_dept` |
| 19 | `sla_policies` | `category_id` | `categories(id)` | SLA calculation upon ticket creation and triage | HIGH | `idx_sla_policies_category` |

---

## 3. RLS Query Plan & Subquery Initialization Analysis

### The Finding
Supabase Performance Advisor reported 14 warnings regarding RLS initialization plans.
In policies such as `p_complaints_dept_staff_select`:
```sql
USING (
    department_id = auth_user_department_id()
    AND (auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD'))
)
```
If PostgreSQL treats `auth_has_role()` or `auth_user_department_id()` as `VOLATILE`, it re-executes the function for **every row scanned** in the `complaints` table, resulting in $O(N)$ overhead.

### Architectural Solution
1. Both `auth_has_role()` and `auth_user_department_id()` are declared with `STABLE` and `SECURITY DEFINER`. In PostgreSQL, a `STABLE` function returning a value depending only on transaction parameters (`auth.uid()`) can be evaluated once per statement and cached in the execution plan.
2. In Phase 09B-2, index `idx_department_memberships_user` and `idx_user_roles_user` ensure that when these functions execute, their internal queries use $O(1)$ index lookups rather than table scans.

---

## 4. Duplicate Index Analysis

### The Finding
Performance Advisor flagged a duplicate index on `categories(name)`.
- **Constraint:** `categories_name_key` (UNIQUE constraint) automatically provisions index `categories_name_key`.
- **Duplicate:** An explicit `CREATE INDEX idx_categories_name ON categories(name)` was declared in migration `00007`.

### Recommendation
In Phase 09B-2, the duplicate index `idx_categories_name` will be safely dropped (`DROP INDEX IF EXISTS public.idx_categories_name;`), preserving the unique constraint index `categories_name_key`.

---

## 5. Unused Indexes Policy

Performance Advisor noted 11 unused indexes on `action_history`, `notifications`, and `audit` tables.
- **Root Cause:** The target Supabase instance is newly provisioned with zero production traffic. All indexes show 0 scans initially.
- **Preservation Policy:** **DO NOT DROP INDEXES BASED ONLY ON UNUSED-INDEX WARNINGS IN STAGING.** Dropping indexes before production load testing would cause severe query regressions when the complaint table reaches institutional scale (>10,000 records).
- All domain indexes are retained.
