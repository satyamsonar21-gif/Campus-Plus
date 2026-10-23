-- ==============================================================================
-- CAMPUS PLUS — SUPABASE AUTH & STORAGE PRODUCTION INITIALIZATION SCRIPT
-- Target: Supabase Cloud (Project: gtwpxjpmwltxwjryazcu / ap-northeast-1)
-- Run this in the Supabase SQL Editor after running supabase_consolidated_schema.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PROVISION PRIVATE STORAGE BUCKET: campus-plus-attachments
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'campus-plus-attachments',
    'campus-plus-attachments',
    FALSE, -- Strictly private
    5242880, -- 5 MB (5,242,880 bytes)
    ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];

-- ------------------------------------------------------------------------------
-- 2. STORAGE RLS POLICIES (storage.objects)
-- ------------------------------------------------------------------------------
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Signed URLs are created by the server with its service role key. Do not add
-- direct authenticated INSERT/SELECT policies to this private bucket.
DROP POLICY IF EXISTS p_storage_complaint_attachments_select ON storage.objects;
DROP POLICY IF EXISTS p_storage_complaint_attachments_insert ON storage.objects;

-- ------------------------------------------------------------------------------
-- 3. SUPABASE AUTH USER AUTO-SYNC TRIGGER (auth.users -> public.users)
-- ------------------------------------------------------------------------------
-- When a new student/user signs up via Supabase Auth (Email or Google OAuth),
-- automatically create their profile record in public.users and grant ROLE_STUDENT.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    profile_metadata jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
    derived_name text;
    requested_department text;
    department_uuid uuid;
BEGIN
    derived_name := COALESCE(
        NULLIF(btrim(profile_metadata->>'full_name'), ''),
        NULLIF(btrim(profile_metadata->>'name'), ''),
        split_part(NEW.email, '@', 1)
    );

    INSERT INTO public.users (id, email, full_name, roll_or_prn, is_active)
    VALUES (
        NEW.id,
        NEW.email,
        left(derived_name, 150),
        NULLIF(left(btrim(profile_metadata->>'roll_or_prn'), 50), ''),
        TRUE
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        roll_or_prn = COALESCE(EXCLUDED.roll_or_prn, public.users.roll_or_prn);

    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, 'ROLE_STUDENT')
    ON CONFLICT (user_id, role_id) DO NOTHING;

    requested_department := NULLIF(btrim(profile_metadata->>'department_id'), '');
    IF requested_department IS NOT NULL THEN
        IF requested_department !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'Invalid department selected during student registration';
        END IF;
        department_uuid := requested_department::uuid;
        INSERT INTO public.department_memberships (user_id, department_id, is_head, is_active)
        SELECT NEW.id, d.id, FALSE, TRUE
        FROM public.departments d
        WHERE d.id = department_uuid AND d.is_active = TRUE
        ON CONFLICT (user_id, department_id, is_active) DO NOTHING;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected department is unavailable';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO supabase_auth_admin;
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. ANALYTICS VIEW AND SECURITY HELPER PRIVILEGES
-- ------------------------------------------------------------------------------
ALTER VIEW public.recurring_complaint_clusters SET (security_invoker = TRUE);
ALTER VIEW public.department_sla_performance SET (security_invoker = TRUE);
REVOKE ALL ON public.recurring_complaint_clusters FROM PUBLIC;
REVOKE ALL ON public.department_sla_performance FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_has_role(VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_department_id() FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON public.recurring_complaint_clusters FROM anon;
        REVOKE ALL ON public.department_sla_performance FROM anon;
        REVOKE ALL ON FUNCTION public.auth_has_role(VARCHAR) FROM anon;
        REVOKE ALL ON FUNCTION public.auth_user_department_id() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.recurring_complaint_clusters TO authenticated;
        GRANT SELECT ON public.department_sla_performance TO authenticated;
        GRANT EXECUTE ON FUNCTION public.auth_has_role(VARCHAR) TO authenticated;
        GRANT EXECUTE ON FUNCTION public.auth_user_department_id() TO authenticated;
    END IF;
END;
$$;
