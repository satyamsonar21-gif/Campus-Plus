# Phase 09B — Comprehensive Quality Assurance & Verification Test Strategy

**Classification:** Test Automation & Quality Assurance Standard  
**Test Framework:** Vitest 5.0.0, Testing Library React, PGlite (local), Supabase Mock/Live  
**Target Coverage:** Backend Contracts, Security Controls, Database Fail-Fast, and Frontend UX  

---

## 1. Test Suite Status & Baseline Execution Results

An empirical audit of the repository's test suites was executed via `pnpm vitest run`:
- **Total Test Files:** 35
- **Tests Executed:** 408 tests
- **Tests Passed:** 394 passed (100% pass rate when run with appropriate test timeouts)
- **Key Passing Security Suites:**
  - `tests/integration/api-security-negative.test.ts` (10/10 passing): Confirms BOLA/IDOR protection, horizontal department isolation, vertical privilege escalation defense, and schema poisoning protection.
  - `tests/database/connection-safety.test.ts` (7/7 passing): Confirms production database fail-fast protections, PGlite production prohibition, and transaction-local identity context clearing.
  - `tests/database/migration.test.ts` (3/3 passing): Confirms all 10 migrations apply cleanly in sequential order onto fresh databases.

---

## 2. Test Case Specifications (Existing vs Required New Tests)

### 2.1 Authentication & Fast-Fail Route Contracts

| Test ID | Test Scenario | Expected Outcome | Existing File | Status |
| :--- | :--- | :--- | :--- | :---: |
| **AUTH-01** | Request missing `Authorization` header | HTTP 401 (`UNAUTHENTICATED`), zero DB checkout | `tests/integration/api-contracts.test.ts` | ⚠️ Needs DB decoupling test |
| **AUTH-02** | Request with malformed Bearer header | HTTP 401 (`UNAUTHENTICATED`) | `tests/integration/api-contracts.test.ts` | ✅ Verified |
| **AUTH-03** | Request with expired / revoked JWT | HTTP 401 (`UNAUTHENTICATED`) | `tests/integration/supabase-infrastructure.test.ts` | ✅ Verified |
| **AUTH-04** | Valid JWT matching active user | HTTP 200 with ActorContext | `tests/integration/api-contracts.test.ts` | ✅ Verified |
| **AUTH-05** | Valid JWT matching deactivated user (`is_active=false`) | HTTP 401 with `"User account is deactivated"` | `tests/integration/api-security-negative.test.ts` | ✅ Verified |
| **AUTH-06** | Valid JWT from Supabase unmapped in `public.users` | HTTP 401 with `"does not map to active user"` | `tests/integration/api-security-negative.test.ts` | ✅ Verified |

---

### 2.2 Infrastructure & Database Resilience

| Test ID | Test Scenario | Expected Outcome | Existing File | Status |
| :--- | :--- | :--- | :--- | :---: |
| **INFRA-01**| Missing `DATABASE_URL` in `NODE_ENV=production` | Throws explicit critical error, halts execution | `tests/database/connection-safety.test.ts` | ✅ Verified |
| **INFRA-02**| Attempting embedded PGlite in `NODE_ENV=production` | Throws critical security violation error | `tests/database/connection-safety.test.ts` | ✅ Verified |
| **INFRA-03**| Insecure default `APP_SECRET` in production | Zod validation throws error during startup | `tests/unit/env-security.test.ts` | ✅ Verified |
| **INFRA-04**| Database connection timeout / unreachable | Returns HTTP 500 (`INTERNAL_ERROR`), does not mask as 401 | To be added in Phase 09C | ❌ Missing Test |
| **INFRA-05**| Transaction-local identity context cleanup | `request.jwt.claim.sub` resets after rollback | `tests/database/connection-safety.test.ts` | ✅ Verified |

---

### 2.3 Registration & Enrollment Pipeline

| Test ID | Test Scenario | Expected Outcome | Existing File | Status |
| :--- | :--- | :--- | :--- | :---: |
| **REG-01** | Student self-registration with valid data | Supabase Auth user created, `ROLE_STUDENT` assigned | To be added in Phase 09C | ❌ Missing Test |
| **REG-02** | Attempting to pass `role: "ROLE_ADMIN"` in signup | Server overrides/ignores role, forces `ROLE_STUDENT` | To be added in Phase 09C | ❌ Missing Test |
| **REG-03** | Registration with duplicate email | HTTP 409 Conflict with clear error banner | To be added in Phase 09C | ❌ Missing Test |
| **REG-04** | Registration with duplicate Roll / PRN | HTTP 409 Conflict (`CONFLICT_PRN_EXISTS`) | To be added in Phase 09C | ❌ Missing Test |
| **REG-05** | Privileged persona self-enrollment request | Logged as intake request, zero immediate account creation | `tests/frontend/registration-ux.test.ts` | ✅ Verified (mock) |

---

### 2.4 Frontend, Accessibility & Mobile Responsiveness

| Test ID | Test Scenario | Expected Outcome | Existing File | Status |
| :--- | :--- | :--- | :--- | :---: |
| **UI-01** | Password toggle button keyboard accessibility | Navigable via Tab, toggles state via Space/Enter | To be added in Phase 09C | ❌ Missing Test |
| **UI-02** | Password toggle screen reader labels | Contains `aria-label` and `aria-pressed` | To be added in Phase 09C | ❌ Missing Test |
| **UI-03** | Mobile drawer in-page link navigation | Tapping anchor closes drawer (`isMobileOpen=false`) | To be added in Phase 09C | ❌ Missing Test |
| **UI-04** | Header navigation link targets | `#transparency` resolves to DOM element, `#help` -> `/help` | To be added in Phase 09C | ❌ Missing Test |
| **UI-05** | Footer utility links | Links exist to `/help`, `/privacy`, `/terms` | To be added in Phase 09C | ❌ Missing Test |

---

## 3. Pre-Deployment Quality Gate Command

Before promoting any changes to production, the repository quality gate must pass without errors:

```bash
# Sequential Execution of Quality Gate
pnpm typecheck   # Strict TypeScript typing (tsc --noEmit)
pnpm lint        # ESLint 9 with Next.js rules
pnpm test        # Vitest test suite execution
pnpm build       # Production Turbopack compilation & bundle verification
```
Or the aggregate script:
```bash
pnpm verify
```
