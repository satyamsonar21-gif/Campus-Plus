-- ==============================================================================
-- CAMPUS PLUS — PRODUCTION DATABASE CONSOLIDATED INITIALIZATION SCHEMA
-- Target Database: Supabase PostgreSQL 17 (ap-northeast-1 / gtwpxjpmwltxwjryazcu)
-- Features: Full 3NF Schema (22 Base Tables, 2 Views, 1 Sequence, Triggers, RLS, Seed)
-- Safe for execution in the Supabase SQL Editor (Transaction-bounded & Idempotent)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. PRE-DEPLOYMENT SECURITY PURGE & EXTENSIONS
-- ------------------------------------------------------------------------------
-- Purge orphaned / rogue functions flagged by Supabase Security Advisor (SEC-001)
DROP FUNCTION IF EXISTS public.rls_auto_enable() CASCADE;

-- Ensure pgcrypto is available if needed (natively included in PG 13+)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Ensure standard Supabase roles exist (default on Supabase Cloud, required for local parity)
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
-- 1. MIGRATION LEDGER
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 2. ENUMERATED TYPES (Idempotent creation)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'complaint_status_enum') THEN
        CREATE TYPE complaint_status_enum AS ENUM (
            'DRAFT', 'SUBMITTED', 'REVIEWED', 'ASSIGNED', 'IN_PROGRESS', 
            'FORWARDED', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED', 
            'REJECTED', 'DUPLICATE', 'CANCELLED'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'complaint_priority_enum') THEN
        CREATE TYPE complaint_priority_enum AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'escalation_tier_enum') THEN
        CREATE TYPE escalation_tier_enum AS ENUM ('TIER_1_HANDLER', 'TIER_2_DEPARTMENT_HEAD', 'TIER_3_MANAGEMENT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attachment_type_enum') THEN
        CREATE TYPE attachment_type_enum AS ENUM ('INITIAL_EVIDENCE', 'RESOLUTION_PROOF');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_status_enum') THEN
        CREATE TYPE outbox_status_enum AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. CORE INSTITUTIONAL MASTER & REFERENCE TABLES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    contact_email VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_department_code_format CHECK (code ~ '^[A-Z0-9_-]+$')
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    default_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    requires_resolution_proof BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus VARCHAR(100) NOT NULL DEFAULT 'Main Campus',
    building VARCHAR(100) NOT NULL,
    block VARCHAR(50),
    floor VARCHAR(20),
    room_or_area VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_locations_unique_spot UNIQUE (campus, building, block, floor, room_or_area)
);

CREATE TABLE IF NOT EXISTS working_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    work_start_time TIME NOT NULL DEFAULT '09:00:00',
    work_end_time TIME NOT NULL DEFAULT '17:00:00',
    work_days_bitmask INTEGER NOT NULL DEFAULT 62, -- Monday (bit 1) through Friday (bit 5)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id UUID NOT NULL REFERENCES working_calendars(id) ON DELETE CASCADE,
    holiday_date DATE NOT NULL,
    description VARCHAR(200) NOT NULL,
    CONSTRAINT uk_calendar_holiday UNIQUE (calendar_id, holiday_date)
);

-- ------------------------------------------------------------------------------
-- 4. IDENTITY, RBAC, AND USER PROFILES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(30),
    roll_or_prn VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_user_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id VARCHAR(50) NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS department_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    is_head BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMPTZ,
    CONSTRAINT uk_active_department_membership UNIQUE (user_id, department_id, is_active)
);

-- ------------------------------------------------------------------------------
-- 5. COMPLAINT AGGREGATE ROOT & WORKFLOW ENTITIES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_id VARCHAR(32) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    complainant_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    location_details VARCHAR(255) NOT NULL,
    status complaint_status_enum NOT NULL DEFAULT 'SUBMITTED',
    suggested_priority complaint_priority_enum NOT NULL DEFAULT 'MEDIUM',
    official_priority complaint_priority_enum NOT NULL DEFAULT 'MEDIUM',
    assigned_handler_id UUID REFERENCES users(id) ON DELETE SET NULL,
    escalation_tier escalation_tier_enum NOT NULL DEFAULT 'TIER_1_HANDLER',
    is_escalated BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1,
    sla_due_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_complaint_title_len CHECK (char_length(title) >= 10 AND char_length(title) <= 120),
    CONSTRAINT chk_complaint_desc_len CHECK (char_length(description) >= 30),
    CONSTRAINT chk_complaint_version CHECK (version >= 1)
);

