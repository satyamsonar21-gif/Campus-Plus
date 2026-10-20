# Business Requirement Validation & Forensic Matrix

**Project:** Campus Plus — Campus Complaint & Grievance Resolution System  
**Phase:** Phase 09A — Business Requirement Validation  
**Methodology:** Direct verification of SQL migrations, PostgreSQL constraints, and application code against documented business invariants.  

---

## 1. Core Business Requirements Compliance Scorecard

| # | Business Requirement Description | Architecture & Database Enforcement | Compliance Status | Defect / Note |
| :-: | :--- | :--- | :---: | :--- |
| **BR-01** | Exactly five primary roles: Student, Faculty, HOD, Director, Institutional Management | Table `roles`, `seeds/001_reference_seed.sql`, `ComplaintTypes.ts` | **PARTIAL / MISMATCH** | **DEF-001:** `ROLE_FACULTY` missing from database seed; role naming taxonomy differs |
| **BR-02** | Complaint lifecycle follows canonical 13-state FSM | Enum `complaint_status_enum`, `ComplaintStatus.ts` | **FULLY SATISFIED** | Validated in `fsm-transitions.test.ts` |
| **BR-03** | Closed complaints are permanently immutable | `BusinessInvariants.validateNotClosed()` | **PARTIAL** | **DEF-002:** Missing PostgreSQL DB trigger enforcing immutability on table `complaints` |
| **BR-04** | Recurring issue requires a new complaint (clustering detection) | View `recurring_complaint_clusters` (>=3 in 30 days) | **FULLY SATISFIED** | Validated in `performance-explain.test.ts` |
| **BR-05** | Attachment limit: Maximum 5 MB per file | Constraint `chk_attachment_size_limit` (<= 5,242,880 B) | **FULLY SATISFIED** | Validated in `constraints.test.ts` |
| **BR-06** | Maximum 3 attachments per complaint | Application validation (`SubmitComplaintSchema`, domain) | **PARTIAL** | **DEF-003:** Missing database-level trigger/constraint limiting row count to 3 |
| **BR-07** | Supported attachment types restricted to JPEG, PNG, and PDF | Constraint `chk_attachment_mime_whitelist` | **FULLY SATISFIED** | Validated in `constraints.test.ts` |
| **BR-08** | Role permissions enforced server-side | `AuthenticationAdapter.ts`, API route guards | **FULLY SATISFIED** | Tested across API v1 endpoints |
| **BR-09** | Users cannot access unauthorized complaint records | Table `complaints` RLS policies | **FULLY SATISFIED** | Validated in `rls-authorization.test.ts` |
| **BR-10** | Student visibility strictly blocks internal staff notes | Table `internal_notes` RLS policies | **FULLY SATISFIED** | Validated in `rls-authorization.test.ts` |
| **BR-11** | Audit trail is append-only and cryptographically tamper-proof | Trigger `trg_action_history_no_mutation` on `action_history` | **FULLY SATISFIED** | Validated in `audit-immutability.test.ts` |
| **BR-12** | Sensitive attachments not publicly accessible | Table `attachments` RLS, Private Storage Bucket | **PARTIAL** | **SEC-006:** Storage bucket DDL not in migrations |
| **BR-13** | Concurrency-safe unique tracking reference codes (`CP-YYYY-XXXXX`) | Sequence `tracking_code_seq`, `PostgresTrackingCodeGenerator` | **FULLY SATISFIED** | Validated in `migration.test.ts` |
| **BR-14** | Self-forwarding within same department is strictly prohibited | Constraint `chk_forward_diff_dept` | **FULLY SATISFIED** | Validated in `constraints.test.ts` |
| **BR-15** | Resolution requires substantive summary (>= 20 characters) | Constraint `chk_resolution_summary_len` | **FULLY SATISFIED** | Enforced in SQL DDL & domain |
| **BR-16** | Reopen window bound to institutional 5 working-day limit | `CalendarReopenPolicyAdapter.ts`, `working_calendars` | **FULLY SATISFIED** | Application policy adapter verified |

---

## 2. In-Depth Forensic Analysis of Discrepancies

### BR-01: Five-Role Institutional Taxonomy Reconciliation (DEF-001)

The documented institutional governance model defines **five primary user roles**:
1. **Student:** Submits personal grievances, tracks resolution progress, provides verification or disputes.
2. **Faculty:** Academic staff raising infrastructure or departmental issues, acting as first-line advisors.
3. **Head of Department (HOD):** Departmental triage, handler assignment, internal escalation, and handoff forwarding.
4. **Director:** Campus head with executive oversight over institutional escalations, SLA breaches, and campus-wide governance.
5. **Institutional Management:** Central administration reviewing cross-departmental analytics and allocating infrastructure resources.

