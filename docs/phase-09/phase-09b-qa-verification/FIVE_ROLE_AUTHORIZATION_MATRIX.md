# Phase 09B — Five-Role Authorization & Domain Permission Matrix

**Classification:** Access Control Architecture & Domain Authorization  
**Standards:** Four-Dimensional Access Control (Role + Ownership + Department Scope + State)  
**Components:** `src/domain/complaint/policies/AuthorizationPolicy.ts`, `src/presentation/components/auth/authTypes.ts`  

---

## 1. Five Personas vs Technical Roles Mapping

Campus Plus aligns user experiences across five institutional personas mapped to six technical roles:

| Frontend Persona | Technical Role ID | Database Role (`roles.id`) | Primary Responsibility |
| :--- | :--- | :--- | :--- |
| **1. Student** | `ROLE_STUDENT` | `ROLE_STUDENT` | Lodging complaints, monitoring resolution timeline, verifying or disputing resolved complaints. |
| **2. Faculty / Handler** | `ROLE_HANDLER` | `ROLE_HANDLER` | Departmental investigation, operational resolution, evidence submission, forwarding misrouted complaints. |
| **3. HOD (Dept Head)** | `ROLE_DEPT_HEAD` | `ROLE_DEPT_HEAD` | Triage, complaint review, assigning handlers, handling Tier 2 department escalations, closing/rejecting. |
| **4. Director** | `ROLE_ADMIN` | `ROLE_ADMIN` | Senior institutional oversight, campus-wide audit ledger access, administrative closure, system maintenance. |
| **5. Management** | `ROLE_MANAGEMENT` | `ROLE_MANAGEMENT` | Campus-wide governance, deadlock resolution (after 3 forwards), macro trend analytics, institutional SLA policy review. |

*Note on `ROLE_FACULTY`: In the domain model, `ROLE_FACULTY` has dual capability: they can lodge complaints (acting as complainants) and can be assigned as handlers.*

---

## 2. Four-Dimensional Authorization Matrix

In `AuthorizationPolicy.ts`, permission to execute any domain operation is computed against:
$$\text{Permission} = f(\text{Actor Role}, \text{Resource Ownership}, \text{Department Scope}, \text{Complaint State})$$

| Domain Operation | Student (`ROLE_STUDENT`) | Handler (`ROLE_HANDLER`) | HOD (`ROLE_DEPT_HEAD`) | Director (`ROLE_ADMIN`) | Management (`ROLE_MANAGEMENT`) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **`SUBMIT`** | ✅ Any category | ❌ (Complainant only) | ❌ | ❌ | ❌ |
| **`VIEW`** | ✅ Own only (BOLA guard) | ✅ Own Department | ✅ Own Department | ✅ Campus-wide | ✅ Campus-wide |
| **`REVIEW`** (Triage) | ❌ | ❌ | ✅ Own Department | ✅ | ✅ |
| **`ASSIGN`** | ❌ | ❌ | ✅ Within Department | ✅ | ✅ |
| **`START_PROGRESS`** | ❌ | ✅ If Assigned | ✅ | ✅ | ✅ |
| **`FORWARD`** (Transfer) | ❌ | ✅ To other Dept | ✅ To other Dept | ✅ | ✅ |
| **`ESCALATE`** | ❌ | ❌ | ✅ Tier 1 $\to$ 2 | ✅ Tier 2 $\to$ 3 | ✅ Tier 3 Executive |
| **`RESOLVE`** | ❌ | ✅ With proof | ✅ With proof | ✅ | ✅ |
| **`VERIFY_RESOLUTION`** | ✅ Own (status=RESOLVED) | ❌ | ❌ | ❌ | ❌ |
| **`DISPUTE_REOPEN`** | ✅ Own (status=RESOLVED) | ❌ | ❌ | ❌ | ❌ |
| **`CLOSE`** | ❌ | ❌ | ✅ If verified/stale | ✅ | ✅ |
| **`REJECT`** | ❌ | ❌ | ✅ With justification | ✅ | ✅ |
| **`MARK_DUPLICATE`** | ❌ | ❌ | ✅ Own Department | ✅ | ✅ |
| **`CANCEL`** | ✅ Own (un-triaged) | ❌ | ❌ | ❌ | ❌ |

---

## 3. Department Scope & Anti-Deadlock Enforcements

### 3.1 Horizontal Department Isolation
- Handlers and HODs belong to a specific department (`actor.departmentId`).
- If an IT Handler attempts to view, assign, or resolve a complaint belonging to Hostel Maintenance (`resource.departmentId !== actor.departmentId`), `AuthorizationPolicy` returns:
  `DepartmentScopeViolationError` (HTTP 403 Forbidden).
- Handlers and HODs are strictly blocked from horizontal privilege escalation.

### 3.2 Vertical Privilege Escalation Defense
- Students attempting to execute staff operations (`ASSIGN`, `REVIEW`, `RESOLVE`) are rejected with `UnauthorizedOperationError` (HTTP 403 Forbidden).
- Verified by automated test suite: `tests/integration/api-security-negative.test.ts` (10/10 security tests passing).

### 3.3 Anti-Deadlock Forwarding Trigger
- If a complaint is repeatedly forwarded between departments (e.g. IT $\leftrightarrow$ Electrical $\leftrightarrow$ Facilities):
- When `forwarding_count >= 3`, the domain state machine automatically escalates the complaint to **Tier 3 (Institutional Management)**, stripping departmental ping-pong and forcing executive intervention.
- Verified by test suite: `tests/integration/api-lifecycle-flows.test.ts`.

---

## 4. Frontend Dashboard Dispatcher Consistency

In `src/app/dashboard/page.tsx`:
```typescript
function DashboardDispatcher() {
  const { role } = useAuth();
  switch (role) {
    case UserRole.ROLE_STUDENT:
    case UserRole.ROLE_FACULTY:
      return <StudentDashboard />;
    case UserRole.ROLE_HANDLER:
      return <HandlerDashboard />;
    case UserRole.ROLE_DEPT_HEAD:
      return <HodDashboard />;
    case UserRole.ROLE_MANAGEMENT:
      return <ManagementDashboard />;
    case UserRole.ROLE_ADMIN:
      return <AdminDashboard />;
    default:
      return <StudentDashboard />;
  }
}
```
All five technical roles are paired with dedicated, bespoke dashboard components that display role-appropriate metrics, action tables, and analytical views.
