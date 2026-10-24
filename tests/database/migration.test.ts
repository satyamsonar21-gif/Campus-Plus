import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseMigrator } from "@/infrastructure/database/migrator";
import path from "node:path";

describe("Database Migration & Reproducibility Suite", () => {
  let db: PGlite;
  let migrator: DatabaseMigrator;

  beforeAll(async () => {
    db = new PGlite();
    migrator = new DatabaseMigrator(db);
  });

  it("should apply all 11 migrations from an empty database cleanly", async () => {
    const result = await migrator.migrate();
    expect(result.applied.length).toBe(11);
    expect(result.verified.length).toBe(0);

    // Verify _schema_migrations rows
    const res = await db.query("SELECT version, name FROM _schema_migrations ORDER BY version ASC;");
    expect(res.rows.length).toBe(11);

    // Verify tracking_code_seq created by migration 00010
    const seqRes = await db.query("SELECT nextval('tracking_code_seq') as next_val;");
    expect(Number((seqRes.rows[0] as { next_val: string }).next_val)).toBe(1);
  });

  it("should be idempotent and verify checksums on subsequent runs", async () => {
    const secondRun = await migrator.migrate();
    expect(secondRun.applied.length).toBe(0);
    expect(secondRun.verified.length).toBe(11);
  });

  it("should successfully apply reference seed and synthetic dev seed", async () => {
    const refSeedPath = path.resolve(process.cwd(), "seeds", "001_reference_seed.sql");
    await migrator.applySeed(refSeedPath);

    const rolesRes = await db.query("SELECT count(*) as count FROM roles;");
    expect(Number((rolesRes.rows[0] as { count: string }).count)).toBe(6);

    const deptsRes = await db.query("SELECT count(*) as count FROM departments;");
    expect(Number((deptsRes.rows[0] as { count: string }).count)).toBe(5);

    const devSeedPath = path.resolve(process.cwd(), "seeds", "002_synthetic_dev_seed.sql");
    await migrator.applySeed(devSeedPath);

    const usersRes = await db.query("SELECT count(*) as count FROM users;");
    expect(Number((usersRes.rows[0] as { count: string }).count)).toBe(7);

    const complaintsRes = await db.query("SELECT ref_id, title, status FROM complaints;");
    expect(complaintsRes.rows.length).toBeGreaterThanOrEqual(1);
    expect((complaintsRes.rows[0] as { ref_id: string }).ref_id).toBe("CP-2026-00001");
  });
});
