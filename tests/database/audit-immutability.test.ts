import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseMigrator } from "@/infrastructure/database/migrator";
import path from "node:path";

describe("Database Audit Immutability Suite", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    const migrator = new DatabaseMigrator(db);
    await migrator.migrate();
    await migrator.applySeed(path.resolve(process.cwd(), "seeds", "001_reference_seed.sql"));
    await migrator.applySeed(path.resolve(process.cwd(), "seeds", "002_synthetic_dev_seed.sql"));
  });

  it("should permit inserting new audit records into action_history", async () => {
    const res = await db.query(`
      INSERT INTO action_history (
        complaint_id, actor_id, actor_role, action_type, remarks
      ) VALUES (
        '00000000-0000-0000-0000-000000002001',
        '00000000-0000-0000-0000-000000001005',
        'ROLE_DEPT_HEAD',
        'NOTE',
        'Legitimate append-only audit entry.'
      ) RETURNING id, created_at;
    `);

    expect(res.rows.length).toBe(1);
    expect((res.rows[0] as { id: string }).id).toBeDefined();
  });

  it("should strictly BLOCK any UPDATE attempt on action_history via immutability trigger", async () => {
    const existing = await db.query("SELECT id FROM action_history LIMIT 1;");
    const auditId = (existing.rows[0] as { id: string }).id;

    await expect(
      db.query(`
        UPDATE action_history
        SET remarks = 'Tampered malicious remarks'
        WHERE id = '${auditId}';
      `)
    ).rejects.toThrow(/SECURITY VIOLATION: action_history is an immutable append-only journal/);
  });

  it("should strictly BLOCK any DELETE attempt on action_history via immutability trigger", async () => {
    const existing = await db.query("SELECT id FROM action_history LIMIT 1;");
    const auditId = (existing.rows[0] as { id: string }).id;

    await expect(
      db.query(`
        DELETE FROM action_history
        WHERE id = '${auditId}';
      `)
    ).rejects.toThrow(/SECURITY VIOLATION: action_history is an immutable append-only journal/);
  });

  it("should permit inserting new audit records into authority_audit_logs", async () => {
    const res = await db.query(`
      INSERT INTO authority_audit_logs (
        action_type, actor_role, target_email, target_role, metadata
      ) VALUES (
        'BOOTSTRAP_INITIAL_AUTHORITIES',
        'SYSTEM_OPERATOR',
        'director@institution.edu',
        'ROLE_ADMIN',
        '{"provisioned": true}'::jsonb
      ) RETURNING id;
    `);

    expect(res.rows.length).toBe(1);
    expect((res.rows[0] as { id: string }).id).toBeDefined();
  });

  it("should strictly BLOCK any UPDATE or DELETE attempt on authority_audit_logs via immutability trigger", async () => {
    const existing = await db.query("SELECT id FROM authority_audit_logs LIMIT 1;");
    const auditId = (existing.rows[0] as { id: string }).id;

    await expect(
      db.query(`
        UPDATE authority_audit_logs
        SET target_email = 'tampered@institution.edu'
        WHERE id = '${auditId}';
      `)
    ).rejects.toThrow(/SECURITY VIOLATION: authority_audit_logs is an immutable append-only journal/);

    await expect(
      db.query(`
        DELETE FROM authority_audit_logs
        WHERE id = '${auditId}';
      `)
    ).rejects.toThrow(/SECURITY VIOLATION: authority_audit_logs is an immutable append-only journal/);
  });
});
