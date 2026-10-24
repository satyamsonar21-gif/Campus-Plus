# Phase 09B — Application Security Risk Register

**Classification:** Information Security & Threat Assessment  
**Standard:** OWASP Top 10 API Security Risks & Enterprise IAM Governance  

---

## 1. Threat Matrix & Risk Register

| Risk ID | Threat Description | OWASP Mapping | Likelihood | Impact | Severity | Mitigation Status |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **SEC-01** | **Eager DB Connection Exhaustion:** Unauthenticated traffic forces PostgreSQL pool connection before JWT validation, enabling connection-exhaustion DoS. | API4: Unrestricted Resource Consumption | High | High | **Critical** | Scheduled Phase 09C (Fast-Fail 401 Guard) |
| **SEC-02** | **Privilege Escalation via Self-Enrollment:** Public registration forms permitting users to self-assign staff, HOD, or administrative roles. | API5: Broken Function Level Authorization | High | Critical | **Critical** | Design Complete (Tier-1 Student Only / Server-Enforced) |
| **SEC-03** | **Broken Object-Level Authorization (BOLA/IDOR):** Student B viewing or tampering with complaints filed by Student A. | API1: Broken Object Level Authorization | High | High | **High** | Mitigated (`AuthorizationPolicy.ts` INV-008 & verified by tests) |
| **SEC-04** | **Cross-Department Horizontal Escalation:** Handler from IT department resolving or closing complaints for Hostel Maintenance. | API5: Broken Function Level Authorization | Medium | High | **High** | Mitigated (`DepartmentScopeViolationError` & verified by tests) |
| **SEC-05** | **Direct IPv6 Database Unreachability:** Direct Supabase port 5432 connection failing on AWS Lambda IPv4 serverless nodes. | API8: Security Misconfiguration | High | High | **Critical** | Remediation Planned (Mandatory Pooler Port 6543) |
| **SEC-06** | **Insecure Dev Secrets in Production:** Weak or development defaults for `APP_SECRET` and `CRON_SECRET` deployed to production. | API2: Broken Authentication | Low | High | **Medium** | Mitigated in `env.ts` (Requires refinement for production check) |
| **SEC-07** | **Secret Key Leakage in Client Bundles:** Accidental inclusion of `SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL` in client JavaScript. | API3: Broken Object Property Level Authorization | Low | Critical | **High** | Mitigated (`env.ts` Client Proxy throws on access) |
| **SEC-08** | **Transaction Context Identity Leaks:** Multi-tenant connection pool contamination via connection-global `SET` statements. | API1: Broken Object Level Authorization | Medium | Critical | **High** | Mitigated (`set_config(..., true)` strictly inside transactions) |
| **SEC-09** | **Screen-Reader / Keyboard Exclusion:** Password field toggle inaccessible to assistive technologies. | Accessibility (A11y) | High | Low | **Low** | Scheduled Phase 09C (ARIA & TabIndex Remediation) |

---

## 2. Deep Dive: Mitigations & Verification Evidence

### SEC-01: Eager DB Connection Exhaustion
- **Vulnerability:** Every request to `/api/v1/auth/me` checks out a database pool connection before verifying whether an Authorization header exists.
- **Threat Scenario:** An external attacker floods the server with 500 requests/sec with no headers. The serverless functions open 500 pool connections, crashing PostgreSQL and starving valid users.
- **Mitigation:**
  Implement a lightweight token pre-check:
  ```typescript
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthenticationError("Authentication token is missing.");
  }
  ```
  Reject the request *before* executing `await getContainer()`.

### SEC-02: Privilege Escalation via Self-Enrollment
- **Vulnerability:** If client-side requests could specify `{ role: "ROLE_ADMIN" }`, an attacker could enroll directly with directorate access.
- **Mitigation:**
  The server-side enrollment handler must ignore all role properties sent by the client. The role assignment is hardcoded to `'ROLE_STUDENT'`. Privileged roles require out-of-band institutional provisioning.

### SEC-03 & SEC-04: BOLA & Horizontal Scope Protection
- **Status: VERIFIED & TESTED**
- Test suite `tests/integration/api-security-negative.test.ts` executes automated tests:
  - `rejects unauthorized student B from viewing student A's complaint with 403` -> PASSED (22.7s)
  - `rejects unauthorized student B from viewing student A's timeline with 403` -> PASSED (19.4s)
  - `rejects Hostel Handler from assigning an IT Department complaint with 403` -> PASSED (4.1s)
  - `rejects Hostel Handler from resolving an IT Department complaint with 403` -> PASSED (4.2s)
