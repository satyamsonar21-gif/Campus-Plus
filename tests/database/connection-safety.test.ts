import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDatabaseClient, executeTransaction, resetTestDatabase } from "@/infrastructure/database/pool";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

describe("Database Connection Safety & Transaction Identity Context Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await resetTestDatabase();
  });

  describe("1. Production Database Fail-Fast Protection (Section 10)", () => {
    it("fails fast with an explicit error in production when DATABASE_URL is missing", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.DATABASE_URL;

      await expect(getDatabaseClient()).rejects.toThrow(
        /DATABASE_URL environment variable is mandatory in production mode/i
      );
    });

    it("strictly prohibits initializing embedded PGlite fallback in production runtime", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.DATABASE_URL;

      await expect(getDatabaseClient()).rejects.toThrow(
        /Silent fallback to embedded PGlite is strictly forbidden/i
      );
    });

    it("permits embedded PGlite in test and development environments", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
      delete process.env.DATABASE_URL;

      const client = await getDatabaseClient();
      expect(client).toBeDefined();
      expect(client instanceof PGlite).toBe(true);
    });
  });

  describe("2. Transaction-Scoped Identity Context Propagation (Option A ADR)", () => {
    const studentAId = "00000000-0000-0000-0000-000000001001";
    const studentBId = "00000000-0000-0000-0000-000000001002";

    it("propagates actor identity context locally inside transaction", async () => {
      await executeTransaction(
        async (tx) => {
          const res = await tx.query<{ sub: string; app_user: string }>(`
            SELECT 
              current_setting('request.jwt.claim.sub', true) as sub,
              current_setting('app.current_user_id', true) as app_user;
          `);
          expect(res.rows[0].sub).toBe(studentAId);
          expect(res.rows[0].app_user).toBe(studentAId);
        },
        { actorId: studentAId }
      );
    });

    it("clears identity context after transaction commit, preventing context leakage", async () => {
      // First transaction as Student A
      await executeTransaction(
        async (tx) => {
          const res = await tx.query<{ sub: string }>(`
            SELECT current_setting('request.jwt.claim.sub', true) as sub;
          `);
          expect(res.rows[0].sub).toBe(studentAId);
        },
        { actorId: studentAId }
      );

      // Subsequent transaction without actor context must not leak Student A's identity
      await executeTransaction(async (tx) => {
        const res = await tx.query<{ sub: string | null }>(`
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '') as sub;
        `);
        expect(res.rows[0].sub).toBeNull();
      });
    });

    it("clears identity context after transaction rollback, preventing context leakage", async () => {
      // Transaction as Student B that aborts
      await expect(
        executeTransaction(
          async (tx) => {
            const res = await tx.query<{ sub: string }>(`
              SELECT current_setting('request.jwt.claim.sub', true) as sub;
            `);
            expect(res.rows[0].sub).toBe(studentBId);
            throw new Error("Intentional rollback triggered");
          },
          { actorId: studentBId }
        )
      ).rejects.toThrow("Intentional rollback triggered");

      // Next transaction must see null identity
      await executeTransaction(async (tx) => {
        const res = await tx.query<{ sub: string | null }>(`
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '') as sub;
        `);
        expect(res.rows[0].sub).toBeNull();
      });
    });
  });

  describe("3. Remediation Script Execution Parity (scripts/phase_09b_remediation.sql)", () => {
    it("successfully applies phase_09b_remediation.sql idempotently on migrated database", async () => {
      const client = (await getDatabaseClient()) as PGlite;
      const remediationSqlPath = path.resolve(process.cwd(), "scripts", "phase_09b_remediation.sql");
      const remediationSql = fs.readFileSync(remediationSqlPath, "utf-8");

      // Execute remediation script
      await client.exec(remediationSql);

      // Verify that all 6 roles are present
      const rolesRes = await client.query<{ count: string }>("SELECT count(*) as count FROM roles;");
      expect(Number(rolesRes.rows[0].count)).toBe(6);

      // Verify covering indexes exist
      const idxRes = await client.query<{ count: string }>(`
        SELECT count(*) as count FROM pg_indexes 
        WHERE indexname = 'idx_complaint_assignments_complaint_id';
      `);
      expect(Number(idxRes.rows[0].count)).toBe(1);

      // Execute second time to verify idempotency
      await client.exec(remediationSql);
    });
  });
});
