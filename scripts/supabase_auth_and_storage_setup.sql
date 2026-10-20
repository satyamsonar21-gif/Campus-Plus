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

-- Clean existing storage policies for idempotency
DROP POLICY IF EXISTS p_storage_complaint_attachments_select ON storage.objects;
DROP POLICY IF EXISTS p_storage_complaint_attachments_insert ON storage.objects;

-- Allow authenticated users and staff to download attachments associated with their complaints
CREATE POLICY p_storage_complaint_attachments_select ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'campus-plus-attachments'
    AND (
        -- User uploaded the file directly
        owner = auth.uid()
        -- OR complainant or assigned staff on the complaint
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

-- Allow authenticated users to upload to campus-plus-attachments bucket
CREATE POLICY p_storage_complaint_attachments_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'campus-plus-attachments'
);

-- ------------------------------------------------------------------------------
-- 3. SUPABASE AUTH USER AUTO-SYNC TRIGGER (auth.users -> public.users)
-- ------------------------------------------------------------------------------
-- When a new student/user signs up via Supabase Auth (Email or Google OAuth),
-- automatically create their profile record in public.users and grant ROLE_STUDENT.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    derived_name VARCHAR;
BEGIN
    -- Extract full name from Google metadata or email handle
    derived_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1)
    );

    -- 1. Insert into public directory
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

    -- 2. Assign default role ROLE_STUDENT if no role currently assigned
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, 'ROLE_STUDENT')
    ON CONFLICT (user_id, role_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
