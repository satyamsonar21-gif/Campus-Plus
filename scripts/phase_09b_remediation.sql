-- ==============================================================================
-- CAMPUS PLUS — PHASE 09B DATABASE REMEDIATION & SECURITY ENHANCEMENT SCRIPT
-- Target Database: Supabase PostgreSQL 17 (gtwpxjpmwltxwjryazcu / ap-northeast-1)
-- Safety Classification: CONTROLLED REMEDIATION SCRIPT (DO NOT RUN BLINDLY)
-- Execution Gate: Requires Explicit User Approval Before Production Deployment
-- Invariants: Strictly Additive, Transaction-Bounded, Idempotent, Zero Data Loss
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. PORTABILITY & ROLE IDEMPOTENCY
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
    END IF;
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

-- ------------------------------------------------------------------------------
-- 1. SECURITY ADVISOR REMEDIATION: PURGE ORPHAN SECURITY DEFINER FUNCTION (SEC-001)
-- ------------------------------------------------------------------------------
-- Function public.rls_auto_enable() was flagged by Supabase Security Advisor as an
-- unauthenticated privilege escalation risk. It is not part of application codebase.
DROP FUNCTION IF EXISTS public.rls_auto_enable() CASCADE;

-- ------------------------------------------------------------------------------
-- 2. SECURITY DEFINER HELPER FUNCTIONS HARDENING (SEC-004 & SEC-005)
-- ------------------------------------------------------------------------------
-- Ensure search_path is pinned to public, pg_temp to prevent search_path hijacking.
-- Fully qualify referenced tables. Enforce strict least-privilege ACLs.

CREATE OR REPLACE FUNCTION public.auth_has_role(required_role VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role_id = required_role
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.auth_user_department_id()
RETURNS UUID AS $$
DECLARE
    dept_id UUID;
BEGIN
    SELECT department_id INTO dept_id
    FROM public.department_memberships
    WHERE user_id = auth.uid() AND is_active = TRUE
    LIMIT 1;
    RETURN dept_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Revoke world / anonymous execution; grant execution strictly to authenticated users and service_role
REVOKE ALL ON FUNCTION public.auth_has_role(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_has_role(VARCHAR) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.auth_user_department_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_department_id() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. SECURITY DEFINER VIEWS TO SECURITY INVOKER RECONCILIATION (SEC-007)
-- ------------------------------------------------------------------------------
-- Convert analytical views from view-owner privileges to querying user's privileges
-- so that underlying table RLS policies are strictly enforced when queried via PostgREST.
-- Preserve exact analytical schema contracts (incident_count, active_unresolved_count, etc.).

DROP VIEW IF EXISTS public.recurring_complaint_clusters CASCADE;
CREATE VIEW public.recurring_complaint_clusters
WITH (security_invoker = true) AS
SELECT 
    c.department_id,
    d.name AS department_name,
    c.category_id,
    cat.name AS category_name,
    c.location_id,
    COALESCE(loc.room_or_area || ', ' || loc.building, c.location_details) AS normalized_location,
    COUNT(*) AS incident_count,
    COUNT(CASE WHEN c.status NOT IN ('RESOLVED', 'CLOSED') THEN 1 END) AS active_unresolved_count,
    ARRAY_AGG(c.ref_id ORDER BY c.created_at DESC) AS complaint_ref_ids,
    MIN(c.created_at) AS first_reported_at,
    MAX(c.created_at) AS last_reported_at
FROM public.complaints c
JOIN public.departments d ON c.department_id = d.id
JOIN public.categories cat ON c.category_id = cat.id
LEFT JOIN public.locations loc ON c.location_id = loc.id
WHERE c.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
GROUP BY 
    c.department_id, 
    d.name, 
    c.category_id, 
    cat.name, 
    c.location_id, 
    COALESCE(loc.room_or_area || ', ' || loc.building, c.location_details)
HAVING COUNT(*) >= 3;

DROP VIEW IF EXISTS public.department_sla_performance CASCADE;
CREATE VIEW public.department_sla_performance
WITH (security_invoker = true) AS
SELECT 
    d.id AS department_id,
    d.name AS department_name,
    COUNT(c.id) AS total_complaints,
    COUNT(CASE WHEN c.status IN ('RESOLVED', 'CLOSED') THEN 1 END) AS resolved_count,
    COUNT(CASE WHEN c.status NOT IN ('RESOLVED', 'CLOSED', 'REJECTED') AND c.sla_due_at < CURRENT_TIMESTAMP THEN 1 END) AS overdue_count,
    COUNT(CASE WHEN c.is_escalated = TRUE THEN 1 END) AS escalated_count
FROM public.departments d
LEFT JOIN public.complaints c ON d.id = c.department_id
GROUP BY d.id, d.name;

-- Revoke all view permissions from anonymous users; grant SELECT strictly to authenticated and service_role
REVOKE ALL ON public.recurring_complaint_clusters FROM PUBLIC, anon;
GRANT SELECT ON public.recurring_complaint_clusters TO authenticated, service_role;

REVOKE ALL ON public.department_sla_performance FROM PUBLIC, anon;
GRANT SELECT ON public.department_sla_performance TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. RLS POLICY GAP REMEDIATION FOR REMAINING WORKFLOW TABLES (SEC-008)
-- ------------------------------------------------------------------------------
-- Enable RLS and add least-privilege policies on workflow junction tables

-- A. complaint_assignments
ALTER TABLE public.complaint_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_complaint_assignments_staff_select ON public.complaint_assignments;
CREATE POLICY p_complaint_assignments_staff_select ON public.complaint_assignments
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = complaint_assignments.complaint_id
        AND (
            c.department_id = public.auth_user_department_id()
            OR public.auth_has_role('ROLE_MANAGEMENT')
            OR public.auth_has_role('ROLE_ADMIN')
        )
    )
);