CREATE TABLE IF NOT EXISTS complaint_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    handler_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unassigned_at TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    reason TEXT
);

CREATE TABLE IF NOT EXISTS complaint_forwards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    from_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    to_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    forwarded_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    forward_sequence INTEGER NOT NULL DEFAULT 1,
    rationale TEXT NOT NULL,
    forwarded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_forward_diff_dept CHECK (from_department_id <> to_department_id),
    CONSTRAINT chk_forward_rationale_len CHECK (char_length(rationale) >= 10)
);

CREATE TABLE IF NOT EXISTS complaint_escalations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    from_tier escalation_tier_enum NOT NULL,
    to_tier escalation_tier_enum NOT NULL,
    escalated_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_automated BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT NOT NULL,
    escalated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS resolutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL UNIQUE REFERENCES complaints(id) ON DELETE CASCADE,
    resolved_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    resolution_summary TEXT NOT NULL,
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    student_verified BOOLEAN,
    verification_feedback TEXT,
    dispute_reason TEXT,
    disputed_at TIMESTAMPTZ,
    CONSTRAINT chk_resolution_summary_len CHECK (char_length(resolution_summary) >= 20)
);

-- ------------------------------------------------------------------------------
-- 6. SUPPORTING WORKFLOW TABLES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    storage_key VARCHAR(500) NOT NULL UNIQUE,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    attachment_type attachment_type_enum NOT NULL DEFAULT 'INITIAL_EVIDENCE',
    uploaded_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_attachment_size_limit CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880), -- 5 MB
    CONSTRAINT chk_attachment_mime_whitelist CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf'))
);

CREATE TABLE IF NOT EXISTS internal_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    author_role VARCHAR(50) NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_internal_note_len CHECK (char_length(note) >= 5)
);

CREATE TABLE IF NOT EXISTS sla_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority complaint_priority_enum NOT NULL,
    response_threshold_hours INTEGER NOT NULL,
    resolution_threshold_hours INTEGER NOT NULL,
    escalation_target_tier escalation_tier_enum NOT NULL DEFAULT 'TIER_2_DEPARTMENT_HEAD',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_category_priority_sla UNIQUE (category_id, priority),
    CONSTRAINT chk_sla_positive_hours CHECK (response_threshold_hours > 0 AND resolution_threshold_hours >= response_threshold_hours)
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    complaint_id UUID REFERENCES complaints(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 7. AUDIT JOURNAL, OUTBOX & IDEMPOTENCY TABLES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS action_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(50) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    from_status VARCHAR(50),
    to_status VARCHAR(50),
    remarks TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    status outbox_status_enum NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    request_hash VARCHAR(64) NOT NULL,
    response_code INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);

-- ------------------------------------------------------------------------------
-- 8. SEQUENCES (Concurrency-Safe Tracking Codes)
-- ------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS tracking_code_seq START WITH 1 INCREMENT BY 1;

-- ------------------------------------------------------------------------------
-- 9. TRIGGERS & SECURITY FUNCTIONS
-- ------------------------------------------------------------------------------

-- Trigger 1: Audit Journal Immutability (SEC-004 Fix: search_path pinned)
CREATE OR REPLACE FUNCTION trg_enforce_action_history_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SECURITY VIOLATION: action_history is an immutable append-only journal. UPDATE and DELETE are prohibited.'
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_action_history_no_mutation ON action_history;
CREATE TRIGGER trg_action_history_no_mutation
BEFORE UPDATE OR DELETE ON action_history
FOR EACH ROW EXECUTE FUNCTION trg_enforce_action_history_immutable();

-- Trigger 2: Closed Complaint Immutability (DEF-BIZ-002 Fix)
CREATE OR REPLACE FUNCTION trg_enforce_complaint_closed_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'CLOSED' THEN
        RAISE EXCEPTION 'BUSINESS INVARIANT VIOLATION: Complaint % in CLOSED status is permanently immutable.', OLD.ref_id
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_complaints_no_closed_mutation ON complaints;
CREATE TRIGGER trg_complaints_no_closed_mutation
BEFORE UPDATE ON complaints
FOR EACH ROW EXECUTE FUNCTION trg_enforce_complaint_closed_immutable();

