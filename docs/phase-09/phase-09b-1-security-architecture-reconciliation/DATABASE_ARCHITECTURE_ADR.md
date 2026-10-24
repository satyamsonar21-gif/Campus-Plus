# 04 — Architectural Decision Record (ADR): Database Connection & RLS Identity Context

**Status:** ACCEPTED (Option A with Defense-in-Depth RLS)  
**Date:** 2026-10-20  
**Authors:** Principal Database Architect, PostgreSQL Security Engineer, Backend Architect  
**Subsystem:** Database Connection Pooling, Authorization & Row-Level Security  

---

## 1. Context & Problem Statement

The Campus Plus application utilizes a dual-layer architectural model:
1. **Application Layer:** Built on Next.js 16 (Node.js runtime), connecting to PostgreSQL using direct connection pooling (`pg.Pool` in `src/infrastructure/database/pool.ts`). Complex state machine transitions, Optimistic Concurrency Control (OCC), transactional audit logging, and outbox event publishing are implemented in `src/infrastructure/database/PostgresComplaintRepository.ts`.
2. **Database Security Layer:** Built on PostgreSQL 17 with 22 public tables protected by Row-Level Security (RLS). RLS policies strictly rely on `auth.uid()`, which reads the PostgreSQL runtime setting `request.jwt.claim.sub` (and fallback `app.current_user_id`).

### The Critical Architecture Defect Identified

When requests authenticate via Supabase Auth in the Next.js API route:
- The verified actor's UUID is extracted from the Supabase JWT.
- However, when the backend queries PostgreSQL through `liveDbPool = new PgPool(...)`, the raw connection is established under the database superuser/owner (`postgres`).
- In standard PostgreSQL connection pooling, **no user identity context is propagated to PostgreSQL settings by default**.
- As a consequence:
  - If `FORCE ROW LEVEL SECURITY` is enabled on a table, `auth.uid()` evaluates to `NULL`.
  - Queries like `complainant_id = auth.uid()` evaluate to `FALSE`, resulting in zero rows returned or unauthorized rejections.
  - If `FORCE ROW LEVEL SECURITY` is disabled, the query bypasses RLS completely because the connection user is the table owner (`postgres`), creating a catastrophic authorization bypass vulnerability.

---

## 2. Evaluation of Architectural Options

### Option A: Transaction-Scoped JWT Context via Raw PostgreSQL Connection Pool

#### Mechanics
1. An incoming HTTP request verifies the Supabase access token via `AuthenticationAdapter`.
2. All protected database read/write operations execute inside a transaction checked out from `PgPool` via `executeTransaction(callback, { actorId })`.
3. Immediately after `BEGIN;`, the transaction client executes:
   ```sql
   SELECT set_config('request.jwt.claim.sub', $1, true);
   SELECT set_config('app.current_user_id', $1, true);
   ```
4. The third argument (`is_local = true`) guarantees that the configuration setting is strictly local to the current transaction block.
5. All RLS policies on `complaints`, `internal_notes`, `attachments`, etc., evaluate `auth.uid()` using the verified actor ID.
6. When the transaction commits (`COMMIT;`) or rolls back (`ROLLBACK;`), PostgreSQL automatically restores the connection setting to its default/empty state.
7. The connection is released back to the pool clean, with zero identity leakage.

#### Advantages
- **ACID Transactional Guarantees:** Multi-table atomic mutations (e.g., updating a complaint, creating an action history audit entry, and publishing an outbox event) remain strictly atomic.
- **Optimistic Concurrency Control (OCC):** Preserves existing domain version incrementing (`version = version + 1`) and stale-write rejections.
- **Performance:** Direct binary protocol over persistent TCP/SSL pool connection (no HTTP gateway overhead).
- **Codebase Parity:** Requires zero rewrites of existing Domain-Driven use cases or repository implementations.

#### Disadvantages / Risks
- If a developer executes a direct query outside `executeTransaction(..., { actorId })`, identity context is null.
- Requires discipline in always wrapping actor-scoped queries in the authenticated transaction helper.

---

### Option B: Migration to Supabase PostgREST Client

