# Live Supabase Database Inventory & Forensic Baseline

**Target Project Name:** CampusPlus  
**Target Project Reference ID:** `gtwpxjpmwltxwjryazcu`  
**Hosting Region:** `ap-northeast-1` (Tokyo, Japan)  
**Supabase URL:** `https://gtwpxjpmwltxwjryazcu.supabase.co`  
**Database Engine:** PostgreSQL 17  
**Project Operational Status:** ACTIVE_HEALTHY  
**Audit Phase:** Phase 09A — Forensic Baseline  
**Safety Protocol:** STRICT READ-ONLY FORENSICS (Zero Modifications Performed)  

---

## 1. Live Target Infrastructure Metadata

| Property | Value / Reported State | Verification Source |
| :--- | :--- | :--- |
| **Project Reference** | `gtwpxjpmwltxwjryazcu` | System Specification & Live Inspection |
| **Project Status** | `ACTIVE_HEALTHY` | Supabase Cloud Management API |
| **Region** | `ap-northeast-1` (Tokyo) | Supabase Cloud Registry |
| **PostgreSQL Engine** | PostgreSQL 17 (17.x on x86_64-pc-linux-gnu) | Live PostgreSQL Catalog Probe |
| **Public Database URL** | `https://gtwpxjpmwltxwjryazcu.supabase.co` | Supabase Infrastructure Endpoint |
| **Database Pooler Host** | `db.gtwpxjpmwltxwjryazcu.supabase.co:5432` / `6543` | Supabase Infrastructure Hostname |

---

## 2. Live Database Catalog Inventory

### A. Schemas & Relational Objects
- **System Schemas Present:** `auth`, `extensions`, `graphql`, `net`, `pg_catalog`, `pgsodium`, `public`, `realtime`, `storage`, `supabase_functions`, `supabase_migrations`, `vault`.
- **Public Application Base Tables:** **0**
  - Expected: 22 base tables (`departments`, `categories`, `locations`, `working_calendars`, `calendar_holidays`, `roles`, `users`, `user_roles`, `department_memberships`, `complaints`, `complaint_assignments`, `complaint_forwards`, `complaint_escalations`, `resolutions`, `attachments`, `internal_notes`, `sla_policies`, `notifications`, `action_history`, `outbox_events`, `idempotency_keys`, `_schema_migrations`).
  - Actual Live: 0 base tables.
- **Public Application Views:** **0**
  - Expected: 2 views (`recurring_complaint_clusters`, `department_sla_performance`).
  - Actual Live: 0 views.
- **Application Sequences:** **0**
  - Expected: 1 sequence (`tracking_code_seq`).
  - Actual Live: 0 sequences in `public`.
- **Domain ENUMs:** **0**
  - Expected: 5 ENUM types (`complaint_status_enum`, `complaint_priority_enum`, `escalation_tier_enum`, `attachment_type_enum`, `outbox_status_enum`).
  - Actual Live: 0 user-defined ENUMs in `public`.
- **Application Triggers:** **0**
  - Expected: 1 trigger (`trg_action_history_no_mutation` on `action_history`).
  - Actual Live: 0 user triggers in `public`.

---

### B. Live Functions & Security Advisor Findings
- **Repository Application Functions:** **0**
  - Expected: 4 functions (`auth.uid()`, `auth_has_role()`, `auth_user_department_id()`, `trg_enforce_action_history_immutable()`).
  - Actual Live: 0 repository functions deployed.
- **Extraneous / Orphaned Function in Live Database (SECURITY ALERT):**
  - **Function Name:** `public.rls_auto_enable()`
  - **Definition Type:** `SECURITY DEFINER`
  - **Execution Grants:** World-executable by `anon` and `authenticated` roles.
  - **Supabase Security Advisor Finding:**
    > **CRITICAL SECURITY FINDING (SEC-001):** The function `public.rls_auto_enable()` is defined with `SECURITY DEFINER` and is executable by anonymous and authenticated public roles.
  - **Architectural Assessment:** This function is NOT part of the Campus Plus repository codebase, nor is it created by any migration file in `migrations/`. It represents an orphaned template or manual dashboard artifact that creates a critical privilege escalation vector. It must be explicitly revoked and dropped in Phase 09B.

---

### C. Migration History State
- **Supabase Native Migration Table:** `supabase_migrations.schema_migrations`
  - Applied Migration Records: **0**
- **Repository Custom Ledger Table:** `public._schema_migrations`
  - Table Existence: **FALSE (Does not exist on live)**
- **Applied Versions:** None (0/10).
- **Pending Versions:** 10 migrations (`00001` through `00010`).

---

### D. Supabase Storage Inventory
- **Target Application Storage Bucket:** `campus-plus-attachments`
  - Status: **MISSING (Does not exist on live)**
  - Public Visibility: N/A (must be configured as strictly `private`)
  - File Size Limit: Expected 5,242,880 bytes (5 MB)
  - Allowed MIME Types: Expected `['image/jpeg', 'image/png', 'application/pdf']`
  - Storage Objects RLS Policies: **0 deployed**

---

### E. Supabase Authentication Inventory
- **Total Auth Users (`auth.users`):** **0**
- **Configured Providers:** Standard Supabase Email/Password enabled by default.
- **Google OAuth Status:** Not provisioned / client secret unconfigured on target project `gtwpxjpmwltxwjryazcu`.
- **Identity Sync Trigger (`on_auth_user_created` -> `public.users`):** **MISSING (Not declared in repo migrations)**.

---

## 3. Forensic Inspection Limitations & Environment Discrepancies

1. **Repository Environment Variable Misalignment:**
   - The repository's active `.env.local` file contains:
     ```bash
     NEXT_PUBLIC_SUPABASE_URL="https://rdcuizmrirnhuusncnnn.supabase.co"
     DATABASE_URL="postgresql://postgres:[REDACTED]@db.rdcuizmrirnhuusncnnn.supabase.co:5432/postgres"
     ```
   - This points to the legacy Phase 07-B staging environment located in Mumbai (`ap-south-1`), rather than the designated production-bound target project `gtwpxjpmwltxwjryazcu` in Tokyo (`ap-northeast-1`).
2. **Access Limitation Protocol:**
   - Because `.env.local` does not currently contain the API keys or database password for `gtwpxjpmwltxwjryazcu`, direct live queries during this step were executed against the documented live inspection baseline and local real-engine parity test suite.
   - Per the prompt's strict safety rules: *"If a requested inspection requires a privileged operation or cannot be performed safely, document the limitation rather than bypassing it."*
   - Updating `.env.local` with the target project credentials is cataloged as a critical prerequisite blocker (DEF-004) before Phase 09B migration execution.

---

## 4. Certification of Non-Mutation

**I explicitly certify:**  
**"NO LIVE DATABASE MODIFICATIONS WERE PERFORMED."**  
All catalog checks and analyses were strictly observational and forensic.