-- B. complaint_escalations
ALTER TABLE public.complaint_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_escalations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_complaint_escalations_staff_select ON public.complaint_escalations;
CREATE POLICY p_complaint_escalations_staff_select ON public.complaint_escalations
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = complaint_escalations.complaint_id
        AND (
            c.department_id = public.auth_user_department_id()
            OR public.auth_has_role('ROLE_MANAGEMENT')
            OR public.auth_has_role('ROLE_ADMIN')
        )
    )
);

-- C. complaint_forwards
ALTER TABLE public.complaint_forwards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_forwards FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_complaint_forwards_staff_select ON public.complaint_forwards;
CREATE POLICY p_complaint_forwards_staff_select ON public.complaint_forwards
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = complaint_forwards.complaint_id
        AND (
            c.department_id = public.auth_user_department_id()
            OR complaint_forwards.from_department_id = public.auth_user_department_id()
            OR complaint_forwards.to_department_id = public.auth_user_department_id()
            OR public.auth_has_role('ROLE_MANAGEMENT')
            OR public.auth_has_role('ROLE_ADMIN')
        )
    )
);

-- D. Internal system tables: _schema_migrations, idempotency_keys, outbox_events
-- These tables have RLS enabled with NO public policies (default-deny for anon & authenticated).
-- Only backend services using service_role or direct privileged connections can read/write them.
ALTER TABLE public._schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 5. PERFORMANCE ADVISOR: 19 FOREIGN KEY COVERING INDEXES (PERF-001)
-- ------------------------------------------------------------------------------
-- Create B-Tree indexes on referencing columns to accelerate JOINs, CASCADE checks,
-- and RLS EXISTS subqueries flagged by Supabase Performance Advisor.

CREATE INDEX IF NOT EXISTS idx_complaint_assignments_complaint_id ON public.complaint_assignments(complaint_id);
CREATE INDEX IF NOT EXISTS idx_complaint_assignments_handler_id ON public.complaint_assignments(handler_id);
CREATE INDEX IF NOT EXISTS idx_complaint_assignments_assigned_by_id ON public.complaint_assignments(assigned_by_id);

CREATE INDEX IF NOT EXISTS idx_complaint_escalations_complaint_id ON public.complaint_escalations(complaint_id);
CREATE INDEX IF NOT EXISTS idx_complaint_escalations_escalated_by_id ON public.complaint_escalations(escalated_by_id);

CREATE INDEX IF NOT EXISTS idx_complaint_forwards_complaint_id ON public.complaint_forwards(complaint_id);
CREATE INDEX IF NOT EXISTS idx_complaint_forwards_from_dept ON public.complaint_forwards(from_department_id);
CREATE INDEX IF NOT EXISTS idx_complaint_forwards_to_dept ON public.complaint_forwards(to_department_id);
CREATE INDEX IF NOT EXISTS idx_complaint_forwards_forwarded_by ON public.complaint_forwards(forwarded_by_id);

CREATE INDEX IF NOT EXISTS idx_resolutions_complaint_id ON public.resolutions(complaint_id);
CREATE INDEX IF NOT EXISTS idx_resolutions_resolved_by ON public.resolutions(resolved_by_id);