#### Current Codebase & Database Reality:
- In `src/domain/complaint/ComplaintTypes.ts`:
  ```ts
  export const UserRole = {
    ROLE_STUDENT: "ROLE_STUDENT",
    ROLE_FACULTY: "ROLE_FACULTY",
    ROLE_HANDLER: "ROLE_HANDLER",
    ROLE_DEPT_HEAD: "ROLE_DEPT_HEAD",
    ROLE_MANAGEMENT: "ROLE_MANAGEMENT",
    ROLE_ADMIN: "ROLE_ADMIN",
  } as const;
  ```
- In `src/presentation/context/AuthContext.tsx`:
  All 6 roles above have designated theme tokens and UI routing.
- In `seeds/001_reference_seed.sql`:
  ```sql
  INSERT INTO roles (id, description) VALUES
  ('ROLE_STUDENT', 'Enrolled student submitting and tracking grievances'),
  ('ROLE_HANDLER', 'Staff member assigned to investigate and resolve grievances'),
  ('ROLE_DEPT_HEAD', 'Department head triaging, assigning, and escalating grievances'),
  ('ROLE_MANAGEMENT', 'Executive leadership reviewing institution-wide escalation and analytics'),
  ('ROLE_ADMIN', 'System administrator managing configuration and master metadata')
  ON CONFLICT (id) DO NOTHING;
  ```
- In `seeds/002_synthetic_dev_seed.sql`:
  - `management@synthetic.campusplus.internal` (Synthetic Campus Director) is assigned `ROLE_MANAGEMENT`.
  - `hod.it@synthetic.campusplus.internal` is assigned `ROLE_DEPT_HEAD`.
  - `handler.it1@synthetic.campusplus.internal` is assigned `ROLE_HANDLER`.
  - **`ROLE_FACULTY` is completely absent!**

#### Defect Root Cause & Resolution:
1. `ROLE_FACULTY` exists in TypeScript domain definitions but was never added to the database seed.
2. If an enrolled faculty member logs in or is seeded, attempting to insert into `user_roles` will throw `foreign key constraint violation (fk_user_roles_role_id)`.
3. In Phase 09B, `ROLE_FACULTY` must be formally added to `seeds/001_reference_seed.sql` and `roles` table.

---

### BR-03: Immutability of Closed Complaints (DEF-002)

The business specification states:
> *"Closed complaints are immutable. A recurring issue requires a new complaint."*

#### Current Database Reality:
- In TypeScript domain logic (`src/domain/complaint/BusinessInvariants.ts`), `validateNotClosed()` throws `ComplaintClosedError` when attempting any mutation on a complaint in `CLOSED` status.
- However, at the PostgreSQL database level, table `complaints` has NO check constraint or trigger preventing `UPDATE complaints SET ... WHERE status = 'CLOSED'`.
- If an update is triggered directly via an administrative query, migration, or external API integration, PostgreSQL allows the update.

#### Recommended Database Remediation:
Add a PostgreSQL trigger function on `complaints`:
```sql
CREATE OR REPLACE FUNCTION trg_enforce_complaint_closed_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'CLOSED' THEN
        RAISE EXCEPTION 'BUSINESS INVARIANT VIOLATION: Closed complaint % is permanently immutable (BR-03 / INV-003).', OLD.ref_id
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_complaints_no_closed_mutation
BEFORE UPDATE ON complaints
FOR EACH ROW EXECUTE FUNCTION trg_enforce_complaint_closed_immutable();
```

---

### BR-06: Maximum 3 Attachments per Complaint (DEF-003)

The business specification states:
> *"Attachment limit: 5 MB per file. Maximum attachments: 3 files per complaint."*

#### Current Database Reality:
- The 5 MB file size limit is strictly enforced via check constraint:  
  `CONSTRAINT chk_attachment_size_limit CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880)`.
- The whitelist of mime types is strictly enforced via check constraint:  
  `CONSTRAINT chk_attachment_mime_whitelist CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf'))`.
- However, the **maximum of 3 files per complaint** is enforced only in the frontend/application layer. There is no PostgreSQL trigger or constraint on `attachments` to prevent a 4th or 5th attachment from being inserted.

#### Recommended Database Remediation:
Add a trigger on `attachments`:
```sql
CREATE OR REPLACE FUNCTION trg_enforce_attachment_count_limit()
RETURNS TRIGGER AS $$
DECLARE
    current_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO current_count
    FROM attachments
    WHERE complaint_id = NEW.complaint_id;

    IF current_count >= 3 THEN
        RAISE EXCEPTION 'BUSINESS INVARIANT VIOLATION: Maximum of 3 attachments allowed per complaint (BR-06).'
            USING ERRCODE = '23514'; -- check_violation
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_attachments_max_three
BEFORE INSERT ON attachments
FOR EACH ROW EXECUTE FUNCTION trg_enforce_attachment_count_limit();
```
