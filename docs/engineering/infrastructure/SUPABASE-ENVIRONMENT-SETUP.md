# Supabase Environment Setup & Configuration Guide

**Project Name:** CampusPlus  
**Project ID:** `gtwpxjpmwltxwjryazcu`  
**Hosting Region:** `ap-northeast-1` (Tokyo, Japan)  
**Database Engine:** PostgreSQL 17  
**HTTPS Gateway URL:** `https://gtwpxjpmwltxwjryazcu.supabase.co`  

---

## 1. Quick Start: Database & Storage Provisioning

### Step 1: Execute Consolidated Database Schema
1. Open the **[Supabase Dashboard](https://supabase.com/dashboard/project/gtwpxjpmwltxwjryazcu)**.
2. In the left navigation bar, open the **SQL Editor**.
3. Create a **New Query**, paste the contents of [**`scripts/supabase_consolidated_schema.sql`**](file:///d:/Deparment%20Project/department%20project/scripts/supabase_consolidated_schema.sql), and click **Run**.
4. This provisions:
   - All **22 relational base tables** with foreign keys, checks, and unique constraints.
   - All **5 domain ENUMs** and the **`tracking_code_seq`** sequence.
   - **Row-Level Security (RLS)** forced on all 22 tables (including PII protection for `users`).
   - Automated triggers for **audit immutability** and **closed complaint protection**.
   - Master reference data (Seed 001) including `ROLE_FACULTY`.

### Step 2: Provision Storage & Auth Synchronization
1. Open a second query tab in the **SQL Editor**.
2. Paste the contents of [**`scripts/supabase_auth_and_storage_setup.sql`**](file:///d:/Deparment%20Project/department%20project/scripts/supabase_auth_and_storage_setup.sql) and click **Run**.
3. This configures:
   - **Private Storage Bucket**: `campus-plus-attachments` with a 5 MB file size limit and MIME whitelist (`image/jpeg`, `image/png`, `application/pdf`).
   - **Storage RLS Policies**: Restricts downloads to complainants and authorized staff.
   - **Auto-Sync Trigger (`on_auth_user_created`)**: Automatically provisions a `public.users` profile and assigns `ROLE_STUDENT` whenever a user signs up via Email or Google OAuth.

---

## 2. Environment Variables Configuration

Copy [`.env.supabase.example`](file:///d:/Deparment%20Project/department%20project/.env.supabase.example) to `.env.local`:

```bash
# Windows PowerShell
copy .env.supabase.example .env.local

# Linux / macOS
cp .env.supabase.example .env.local
```

### Locating Your Credentials in the Supabase Dashboard:

| Variable | Dashboard Location | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Project Settings → API** | Project URL (`https://gtwpxjpmwltxwjryazcu.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Project Settings → API** | Public anon/publishable key (`ey...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Project Settings → API** | Secret service_role key (bypasses RLS) |
| `SUPABASE_JWT_SECRET` | **Project Settings → API** | JWT Secret for server-side token decoding |
| `DATABASE_URL` | **Project Settings → Database** | Connection string (Direct port `5432` or Pooler port `6543`) |

---

## 3. Database Connection Modes: Port 5432 vs 6543

Supabase provides two connection endpoints:

1. **Direct Connection (Port 5432 - Session Mode):**
   * Host: `db.gtwpxjpmwltxwjryazcu.supabase.co:5432`
   * Ideal for: Local development, migrations, and long-running Docker/Node processes.
   * Format: `postgresql://postgres:[YOUR-PASSWORD]@db.gtwpxjpmwltxwjryazcu.supabase.co:5432/postgres`

2. **Supavisor Transaction Pooler (Port 6543 - Transaction Mode):**
   * Host: `aws-0-ap-northeast-1.pooler.supabase.com:6543`
   * **MANDATORY FOR VERCEL & SERVERLESS**: Prevents connection pool starvation under horizontal scaling.
   * Format: `postgresql://postgres.gtwpxjpmwltxwjryazcu:[YOUR-PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`

---

## 4. Supabase Authentication Configuration

Navigate to **Authentication → URL Configuration** in the Supabase Dashboard:

1. **Site URL:**
   * Local: `http://localhost:3000`
   * Production: `https://your-app.vercel.app`
2. **Redirect URLs (Allow list):**
   * `http://localhost:3000/**`
   * `https://*.vercel.app/**`
   * `https://your-custom-domain.com/**`
3. **Email Auth:**
   * Under **Authentication → Providers → Email**: Ensure Email provider is enabled.
   * For staging/dev convenience, you can toggle off **Confirm email** to allow instant account testing.

---

## 5. Provisioning Staging Test Accounts

To populate your live Supabase project with the 5 authoritative role personas:

```bash
# Ensure .env.local has valid SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL
export STAGING_USER_PASSWORD="SecureStagingPassword123!" # or $env:STAGING_USER_PASSWORD on PowerShell
node scripts/provision-staging-accounts.js
```

This provisions:
* `student.a@synthetic.campusplus.internal` (`ROLE_STUDENT`)
* `handler.it1@synthetic.campusplus.internal` (`ROLE_HANDLER`)
* `hod.it@synthetic.campusplus.internal` (`ROLE_DEPT_HEAD`)
* `management@synthetic.campusplus.internal` (`ROLE_MANAGEMENT`)
* `sysadmin@synthetic.campusplus.internal` (`ROLE_ADMIN`)