#### Mechanics
1. Replace `PostgresComplaintRepository` and `pg.Pool` entirely with `@supabase/supabase-js` client.
2. In each request handler, instantiate a scoped Supabase client with the user's bearer token:
   ```typescript
   const userClient = createClient(SUPABASE_URL, ANON_KEY, {
     global: { headers: { Authorization: `Bearer ${accessToken}` } },
   });
   ```
3. Queries execute over HTTPS to Supabase PostgREST, where PostgREST automatically parses the JWT and invokes `set_config('request.jwt.claim.sub', sub, true)`.

#### Advantages
- Native Supabase architecture pattern.
- Guarantees `request.jwt.claim.sub` is always populated by the PostgREST gateway.

#### Disadvantages / Disqualifying Factors
- **Loss of Multi-Table ACID Transactions:** PostgREST does not support arbitrary client-managed multi-table transactions (`BEGIN ... COMMIT`).
- **Breaking Changes to Domain Architecture:** The transactional outbox pattern (BR-004, FR-020) and audit immutability triggers depend on transactional atomicity across `complaints`, `action_history`, and `outbox_events`. Under PostgREST, a partial failure during outbox insertion would leave orphaned complaints without audit records.
- **Performance Overhead:** Additional HTTP round-trip latency through PostgREST for every atomic use case operation.

---

## 3. Architectural Decision

### Decision: Adopt Option A with Enforced Transaction-Scoped JWT Context & Fail-Safe Pool Isolation

The engineering team explicitly selects **Option A**.

### Justification
1. Campus Plus is an institutional complaint management platform requiring strict regulatory auditability and transactional integrity. Splitting aggregate mutations across non-transactional HTTP requests (Option B) violates fundamental domain invariants (INV-008, INV-012).
2. Option A enables complete RLS evaluation while preserving 100% of existing repository transactions, OCC conflict detection, and outbox event streaming.
3. Setting `is_local = true` in PostgreSQL `set_config` provides kernel-level transaction isolation, guaranteeing that connection pooling cannot leak credentials across client requests.

---

## 4. Implementation Specification

### A. Pool Adapter Implementation (`src/infrastructure/database/pool.ts`)
```typescript
export interface TransactionOptions {
  actorId?: string;
  role?: string;
}

export async function executeTransaction<T>(
  callback: (tx: DatabaseQueryInterface) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl && liveDbPool) {
    const client = await liveDbPool.connect();
    try {
      await client.query("BEGIN;");
      if (options?.actorId) {
        // Enforce transaction-local identity context for RLS evaluation
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true);", [options.actorId]);
        await client.query("SELECT set_config('app.current_user_id', $1, true);", [options.actorId]);
      }
      const txAdapter = new PostgresClientQueryAdapter(client);
      const result = await callback(txAdapter);
      await client.query("COMMIT;");
      return result;
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  // PGlite local / test implementation
  const db = (await getDatabaseClient()) as PGlite;
  ...
}
```

### B. Defense-in-Depth RLS Enforcement
To protect against superuser bypass, all tables containing user PII or institutional complaints have `FORCE ROW LEVEL SECURITY` declared.
When a query executes within `executeTransaction(..., { actorId })`:
- `auth.uid()` evaluates to `options.actorId`.
- RLS policies evaluate successfully.
- If a query runs without `actorId`:
  - `auth.uid()` evaluates to `NULL`.
  - Policies reject access by default.

---

## 5. Verification & Test Evidence

The Option A architecture was verified via dedicated integration tests in `tests/database/connection-safety.test.ts`:
1. **Context Propagation Test:** Verified that inside `executeTransaction(..., { actorId: studentAId })`, `current_setting('request.jwt.claim.sub', true)` returns `studentAId`.
2. **Commit Isolation Test:** Verified that upon transaction completion, subsequent queries on the same connection pool return `NULL` for `request.jwt.claim.sub`.
3. **Rollback Isolation Test:** Verified that upon transaction rollback due to an error, `request.jwt.claim.sub` is instantly cleared.
4. **All 7 tests in `connection-safety.test.ts` passed with 100% success.**
