-- ==============================================================================
-- Migration 00012: Authority Onboarding, Invitations, Verifications & Audit
-- ==============================================================================

-- 1. System Bootstrap State Table (One-time, Idempotent Initial Setup)
CREATE TABLE IF NOT EXISTS system_bootstrap_state (
    id VARCHAR(50) PRIMARY KEY,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    completed_by_operator VARCHAR(255),
    metadata JSONB DEFAULT '{}'::jsonb,
    recovery_lock BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_bootstrap_state (id, is_completed)
VALUES ('INITIAL_AUTHORITY_BOOTSTRAP', FALSE)
ON CONFLICT (id) DO NOTHING;

-- 2. Authority Audit Logs Table (Immutable Append-Only Security Journal)
CREATE TABLE IF NOT EXISTS authority_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type VARCHAR(100) NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(50),
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_email VARCHAR(255) NOT NULL,
    target_role VARCHAR(50) NOT NULL,
    target_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION trg_enforce_authority_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SECURITY VIOLATION: authority_audit_logs is an immutable append-only journal. UPDATE and DELETE are prohibited.'
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_authority_audit_no_mutation ON authority_audit_logs;
CREATE TRIGGER trg_authority_audit_no_mutation
BEFORE UPDATE OR DELETE ON authority_audit_logs
FOR EACH ROW EXECUTE FUNCTION trg_enforce_authority_audit_immutable();

-- 3. Authority Invitations Table (Single-Use, Time-Limited, Hashed Tokens)
CREATE TABLE IF NOT EXISTS authority_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    role_id VARCHAR(50) NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    department_id UUID REFERENCES departments(id) ON DELETE RESTRICT,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    invited_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    invited_by_role VARCHAR(50) NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMPTZ,
    used_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revocation_reason TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_invitation_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT chk_invitation_status CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_authority_invitations_token_hash ON authority_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_authority_invitations_email ON authority_invitations(lower(email));

-- 4. Institutional Verification Requests Table (Faculty / Handler Review Queue)
CREATE TABLE IF NOT EXISTS institutional_verification_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    employee_id VARCHAR(50) NOT NULL,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    requested_role VARCHAR(50) NOT NULL DEFAULT 'ROLE_HANDLER' REFERENCES roles(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_verification_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT chk_requested_role_unprivileged CHECK (requested_role IN ('ROLE_HANDLER', 'ROLE_FACULTY'))
);

CREATE INDEX IF NOT EXISTS idx_verification_requests_dept_status ON institutional_verification_requests(department_id, status);
CREATE INDEX IF NOT EXISTS idx_verification_requests_user ON institutional_verification_requests(user_id);

-- 5. Row-Level Security Enablement & Policies
ALTER TABLE system_bootstrap_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_bootstrap_state FORCE ROW LEVEL SECURITY;

ALTER TABLE authority_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_audit_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE authority_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_invitations FORCE ROW LEVEL SECURITY;

ALTER TABLE institutional_verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE institutional_verification_requests FORCE ROW LEVEL SECURITY;

-- Audit Log Policies: Admin and Management can select
CREATE POLICY p_authority_audit_admin_select ON authority_audit_logs
FOR SELECT TO PUBLIC
USING (
    auth_has_role('ROLE_ADMIN') OR auth_has_role('ROLE_MANAGEMENT')
);

-- Invitations Policies:
CREATE POLICY p_authority_invitations_select ON authority_invitations
FOR SELECT TO PUBLIC
USING (
    auth_has_role('ROLE_ADMIN')
    OR auth_has_role('ROLE_MANAGEMENT')
    OR (auth_has_role('ROLE_DEPT_HEAD') AND department_id = auth_user_department_id())
);

CREATE POLICY p_authority_invitations_insert ON authority_invitations
FOR INSERT TO PUBLIC
WITH CHECK (
    auth_has_role('ROLE_ADMIN')
    OR auth_has_role('ROLE_MANAGEMENT')
    OR (auth_has_role('ROLE_DEPT_HEAD') AND department_id = auth_user_department_id())
);

-- Verification Requests Policies:
CREATE POLICY p_verification_requests_select ON institutional_verification_requests
FOR SELECT TO PUBLIC
USING (
    user_id = auth.uid()
    OR auth_has_role('ROLE_ADMIN')
    OR auth_has_role('ROLE_MANAGEMENT')
    OR (auth_has_role('ROLE_DEPT_HEAD') AND department_id = auth_user_department_id())
);

CREATE POLICY p_verification_requests_insert ON institutional_verification_requests
FOR INSERT TO PUBLIC
WITH CHECK (
    user_id = auth.uid()
);

CREATE POLICY p_verification_requests_update ON institutional_verification_requests
FOR UPDATE TO PUBLIC
USING (
    auth_has_role('ROLE_ADMIN')
    OR auth_has_role('ROLE_MANAGEMENT')
    OR (auth_has_role('ROLE_DEPT_HEAD') AND department_id = auth_user_department_id())
);
