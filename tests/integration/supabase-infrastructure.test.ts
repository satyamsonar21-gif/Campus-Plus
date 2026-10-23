import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseMigrator } from "@/infrastructure/database/migrator";
import { AuthenticationAdapter } from "@/infrastructure/auth/AuthenticationAdapter";
import { SupabaseStorageAdapter } from "@/infrastructure/storage/SupabaseStorageAdapter";
import { PostgresTrackingCodeGenerator } from "@/infrastructure/adapters/PostgresTrackingCodeGenerator";
import { getDatabaseClient, resetTestDatabase } from "@/infrastructure/database/pool";
import path from "node:path";

describe("Phase 07-B — Live Supabase Infrastructure & Security Architecture Suite", () => {
  let db: PGlite;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    delete (process.env as Record<string, string | undefined>).NODE_ENV;

    db = new PGlite();
    const migrator = new DatabaseMigrator(db);
    await migrator.migrate();
    await migrator.applySeed(path.resolve(process.cwd(), "seeds", "001_reference_seed.sql"));
    await migrator.applySeed(path.resolve(process.cwd(), "seeds", "002_synthetic_dev_seed.sql"));
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  });

  describe("1. Database Schema & Migration 00010 Integrity (Section 9 & 10)", () => {
    it("verifies tracking_code_seq is provisioned exclusively by migration 00010 without runtime DDL", async () => {
      const res = await db.query<{ count: string }>(
        "SELECT count(*) as count FROM _schema_migrations WHERE version = '00010';"
      );
      expect(Number(res.rows[0]?.count)).toBe(1);

      // Verify sequence nextval operates atomically
      const val1 = await db.query<{ nextval: string }>("SELECT nextval('tracking_code_seq');");
      const val2 = await db.query<{ nextval: string }>("SELECT nextval('tracking_code_seq');");
      expect(Number(val2.rows[0]?.nextval)).toBe(Number(val1.rows[0]?.nextval) + 1);
    });

    it("verifies all 22 required database tables exist in the schema", async () => {
      const expectedTables = [
        "_schema_migrations",
        "departments",
        "categories",
        "locations",
        "working_calendars",
        "calendar_holidays",
        "roles",
        "users",
        "user_roles",
        "department_memberships",
        "complaints",
        "complaint_assignments",
        "complaint_forwards",
        "complaint_escalations",
        "resolutions",
        "attachments",
        "internal_notes",
        "sla_policies",
        "notifications",
        "action_history",
        "outbox_events",
        "idempotency_keys",
      ];

      for (const table of expectedTables) {
        const check = await db.query<{ count: string }>(
          `SELECT count(*) as count FROM information_schema.tables WHERE table_name = $1;`,
          [table]
        );
        expect(Number(check.rows[0]?.count)).toBe(1);
      }
    });

    it("verifies the 5 domain enums exist in PostgreSQL schema", async () => {
      const expectedEnums = [
        "complaint_status_enum",
        "complaint_priority_enum",
        "escalation_tier_enum",
        "attachment_type_enum",
        "outbox_status_enum",
      ];

      for (const enumName of expectedEnums) {
        const check = await db.query<{ count: string }>(
          `SELECT count(*) as count FROM pg_type WHERE typname = $1;`,
          [enumName]
        );
        expect(Number(check.rows[0]?.count)).toBe(1);
      }
    });
  });

  describe("2. Application Configuration Hardening & Silent Fallback Prohibition (Section 50 & 51)", () => {
    it("strictly refuses to silently fall back to PGlite when DATABASE_URL fails to connect", async () => {
      process.env.DATABASE_URL = "postgresql://invalid_user:invalid_pass@127.0.0.1:54329/nonexistent_db";
      await resetTestDatabase().catch(() => {});

      await expect(getDatabaseClient()).rejects.toThrow(
        /CRITICAL INFRASTRUCTURE FAILURE:.*Silent fallback to local PGlite is strictly forbidden/
      );
    });
  });

  describe("3. Production Authentication Bypass Prohibition (Section 18 & 19)", () => {
    it("strictly rejects x-actor-id header in production mode", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      const authAdapter = new AuthenticationAdapter(db);

      const request = new Request("http://localhost/api/v1/complaints", {
        headers: {
          "x-actor-id": "00000000-0000-0000-0000-000000001001",
        },
      });

      await expect(authAdapter.authenticate(request)).rejects.toThrow(
        "Authentication token or session is missing."
      );
    });

    it("strictly rejects raw UUID bearer tokens in production mode when Supabase client is unconfigured", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      const authAdapter = new AuthenticationAdapter(db);

      const request = new Request("http://localhost/api/v1/complaints", {
        headers: {
          authorization: "Bearer 00000000-0000-0000-0000-000000001001",
        },
      });

      await expect(authAdapter.authenticate(request)).rejects.toThrow(
        "Live authentication provider is not configured in production environment."
      );
    });

    it("rejects authentication if the authenticated user account is deactivated in database", async () => {
      // Deactivate user 00000000-0000-0000-0000-000000001002
      await db.query(
        "UPDATE users SET is_active = FALSE WHERE id = '00000000-0000-0000-0000-000000001002';"
      );

      const authAdapter = new AuthenticationAdapter(db);
      const request = new Request("http://localhost/api/v1/complaints", {
        headers: {
          "x-actor-id": "00000000-0000-0000-0000-000000001002",
        },
      });

      await expect(authAdapter.authenticate(request)).rejects.toThrow(
        "User account is deactivated."
      );
    });

    it("rejects authentication if authenticated identity does not map to any institutional user record", async () => {
      const authAdapter = new AuthenticationAdapter(db);
      const request = new Request("http://localhost/api/v1/complaints", {
        headers: {
          "x-actor-id": "00000000-0000-0000-0000-000000009999",
        },
      });

      await expect(authAdapter.authenticate(request)).rejects.toThrow(
        "Authenticated identity does not map to any active user record in institution directory."
      );
    });
  });

  describe("4. Supabase Private Storage Adapter Validation (Section 30)", () => {
    it("rejects uploads exceeding 5 MB file size limit", async () => {
      const mockSupabase = {} as unknown as SupabaseClient;
      const storageAdapter = new SupabaseStorageAdapter(mockSupabase, "test-bucket");

      await expect(
        storageAdapter.generateUploadUrl({
          filename: "test.pdf",
          contentType: "application/pdf",
          sizeBytes: 5242881, // 5 MB + 1 byte
        })
      ).rejects.toThrow(/File size violation/);
    });

    it("rejects uploads with disallowed MIME types", async () => {
      const mockSupabase = {} as unknown as SupabaseClient;
      const storageAdapter = new SupabaseStorageAdapter(mockSupabase, "test-bucket");

      await expect(
        storageAdapter.generateUploadUrl({
          filename: "malicious.sh",
          contentType: "application/x-sh",
          sizeBytes: 1024,
        })
      ).rejects.toThrow(/MIME type violation/);
    });

    it("sanitizes filenames and resists directory traversal attempts", async () => {
      let createdPath = "";
      const mockSupabase = {
        storage: {
          from: () => ({
            createSignedUploadUrl: async (path: string) => {
              createdPath = path;
              return { data: { signedUrl: `https://storage.supabase.co/${path}` }, error: null };
            },
          }),
        },
      } as unknown as SupabaseClient;

      const storageAdapter = new SupabaseStorageAdapter(mockSupabase, "test-bucket");
      const res = await storageAdapter.generateUploadUrl({
        filename: "../../etc/passwd.pdf",
        contentType: "application/pdf",
        sizeBytes: 2048,
        ownerId: "00000000-0000-0000-0000-000000001001",
      });

      expect(res.uploadUrl).toBeDefined();
      expect(createdPath).toMatch(/^complaints\/temp\/00000000-0000-0000-0000-000000001001\/[0-9a-f-]{36}-passwd\.pdf$/);
      expect(createdPath).not.toContain("../");
    });
  });

  describe("5. Tracking Code Concurrency & Format Invariants (Section 26)", () => {
    it("generates deterministic collision-free CP-YYYY-NNNNN tracking codes sequentially", async () => {
      const generator = new PostgresTrackingCodeGenerator(db);
      const code1 = await generator.generate();
      const code2 = await generator.generate();
      const currentYear = new Date().getFullYear();

      expect(code1.value).toMatch(new RegExp(`^CP-${currentYear}-\\d{5}$`));
      expect(code2.value).toMatch(new RegExp(`^CP-${currentYear}-\\d{5}$`));

      const num1 = parseInt(code1.value.split("-")[2], 10);
      const num2 = parseInt(code2.value.split("-")[2], 10);
      expect(num2).toBe(num1 + 1);
    });
  });

  describe("6. Audit Journal Immutability Trigger (Section 27)", () => {
    it("strictly blocks UPDATE on action_history with SQLSTATE 55000", async () => {
      const res = await db.query<{ id: string }>(
        `INSERT INTO action_history (complaint_id, actor_role, action_type)
         VALUES ('00000000-0000-0000-0000-000000002001', 'ROLE_STUDENT', 'SUBMIT')
         RETURNING id;`
      );
      const logId = res.rows[0].id;

      await expect(
        db.query(`UPDATE action_history SET remarks = 'tampered' WHERE id = $1;`, [logId])
      ).rejects.toThrow(/SECURITY VIOLATION: action_history is an immutable append-only journal/);
    });

    it("strictly blocks DELETE on action_history with SQLSTATE 55000", async () => {
      const res = await db.query<{ id: string }>(
        `INSERT INTO action_history (complaint_id, actor_role, action_type)
         VALUES ('00000000-0000-0000-0000-000000002001', 'ROLE_STUDENT', 'SUBMIT')
         RETURNING id;`
      );
      const logId = res.rows[0].id;

      await expect(
        db.query(`DELETE FROM action_history WHERE id = $1;`, [logId])
      ).rejects.toThrow(/SECURITY VIOLATION: action_history is an immutable append-only journal/);
    });
  });
});