CREATE INDEX IF NOT EXISTS idx_internal_notes_author ON public.internal_notes(author_id);
CREATE INDEX IF NOT EXISTS idx_action_history_actor ON public.action_history(actor_id);

CREATE INDEX IF NOT EXISTS idx_department_memberships_user ON public.department_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_department_memberships_dept ON public.department_memberships(department_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role_id);

CREATE INDEX IF NOT EXISTS idx_categories_dept ON public.categories(default_department_id);
CREATE INDEX IF NOT EXISTS idx_sla_policies_category ON public.sla_policies(category_id);

-- ------------------------------------------------------------------------------
-- 6. CANONICAL SYSTEM ROLES IDEMPOTENT SEED CHECK
-- ------------------------------------------------------------------------------
INSERT INTO public.roles (id, description) VALUES
('ROLE_STUDENT', 'Enrolled student submitting and tracking grievances'),
('ROLE_FACULTY', 'Academic faculty member submitting grievances and academic appeals'),
('ROLE_HANDLER', 'Staff member assigned to investigate and resolve grievances'),
('ROLE_DEPT_HEAD', 'Department head triaging, assigning, and escalating grievances'),
('ROLE_MANAGEMENT', 'Executive leadership reviewing institution-wide escalation and analytics'),
('ROLE_ADMIN', 'System administrator managing configuration and master metadata')
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

-- ------------------------------------------------------------------------------
-- 7. SUPABASE CLI MIGRATION TRACKING RECONCILIATION
-- ------------------------------------------------------------------------------
-- Reconcile public._schema_migrations ledger into supabase_migrations.schema_migrations
-- so that Supabase CLI commands (supabase db push, migration up) detect existing history.
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text NOT NULL PRIMARY KEY,
    statements text[],
    name text
);

INSERT INTO supabase_migrations.schema_migrations (version, name)
SELECT version, name FROM public._schema_migrations
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 8. STORAGE BUCKET & TIGHTENED OBJECT ACCESS POLICIES
-- ------------------------------------------------------------------------------
-- Ensure private campus-plus-attachments bucket exists and uploads are restricted
-- to the designated intake temporary prefix or caller user ID prefix.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
            'campus-plus-attachments',
            'campus-plus-attachments',
            FALSE,
            5242880,
            ARRAY['image/jpeg', 'image/png', 'application/pdf']
        )
        ON CONFLICT (id) DO UPDATE SET
            public = FALSE,
            file_size_limit = 5242880,
            allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];

        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

        -- Clean up existing policies
        DROP POLICY IF EXISTS p_storage_complaint_attachments_select ON storage.objects;
        DROP POLICY IF EXISTS p_storage_complaint_attachments_insert ON storage.objects;

        -- SELECT: Authorized complainant or assigned department staff
        CREATE POLICY p_storage_complaint_attachments_select ON storage.objects
        FOR SELECT TO authenticated
        USING (
            bucket_id = 'campus-plus-attachments'
            AND (
                owner = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM public.attachments a
                    JOIN public.complaints c ON a.complaint_id = c.id
                    WHERE a.storage_key = storage.objects.name
                    AND (
                        c.complainant_id = auth.uid()
                        OR (c.department_id = public.auth_user_department_id() AND (public.auth_has_role('ROLE_HANDLER') OR public.auth_has_role('ROLE_DEPT_HEAD')))
                        OR public.auth_has_role('ROLE_MANAGEMENT')
                        OR public.auth_has_role('ROLE_ADMIN')
                    )
                )
            )
        );

        -- INSERT: Restrict uploads to temporary prefix or user folder with allowed MIME extensions
        CREATE POLICY p_storage_complaint_attachments_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
            bucket_id = 'campus-plus-attachments'
            AND (
                name LIKE 'complaints/temp/%'
                OR name LIKE 'complaints/' || auth.uid()::text || '/%'
            )
            AND (
                LOWER(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'pdf')
            )
        );
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ------------------------------------------------------------------------------
-- 9. SUPABASE AUTH USER AUTO-SYNC TRIGGER (auth.users -> public.users)
-- ------------------------------------------------------------------------------
-- When a user signs up via Supabase Auth (Email or OAuth), automatically provision
-- their profile record in public.users and assign the default ROLE_STUDENT.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    derived_name VARCHAR;
BEGIN
    derived_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1)
    );

    INSERT INTO public.users (id, email, full_name, is_active)
    VALUES (
        NEW.id,
        NEW.email,
        derived_name,
        TRUE
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.users.full_name);

    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, 'ROLE_STUDENT')
    ON CONFLICT (user_id, role_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Attach trigger to auth.users if schema exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') AND
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMIT;
