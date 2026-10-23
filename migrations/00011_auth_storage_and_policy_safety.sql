-- Forward-only repair for Auth profile synchronization, private evidence storage,
-- and privilege boundaries. This remains safe in local PGlite where Supabase's
-- auth and storage schemas do not exist.

INSERT INTO roles (id, description) VALUES
  ('ROLE_STUDENT', 'Enrolled student submitting and tracking grievances')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $body$
      DECLARE
        profile_metadata jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
        derived_name text;
        requested_department text;
        department_uuid uuid;
      BEGIN
        IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
          RAISE EXCEPTION 'Campus Plus accounts require an email address';
        END IF;

        derived_name := left(COALESCE(
          NULLIF(btrim(profile_metadata->>'full_name'), ''),
          NULLIF(btrim(profile_metadata->>'name'), ''),
          split_part(NEW.email, '@', 1)
        ), 150);

        INSERT INTO public.users (id, email, full_name, roll_or_prn, is_active)
        VALUES (
          NEW.id,
          NEW.email,
          derived_name,
          NULLIF(left(btrim(profile_metadata->>'roll_or_prn'), 50), ''),
          TRUE
        )
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          roll_or_prn = COALESCE(EXCLUDED.roll_or_prn, public.users.roll_or_prn);

        -- The role is fixed here. Editable user metadata is never used to grant privileges.
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
      $body$;
    $function$;

    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()';
    EXECUTE 'REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC';

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO supabase_auth_admin';
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE $bucket$
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
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf']
    $bucket$;
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS p_storage_complaint_attachments_insert ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS p_storage_complaint_attachments_select ON storage.objects';
  END IF;

  IF to_regclass('public.recurring_complaint_clusters') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.recurring_complaint_clusters SET (security_invoker = true)';
    EXECUTE 'REVOKE ALL ON public.recurring_complaint_clusters FROM PUBLIC';
  END IF;
  IF to_regclass('public.department_sla_performance') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.department_sla_performance SET (security_invoker = true)';
    EXECUTE 'REVOKE ALL ON public.department_sla_performance FROM PUBLIC';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    IF to_regclass('public.recurring_complaint_clusters') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON public.recurring_complaint_clusters FROM anon';
    END IF;
    IF to_regclass('public.department_sla_performance') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON public.department_sla_performance FROM anon';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF to_regclass('public.recurring_complaint_clusters') IS NOT NULL THEN
      EXECUTE 'GRANT SELECT ON public.recurring_complaint_clusters TO authenticated';
    END IF;
    IF to_regclass('public.department_sla_performance') IS NOT NULL THEN
      EXECUTE 'GRANT SELECT ON public.department_sla_performance TO authenticated';
    END IF;
    IF to_regprocedure('public.auth_has_role(character varying)') IS NOT NULL THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.auth_has_role(character varying) TO authenticated';
    END IF;
    IF to_regprocedure('public.auth_user_department_id()') IS NOT NULL THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.auth_user_department_id() TO authenticated';
    END IF;
  END IF;

  IF to_regprocedure('public.auth_has_role(character varying)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.auth_has_role(character varying) FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.auth_has_role(character varying) FROM anon';
    END IF;
  END IF;
  IF to_regprocedure('public.auth_user_department_id()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.auth_user_department_id() FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.auth_user_department_id() FROM anon';
    END IF;
  END IF;
END;
$$;
