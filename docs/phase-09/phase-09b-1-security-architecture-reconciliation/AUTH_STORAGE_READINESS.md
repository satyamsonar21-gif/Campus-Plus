# 07 — Authentication, Role Onboarding & Storage Readiness Specification

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Subsystem:** Authentication, Identity Management, Five-Role Onboarding & Supabase Storage  
**Date:** 2026-10-20  
**Classification:** ARCHITECTURAL SPECIFICATION & READINESS AUDIT  

---

## 1. Authentication Architecture Audit

### A. Current Implementation State
- **Login (`src/app/login/`, `src/presentation/components/auth/SignInForm.tsx`):**
  - Uses `supabase.auth.signInWithPassword()` against Supabase Auth.
  - Granular error classification implemented: distinguishes `INVALID_CREDENTIALS`, `EMAIL_NOT_CONFIRMED`, `ACCOUNT_INACTIVE`, `IDENTITY_NOT_PROVISIONED`, and `NETWORK_FAILURE`.
- **Actor Resolution (`src/presentation/context/AuthContext.tsx`):**
  - Following Supabase session establishment, the client invokes `GET /api/v1/auth/me`.
  - The server inspects the JWT, validates the user against `public.users` and `public.user_roles`, and returns the verified technical role (`ROLE_STUDENT`, `ROLE_FACULTY`, `ROLE_HANDLER`, `ROLE_DEPT_HEAD`, `ROLE_MANAGEMENT`, `ROLE_ADMIN`) and department scope.
- **Intake / Registration (`src/presentation/components/auth/RoleRegistrationForm.tsx`):**
  - Collects role-specific institutional intake requests across the 5 public personas.
  - Submitting intake transitions to `Account Request Submitted` / `Institutional Verification Required` (`IAM-REG-PENDING`).
  - Does NOT automatically redirect unprovisioned users to `/login`.

### B. The Open Backend Blocker: `BCR-AUTH-001`
- Campus Plus currently does **not** have a public self-service registration API (`POST /api/v1/auth/register`).
- In educational institutions, privileged accounts (Faculty, HOD, Director, Management) must be verified through institutional rosters or HR directories rather than self-granting access.
- `BCR-AUTH-001` remains **OPEN** as an intentional architectural gate.

---

## 2. Google OAuth Integration Readiness

### A. Architecture Design
1. **Frontend Initiation (`SignInForm.tsx`):**
   ```typescript
   const { data, error } = await supabase.auth.signInWithOAuth({
     provider: "google",
     options: {
       redirectTo: `${window.location.origin}/auth/callback`,
       queryParams: {
         hd: "college.edu", // Optional: restrict to institutional domain
       },
     },
   });
   ```
2. **Next.js Auth Callback Route (`src/app/auth/callback/route.ts`):**
   - Intercepts OAuth code grant from Supabase.
   - Exchanges code for session via `@supabase/ssr` / browser adapter.
   - Redirects to `/dashboard` where `AuthContext` resolves actor role.
3. **Supabase Cloud Dashboard Requirements:**
   - In Supabase Project Settings -> Authentication -> Providers -> Google:
     - Enable Google provider.
     - Add Google Client ID and Google Client Secret (from Google Cloud Console).
     - Configure Authorized Redirect URI: `https://gtwpxjpmwltxwjryazcu.supabase.co/auth/v1/callback`.

---

## 3. Five-Role Onboarding & Server Authorization Constraints

### The Non-Negotiable Principle: Client Role Isolation
The frontend client may **REQUEST** a persona or fill an intake form. The frontend client must **NEVER** be trusted to grant itself a role.

### Technical Role vs Public Persona Matrix

| Public Persona | Technical Role Code | Authorization Mechanism | Auto-Provisioning Permitted? | Approval Workflow Required? |
| :--- | :--- | :--- | :---: | :---: |
| **Student** | `ROLE_STUDENT` | Supabase Auth Email/OAuth + Database Sync | **YES** (Default Role) | No (Subject to institutional email confirmation) |
| **Faculty / Complaint Handler** | `ROLE_FACULTY` / `ROLE_HANDLER` | Department Head or Admin Provisioning | **NO** | **YES:** Requires HOD or Dean verification |
| **Department Head (HOD)** | `ROLE_DEPT_HEAD` | Institutional Management / Admin Provisioning | **NO** | **YES:** Requires Dean / Director approval |
| **Director / Senior Authority** | `ROLE_ADMIN` | Executive Leadership Provisioning | **NO** | **YES:** Multi-party administrative sign-off |
| **Institutional Management** | `ROLE_MANAGEMENT` | Board of Governors / System Admin Provisioning | **NO** | **YES:** Executive appointment |

---

## 4. Auth User Synchronization Trigger (`handle_new_auth_user`)

When a student signs up via Google OAuth or verified email, their record in `auth.users` must be safely reflected in `public.users` without exposing privileged role elevation.

### SQL Implementation Design (`scripts/supabase_auth_and_storage_setup.sql`)
```sql
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    derived_name VARCHAR;
BEGIN
    -- Extract full name from Google OAuth metadata or email handle
    derived_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1)
    );

    -- 1. Insert into public user directory (PII protected by RLS)
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

    -- 2. Assign default unprivileged role ROLE_STUDENT
    -- Privileged roles (HANDLER, DEPT_HEAD, MANAGEMENT, ADMIN) can NEVER be auto-assigned here!
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
```

---

## 5. Supabase Storage Readiness (`campus-plus-attachments`)

### A. Bucket Configuration
- **Bucket ID:** `campus-plus-attachments`
- **Visibility:** Strictly `private` (`public = FALSE`).
- **File Size Limit:** **5,242,880 bytes (5 MB)**.
- **Allowed MIME Types:** `image/jpeg`, `image/png`, `application/pdf`.

### B. Storage Security Policies on `storage.objects`
1. **Download Policy (`p_storage_complaint_attachments_select`):**
   - Grants SELECT to `authenticated` users **only** if:
     - The user is the direct uploader (`owner = auth.uid()`), OR
     - The attachment belongs to a complaint where the user is the complainant, assigned department handler, HOD, or management.
2. **Upload Policy (`p_storage_complaint_attachments_insert`):**
   - Grants INSERT to `authenticated` users strictly targeting `bucket_id = 'campus-plus-attachments'`.
   - File size and MIME type are enforced at both the Supabase bucket level and the server presign endpoint (`POST /api/v1/attachments/presign-upload`).
3. **Execution Gate:** This setup script (`scripts/supabase_auth_and_storage_setup.sql`) will be executed in Phase 09B-3 under controlled database operations.