-- Trigger 3: Maximum 3 Attachments per Complaint (DEF-BIZ-003 Fix)
CREATE OR REPLACE FUNCTION trg_enforce_attachment_count_limit()
RETURNS TRIGGER AS $$
DECLARE
    current_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO current_count FROM attachments WHERE complaint_id = NEW.complaint_id;
    IF current_count >= 3 THEN
        RAISE EXCEPTION 'BUSINESS INVARIANT VIOLATION: Maximum 3 attachments allowed per complaint (BR-06).'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_attachments_max_three ON attachments;
CREATE TRIGGER trg_attachments_max_three
BEFORE INSERT ON attachments
FOR EACH ROW EXECUTE FUNCTION trg_enforce_attachment_count_limit();

-- ------------------------------------------------------------------------------
-- 10. PERFORMANCE INDEXES
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaints_ref_id ON complaints (ref_id);
CREATE INDEX IF NOT EXISTS idx_complaints_student_list ON complaints (complainant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_dept_queue ON complaints (department_id, status, official_priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_handler_queue ON complaints (assigned_handler_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_sla_overdue ON complaints (status, sla_due_at) WHERE status NOT IN ('RESOLVED', 'CLOSED', 'REJECTED');
CREATE INDEX IF NOT EXISTS idx_complaints_escalation_queue ON complaints (escalation_tier, department_id, created_at DESC) WHERE is_escalated = TRUE;
CREATE INDEX IF NOT EXISTS idx_complaints_recurring_hotspots ON complaints (department_id, category_id, location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_action_history_timeline ON action_history (complaint_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON notifications (recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events (status, created_at ASC) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_attachments_complaint ON attachments (complaint_id);
CREATE INDEX IF NOT EXISTS idx_internal_notes_complaint ON internal_notes (complaint_id);

-- ------------------------------------------------------------------------------
-- 11. ANALYTICAL VIEWS
-- ------------------------------------------------------------------------------
-- 11. ANALYTICAL VIEWS (SECURITY INVOKER ENABLED)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW recurring_complaint_clusters
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
FROM complaints c
JOIN departments d ON c.department_id = d.id
JOIN categories cat ON c.category_id = cat.id
LEFT JOIN locations loc ON c.location_id = loc.id
WHERE c.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
GROUP BY 
    c.department_id, d.name, c.category_id, cat.name, c.location_id, 
    COALESCE(loc.room_or_area || ', ' || loc.building, c.location_details)
HAVING COUNT(*) >= 3;

CREATE OR REPLACE VIEW department_sla_performance
WITH (security_invoker = true) AS
SELECT 
    d.id AS department_id,
    d.name AS department_name,
    COUNT(c.id) AS total_complaints,
    COUNT(CASE WHEN c.status IN ('RESOLVED', 'CLOSED') THEN 1 END) AS resolved_count,
    COUNT(CASE WHEN c.status NOT IN ('RESOLVED', 'CLOSED', 'REJECTED') AND c.sla_due_at < CURRENT_TIMESTAMP THEN 1 END) AS overdue_count,
    COUNT(CASE WHEN c.is_escalated = TRUE THEN 1 END) AS escalated_count
FROM departments d
LEFT JOIN complaints c ON d.id = c.department_id
GROUP BY d.id, d.name;

-- Analytical view ACLs: Restrict anonymous access; grant to authenticated and service_role
REVOKE ALL ON recurring_complaint_clusters FROM PUBLIC, anon;
GRANT SELECT ON recurring_complaint_clusters TO authenticated, service_role;

REVOKE ALL ON department_sla_performance FROM PUBLIC, anon;
GRANT SELECT ON department_sla_performance TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 12. ROW-LEVEL SECURITY (RLS) POLICIES & HELPER FUNCTIONS
-- ------------------------------------------------------------------------------

-- Portability shim for auth.uid()
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
        CREATE SCHEMA auth;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
    ) THEN
        EXECUTE $fn$
            CREATE FUNCTION auth.uid() RETURNS UUID AS $f$
            BEGIN
                RETURN COALESCE(
                    NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID,
                    NULLIF(current_setting('app.current_user_id', true), '')::UUID
                );
            EXCEPTION WHEN OTHERS THEN RETURN NULL;
            END;
            $f$ LANGUAGE plpgsql STABLE;
        $fn$;
    END IF;
EXCEPTION WHEN duplicate_schema OR insufficient_privilege THEN NULL;
END $$;

-- RBAC Role Evaluator
CREATE OR REPLACE FUNCTION auth_has_role(required_role VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid() AND role_id = required_role
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Active Department Membership Evaluator
CREATE OR REPLACE FUNCTION auth_user_department_id()
RETURNS UUID AS $$
DECLARE
    dept_id UUID;
BEGIN
    SELECT department_id INTO dept_id
    FROM department_memberships
    WHERE user_id = auth.uid() AND is_active = TRUE
    LIMIT 1;
    RETURN dept_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- SEC-005 Fix: Restrict stored RPC execute privileges from anonymous roles
REVOKE ALL ON FUNCTION auth_has_role(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auth_has_role(VARCHAR) TO authenticated, service_role;

REVOKE ALL ON FUNCTION auth_user_department_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auth_user_department_id() TO authenticated, service_role;

-- ENABLE AND FORCE RLS ACROSS ALL 22 BASE TABLES
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints FORCE ROW LEVEL SECURITY;

ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_notes FORCE ROW LEVEL SECURITY;

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;

ALTER TABLE action_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_history FORCE ROW LEVEL SECURITY;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

-- SEC-002 Fix: Enable RLS on users table (PII Protection)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- SEC-003 Fix: Enable RLS on remaining workflow & reference tables
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE department_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE complaint_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE complaint_forwards ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_forwards FORCE ROW LEVEL SECURITY;

ALTER TABLE complaint_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_escalations FORCE ROW LEVEL SECURITY;

ALTER TABLE resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolutions FORCE ROW LEVEL SECURITY;

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE working_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE _schema_migrations ENABLE ROW LEVEL SECURITY;

-- Clean existing policies for idempotency
DO $$ 
DECLARE pol RECORD;
BEGIN
    FOR pol IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- 1. Policies on users (SEC-002)
CREATE POLICY p_users_self_select ON users FOR SELECT TO PUBLIC
USING (id = auth.uid() OR auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD') OR auth_has_role('ROLE_MANAGEMENT') OR auth_has_role('ROLE_ADMIN'));

CREATE POLICY p_users_self_update ON users FOR UPDATE TO PUBLIC
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 2. Policies on complaints
CREATE POLICY p_complaints_student_select ON complaints FOR SELECT TO PUBLIC
USING (complainant_id = auth.uid());

CREATE POLICY p_complaints_dept_staff_select ON complaints FOR SELECT TO PUBLIC
USING (department_id = auth_user_department_id() AND (auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD')));

CREATE POLICY p_complaints_management_select ON complaints FOR SELECT TO PUBLIC
USING (auth_has_role('ROLE_MANAGEMENT') OR auth_has_role('ROLE_ADMIN'));

CREATE POLICY p_complaints_student_insert ON complaints FOR INSERT TO PUBLIC
WITH CHECK (complainant_id = auth.uid() AND status = 'SUBMITTED');

CREATE POLICY p_complaints_handler_update ON complaints FOR UPDATE TO PUBLIC
USING (department_id = auth_user_department_id() AND assigned_handler_id = auth.uid() AND auth_has_role('ROLE_HANDLER'));

CREATE POLICY p_complaints_dept_head_update ON complaints FOR UPDATE TO PUBLIC
USING (department_id = auth_user_department_id() AND auth_has_role('ROLE_DEPT_HEAD'));

-- 3. Policies on internal_notes (Zero Student Visibility)
CREATE POLICY p_internal_notes_staff_select ON internal_notes FOR SELECT TO PUBLIC
USING (
    (EXISTS (SELECT 1 FROM complaints c WHERE c.id = internal_notes.complaint_id AND c.department_id = auth_user_department_id()) AND (auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD')))
    OR auth_has_role('ROLE_MANAGEMENT') OR auth_has_role('ROLE_ADMIN')
);

CREATE POLICY p_internal_notes_staff_insert ON internal_notes FOR INSERT TO PUBLIC
WITH CHECK (
    author_id = auth.uid() AND (auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD') OR auth_has_role('ROLE_MANAGEMENT') OR auth_has_role('ROLE_ADMIN'))
);

-- 4. Policies on attachments
CREATE POLICY p_attachments_select ON attachments FOR SELECT TO PUBLIC
USING (
    EXISTS (
        SELECT 1 FROM complaints c WHERE c.id = attachments.complaint_id
        AND (c.complainant_id = auth.uid() OR (c.department_id = auth_user_department_id() AND (auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD'))) OR auth_has_role('ROLE_MANAGEMENT') OR auth_has_role('ROLE_ADMIN'))
    )
);

CREATE POLICY p_attachments_insert ON attachments FOR INSERT TO PUBLIC
WITH CHECK (uploaded_by_id = auth.uid());

-- 5. Policies on notifications
CREATE POLICY p_notifications_select ON notifications FOR SELECT TO PUBLIC USING (recipient_id = auth.uid());
CREATE POLICY p_notifications_update ON notifications FOR UPDATE TO PUBLIC USING (recipient_id = auth.uid());

-- 6. Policies on action_history
CREATE POLICY p_action_history_select ON action_history FOR SELECT TO PUBLIC
USING (
    EXISTS (
        SELECT 1 FROM complaints c WHERE c.id = action_history.complaint_id
        AND (c.complainant_id = auth.uid() OR (c.department_id = auth_user_department_id() AND (auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD'))) OR auth_has_role('ROLE_MANAGEMENT') OR auth_has_role('ROLE_ADMIN'))
    )
);

-- 7. Policies on resolutions
CREATE POLICY p_resolutions_select ON resolutions FOR SELECT TO PUBLIC
USING (
    EXISTS (
        SELECT 1 FROM complaints c WHERE c.id = resolutions.complaint_id
        AND (c.complainant_id = auth.uid() OR (c.department_id = auth_user_department_id() AND (auth_has_role('ROLE_HANDLER') OR auth_has_role('ROLE_DEPT_HEAD'))) OR auth_has_role('ROLE_MANAGEMENT') OR auth_has_role('ROLE_ADMIN'))
    )
);

-- 8. Policies on reference tables (Read-only for authenticated users)
CREATE POLICY p_departments_select ON departments FOR SELECT TO PUBLIC USING (true);
CREATE POLICY p_categories_select ON categories FOR SELECT TO PUBLIC USING (true);
CREATE POLICY p_locations_select ON locations FOR SELECT TO PUBLIC USING (true);
CREATE POLICY p_working_calendars_select ON working_calendars FOR SELECT TO PUBLIC USING (true);
CREATE POLICY p_calendar_holidays_select ON calendar_holidays FOR SELECT TO PUBLIC USING (true);
CREATE POLICY p_roles_select ON roles FOR SELECT TO PUBLIC USING (true);
CREATE POLICY p_sla_policies_select ON sla_policies FOR SELECT TO PUBLIC USING (true);
CREATE POLICY p_user_roles_select ON user_roles FOR SELECT TO PUBLIC USING (user_id = auth.uid() OR auth_has_role('ROLE_ADMIN'));
CREATE POLICY p_department_memberships_select ON department_memberships FOR SELECT TO PUBLIC USING (user_id = auth.uid() OR auth_has_role('ROLE_DEPT_HEAD') OR auth_has_role('ROLE_ADMIN'));

-- ------------------------------------------------------------------------------
-- 13. MASTER REFERENCE DATA SEEDING (Seed 001 with ROLE_FACULTY fix)
-- ------------------------------------------------------------------------------
INSERT INTO roles (id, description) VALUES
('ROLE_STUDENT', 'Enrolled student submitting and tracking grievances'),
('ROLE_FACULTY', 'Academic faculty member submitting grievances and academic appeals'),
('ROLE_HANDLER', 'Staff member assigned to investigate and resolve grievances'),
('ROLE_DEPT_HEAD', 'Department head triaging, assigning, and escalating grievances'),
('ROLE_MANAGEMENT', 'Executive leadership reviewing institution-wide escalation and analytics'),
('ROLE_ADMIN', 'System administrator managing configuration and master metadata')
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO departments (id, code, name, description, contact_email) VALUES
('00000000-0000-0000-0000-000000000010', 'DEPT-IT', 'Information Technology', 'Campus network, Wi-Fi, computer labs, and portal systems', 'it-support@synthetic.campusplus.internal'),
('00000000-0000-0000-0000-000000000020', 'DEPT-HOSTEL', 'Hostel Administration', 'Hostel rooms, mess dining, water, and resident welfare', 'hostel-admin@synthetic.campusplus.internal'),
('00000000-0000-0000-0000-000000000030', 'DEPT-MAINT', 'Campus Maintenance', 'Electrical fixtures, plumbing, civil repairs, and air conditioning', 'maintenance@synthetic.campusplus.internal'),
('00000000-0000-0000-0000-000000000040', 'DEPT-ACAD', 'Academic Affairs', 'Curriculum, timetable, grade disputes, and faculty coordination', 'academic-affairs@synthetic.campusplus.internal'),
('00000000-0000-0000-0000-000000000050', 'DEPT-SANIT', 'Sanitation & Hygiene', 'Restroom cleanliness, waste disposal, and campus hygiene', 'sanitation@synthetic.campusplus.internal')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO categories (id, name, description, default_department_id, requires_resolution_proof) VALUES
('00000000-0000-0000-0000-000000000101', 'Network & Wi-Fi', 'Internet connectivity drops, router failure, portal login issues', '00000000-0000-0000-0000-000000000010', FALSE),
('00000000-0000-0000-0000-000000000102', 'Hostel Room Maintenance', 'Broken furniture, plumbing leaks, electrical faults in hostels', '00000000-0000-0000-0000-000000000020', TRUE),
('00000000-0000-0000-0000-000000000103', 'Classroom Infrastructure', 'Projectors, whiteboards, air conditioning, and seating repairs', '00000000-0000-0000-0000-000000000030', TRUE),
('00000000-0000-0000-0000-000000000104', 'Academic Evaluation', 'Evaluation discrepancies, attendance logging, timetable overlap', '00000000-0000-0000-0000-000000000040', FALSE),
('00000000-0000-0000-0000-000000000105', 'Campus Sanitation', 'Dirty restrooms, uncollected trash, water cooler hygiene', '00000000-0000-0000-0000-000000000050', TRUE)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, requires_resolution_proof = EXCLUDED.requires_resolution_proof;

INSERT INTO locations (id, campus, building, block, floor, room_or_area) VALUES
('00000000-0000-0000-0000-000000000201', 'Main Campus', 'Central Library', 'East Wing', '2nd Floor', 'Reading Hall A'),
('00000000-0000-0000-0000-000000000202', 'Main Campus', 'Hostel Block 4', 'A Block', '3rd Floor', 'Room 312'),
('00000000-0000-0000-0000-000000000203', 'Main Campus', 'Academic Complex', 'CS Block', 'Ground Floor', 'Lab 102')
ON CONFLICT DO NOTHING;

INSERT INTO working_calendars (id, name, timezone, work_start_time, work_end_time, work_days_bitmask) VALUES
('00000000-0000-0000-0000-000000000301', 'Main Academic Calendar', 'Asia/Kolkata', '09:00:00', '17:00:00', 62)
ON CONFLICT (name) DO NOTHING;

INSERT INTO sla_policies (id, category_id, priority, response_threshold_hours, resolution_threshold_hours, escalation_target_tier) VALUES
('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000101', 'LOW', 48, 168, 'TIER_2_DEPARTMENT_HEAD'),
('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000101', 'MEDIUM', 24, 72, 'TIER_2_DEPARTMENT_HEAD'),
('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000101', 'HIGH', 12, 24, 'TIER_3_MANAGEMENT'),
('00000000-0000-0000-0000-000000000404', '00000000-0000-0000-0000-000000000101', 'URGENT', 4, 12, 'TIER_3_MANAGEMENT')
ON CONFLICT (category_id, priority) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 14. REGISTER MIGRATIONS IN LEDGER
-- ------------------------------------------------------------------------------
INSERT INTO _schema_migrations (version, name, checksum) VALUES
('00001', '00001_initial_types_and_extensions', 'applied_via_consolidated_script'),
('00002', '00002_core_institutional_tables', 'applied_via_consolidated_script'),
('00003', '00003_identity_and_access_tables', 'applied_via_consolidated_script'),
('00004', '00004_complaint_aggregate_tables', 'applied_via_consolidated_script'),
('00005', '00005_supporting_workflow_tables', 'applied_via_consolidated_script'),
('00006', '00006_audit_and_outbox_tables', 'applied_via_consolidated_script'),
('00007', '00007_indexes_and_performance', 'applied_via_consolidated_script'),
('00008', '00008_row_level_security_policies', 'applied_via_consolidated_script'),
('00009', '00009_analytical_views', 'applied_via_consolidated_script'),
('00010', '00010_tracking_code_sequence', 'applied_via_consolidated_script')
ON CONFLICT (version) DO NOTHING;

COMMIT;
