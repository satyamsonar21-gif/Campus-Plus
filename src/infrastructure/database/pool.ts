import { PGlite } from "@electric-sql/pglite";
import { Pool as PgPool, PoolClient } from "pg";
import { DatabaseMigrator, DatabaseQueryInterface } from "./migrator";
import path from "node:path";

let globalDb: PGlite | null = null;
let liveDbPool: PgPool | null = null;
let initialized = false;
let initPromise: Promise<DatabaseQueryInterface> | null = null;

class PostgresLiveQueryAdapter implements DatabaseQueryInterface {
  constructor(private readonly pool: PgPool) {}

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const res = await this.pool.query(sql, params);
    return { rows: res.rows as T[] };
  }

  async exec(sql: string): Promise<unknown> {
    return await this.pool.query(sql);
  }
}

class PostgresClientQueryAdapter implements DatabaseQueryInterface {
  constructor(private readonly client: PoolClient) {}

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const res = await this.client.query(sql, params);
    return { rows: res.rows as T[] };
  }

  async exec(sql: string): Promise<unknown> {
    return await this.client.query(sql);
  }
}

/**
 * Initializes and provides the database connection.
 * If DATABASE_URL is configured, connects directly to live PostgreSQL (Supabase).
 * If DATABASE_URL is not set, falls back to embedded PGlite for local/testing.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * 1. NO SILENT FALLBACK: If DATABASE_URL is set and fails, throws an explicit error.
 * 2. NO RUNTIME DDL: ordinary runtime startup never issues CREATE TABLE/SEQUENCE/INDEX.
 */
export async function getDatabaseClient(): Promise<DatabaseQueryInterface> {
  const dbUrl = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === "production";

  // 1. Mandatory Production Database Configuration (Fail-Fast Section 10)
  if (isProduction && (!dbUrl || dbUrl.trim() === "")) {
    throw new Error(
      "CRITICAL DATABASE CONFIGURATION ERROR: DATABASE_URL environment variable is mandatory in production mode. Silent fallback to embedded PGlite is strictly forbidden."
    );
  }

  // 2. Live PostgreSQL Mode (Supabase / Production / Staging)
  if (dbUrl) {
    if (liveDbPool && initialized) {
      return new PostgresLiveQueryAdapter(liveDbPool);
    }

    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      try {
        const isLocalhost = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
        liveDbPool = new PgPool({
          connectionString: dbUrl,
          ssl: isLocalhost ? false : { rejectUnauthorized: false },
          // 8 seconds — tolerates Vercel serverless cold-start + Supabase connection latency.
          // 2000ms was too aggressive and caused spurious 500s during function warm-up.
          connectionTimeoutMillis: 8000,
          // Serverless-appropriate pool limits: each lambda has at most 1 concurrent request.
          max: 3,
          idleTimeoutMillis: 30000,
        });

        // Test connection with a harmless query (Section 12 verification)
        const testRes = await liveDbPool.query("SELECT 1 as connected;");
        if (!testRes || testRes.rows.length === 0) {
          throw new Error("Connection health probe returned empty result.");
        }

        initialized = true;
        return new PostgresLiveQueryAdapter(liveDbPool);
      } catch (error) {
        liveDbPool = null;
        initialized = false;
        initPromise = null;
        // SECTION 51: NO SILENT FALLBACK
        throw new Error(
          `CRITICAL INFRASTRUCTURE FAILURE: Failed to connect to live PostgreSQL at DATABASE_URL: ${
            error instanceof Error ? error.message : String(error)
          }. Silent fallback to local PGlite is strictly forbidden.`
        );
      }
    })();

    return initPromise;
  }

  // 2. Embedded PGlite Mode (Local Dev & Unit/Offline Testing)
  if (isProduction) {
    throw new Error(
      "CRITICAL SECURITY VIOLATION: Embedded PGlite cannot be initialized in production runtime."
    );
  }

  if (globalDb && initialized) {
    return globalDb;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    if (!globalDb) {
      globalDb = new PGlite();
    }

    const migrator = new DatabaseMigrator(globalDb);
    const applied = await migrator.getAppliedMigrations();

    // If migrations have not been applied yet in this PGlite instance, run them
    if (applied.size === 0) {
      await migrator.migrate();

      // Apply master seeds in dev/test
      const refSeed = path.resolve(process.cwd(), "seeds", "001_reference_seed.sql");
      const devSeed = path.resolve(process.cwd(), "seeds", "002_synthetic_dev_seed.sql");
      await migrator.applySeed(refSeed);
      await migrator.applySeed(devSeed);
    }

    // Synchronize sequence with existing complaints so new complaints do not collide with seeds
    // Sequence itself is created by migration 00010_tracking_code_sequence.sql (NO RUNTIME DDL)
    const maxRes = await globalDb.query<{ max_seq: number }>(`
      SELECT COALESCE(MAX(CAST(SUBSTRING(ref_id FROM 9) AS INTEGER)), 0) as max_seq FROM complaints;
    `);
    const maxSeq = Number(maxRes.rows[0]?.max_seq ?? 0);
    if (maxSeq > 0) {
      await globalDb.query(`SELECT setval('tracking_code_seq', $1, true);`, [maxSeq]);
    } else {
      await globalDb.query(`SELECT setval('tracking_code_seq', 1, false);`);
    }

    initialized = true;
    return globalDb;
  })();

  return initPromise;
}

export interface TransactionOptions {
  actorId?: string;
  role?: string;
}

/**
 * Helper to execute a callback within an ACID transactional context.
 * In live PostgreSQL, checks out a dedicated client from pool with BEGIN/COMMIT/ROLLBACK.
 * In PGlite, uses transaction or BEGIN/COMMIT/ROLLBACK.
 * Supports transaction-scoped JWT identity context propagation (Option A ADR).
 */
export async function executeTransaction<T>(
  callback: (tx: DatabaseQueryInterface) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  const dbUrl = process.env.DATABASE_URL;

  // Live PostgreSQL transaction execution
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

  // PGlite transaction execution
  const db = (await getDatabaseClient()) as PGlite;

  if (typeof db.transaction === "function") {
    return (await db.transaction(async (tx) => {
      if (options?.actorId) {
        await (tx as DatabaseQueryInterface).query("SELECT set_config('request.jwt.claim.sub', $1, true);", [options.actorId]);
        await (tx as DatabaseQueryInterface).query("SELECT set_config('app.current_user_id', $1, true);", [options.actorId]);
      }
      return await callback(tx as DatabaseQueryInterface);
    })) as T;
  }

  await db.query("BEGIN;");
  try {
    if (options?.actorId) {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, true);", [options.actorId]);
      await db.query("SELECT set_config('app.current_user_id', $1, true);", [options.actorId]);
    }
    const result = await callback(db);
    await db.query("COMMIT;");
    return result;
  } catch (error) {
    await db.query("ROLLBACK;");
    throw error;
  }
}

/**
 * Resets the database state (Used exclusively in automated tests).
 */
export async function resetTestDatabase(): Promise<DatabaseQueryInterface> {
  if (liveDbPool) {
    await liveDbPool.end();
    liveDbPool = null;
  }
  globalDb = new PGlite();
  initialized = false;
  initPromise = null;
  return await getDatabaseClient();
}
