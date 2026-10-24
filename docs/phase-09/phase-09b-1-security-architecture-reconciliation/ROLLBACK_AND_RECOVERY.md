# 11 — Rollback & Disaster Recovery Procedures

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Target Infrastructure:** Supabase PostgreSQL 17 (`gtwpxjpmwltxwjryazcu` / `ap-northeast-1`)  
**Classification:** DISASTER RECOVERY & ROLLBACK RUNBOOK  

---

## 1. Principles of Rollback & Recovery

1. **Defense-in-Depth:** Every change proposed in `scripts/phase_09b_remediation.sql` is strictly additive. No tables or columns are dropped or renamed.
2. **Deterministic Reversibility:** Any index, policy, or view option introduced can be reverted individually without database downtime or application service interruption.
3. **Emergency Point-in-Time Recovery (PITR):** In the improbable event of data corruption or relational deadlock, Supabase automated physical WAL backups provide continuous recovery to any point within the retention window.

---

## 2. Granular Rollback Scripts for Phase 09B-2 Changes

### A. Rollback 19 Foreign Key Performance Indexes
If index creation causes unexpected write lock contention or storage bloat:
```sql
BEGIN;

DROP INDEX IF EXISTS public.idx_complaint_assignments_complaint_id;
DROP INDEX IF EXISTS public.idx_complaint_assignments_handler_id;
DROP INDEX IF EXISTS public.idx_complaint_assignments_assigned_by_id;

DROP INDEX IF EXISTS public.idx_complaint_escalations_complaint_id;
DROP INDEX IF EXISTS public.idx_complaint_escalations_escalated_by_id;

DROP INDEX IF EXISTS public.idx_complaint_forwards_complaint_id;
DROP INDEX IF EXISTS public.idx_complaint_forwards_from_dept;
DROP INDEX IF EXISTS public.idx_complaint_forwards_to_dept;
DROP INDEX IF EXISTS public.idx_complaint_forwards_forwarded_by;

DROP INDEX IF EXISTS public.idx_resolutions_complaint_id;
DROP INDEX IF EXISTS public.idx_resolutions_resolved_by;

DROP INDEX IF EXISTS public.idx_internal_notes_author;
DROP INDEX IF EXISTS public.idx_action_history_actor;

DROP INDEX IF EXISTS public.idx_department_memberships_user;
DROP INDEX IF EXISTS public.idx_department_memberships_dept;

DROP INDEX IF EXISTS public.idx_user_roles_user;
DROP INDEX IF EXISTS public.idx_user_roles_role;

DROP INDEX IF EXISTS public.idx_categories_dept;
DROP INDEX IF EXISTS public.idx_sla_policies_category;

COMMIT;
```

---

### B. Rollback Added RLS Policies on Workflow Tables
If newly added RLS policies on `complaint_assignments`, `complaint_forwards`, or `complaint_escalations` inadvertently block authorized queries:
```sql
BEGIN;

DROP POLICY IF EXISTS p_complaint_assignments_staff_select ON public.complaint_assignments;
DROP POLICY IF EXISTS p_complaint_escalations_staff_select ON public.complaint_escalations;
DROP POLICY IF EXISTS p_complaint_forwards_staff_select ON public.complaint_forwards;

COMMIT;
```

---

### C. Rollback Analytical Views to Original Definition
If `WITH (security_invoker = true)` causes unexpected permission errors for staff dashboards:
```sql
BEGIN;

DROP VIEW IF EXISTS public.recurring_complaint_clusters CASCADE;
CREATE VIEW public.recurring_complaint_clusters AS
SELECT 
    category_id,
    department_id,
    location_details,
    COUNT(id) AS complaint_count,
    MIN(created_at) AS first_reported_at,
    MAX(created_at) AS latest_reported_at,
    ARRAY_AGG(id ORDER BY created_at DESC) AS complaint_ids,
    ARRAY_AGG(ref_id ORDER BY created_at DESC) AS complaint_ref_ids
FROM public.complaints
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND status NOT IN ('REJECTED', 'DUPLICATE', 'CANCELLED')
GROUP BY category_id, department_id, location_details
HAVING COUNT(id) >= 3;

DROP VIEW IF EXISTS public.department_sla_performance CASCADE;
CREATE VIEW public.department_sla_performance AS
SELECT 
    d.id AS department_id,
    d.name AS department_name,
    COUNT(c.id) AS total_complaints,
    COUNT(c.id) FILTER (WHERE c.status IN ('RESOLVED', 'CLOSED')) AS resolved_count,
    COUNT(c.id) FILTER (WHERE c.sla_due_at < NOW() AND c.status NOT IN ('RESOLVED', 'CLOSED')) AS overdue_count,
    ROUND(
        AVG(
            EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 3600
        ) FILTER (WHERE c.resolved_at IS NOT NULL), 
        2
    ) AS avg_resolution_hours
FROM public.departments d
LEFT JOIN public.complaints c ON d.id = c.department_id
GROUP BY d.id, d.name;

COMMIT;
```

---

### D. Rollback Function Grants
If restricting function execution to `authenticated` impacts custom services:
```sql
BEGIN;

GRANT EXECUTE ON FUNCTION public.auth_has_role(VARCHAR) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_department_id() TO PUBLIC, anon;

COMMIT;
```

---

## 3. Catastrophic Disaster Recovery (PITR Restoration)

In the event of an unrecoverable failure:
1. Access the Supabase Dashboard: `https://supabase.com/dashboard/project/gtwpxjpmwltxwjryazcu`.
2. Navigate to **Database** -> **Backups**.
3. Select **Point in Time (PITR)**.
4. Select the timestamp immediately preceding deployment initiation (from Stage 1 log).
5. Initiate restore to a new branch or restore in-place.
6. Verify catalog integrity using baseline query:
   ```sql
   SELECT count(*) FROM complaints;
   ```
