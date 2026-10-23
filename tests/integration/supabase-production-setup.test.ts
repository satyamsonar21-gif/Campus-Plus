import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseMigrator } from "@/infrastructure/database/migrator";
import path from "node:path";

describe("Supabase production setup script", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    const migrator = new DatabaseMigrator(db);
    await migrator.migrate();
    await migrator.applySeed(path.resolve(process.cwd(), "seeds", "001_reference_seed.sql"));
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE supabase_auth_admin;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean NOT NULL DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      CREATE TABLE storage.objects (name text PRIMARY KEY);
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text,
        raw_user_meta_data jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await migrator.applySeed(path.resolve(process.cwd(), "scripts", "supabase_auth_and_storage_setup.sql"));
  });

  afterAll(async () => {
    await db.close();
  });

  it("synchronizes a self-sign-up as a student and ignores role claims in editable metadata", async () => {
    const id = "00000000-0000-0000-0000-000000009901";
    await db.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, $2, $3::jsonb);`,
      [id, "student@college.edu", JSON.stringify({
        full_name: "Test Student",
        roll_or_prn: "STU-9901",
        department_id: "00000000-0000-0000-0000-000000000010",
        role_id: "ROLE_ADMIN",
      })]
    );

    const user = await db.query<{ full_name: string; roll_or_prn: string }>(
      "SELECT full_name, roll_or_prn FROM users WHERE id = $1;",
      [id]
    );
    const roles = await db.query<{ role_id: string }>(
      "SELECT role_id FROM user_roles WHERE user_id = $1;",
      [id]
    );
    const membership = await db.query<{ department_id: string }>(
      "SELECT department_id::text AS department_id FROM department_memberships WHERE user_id = $1 AND is_active = TRUE;",
      [id]
    );

    expect(user.rows[0]).toEqual({ full_name: "Test Student", roll_or_prn: "STU-9901" });
    expect(roles.rows).toEqual([{ role_id: "ROLE_STUDENT" }]);
    expect(membership.rows).toEqual([{ department_id: "00000000-0000-0000-0000-000000000010" }]);
  });

  it("keeps evidence private and analytics views running with invoker permissions", async () => {
    const bucket = await db.query<{ public: boolean; file_size_limit: number }>(
      "SELECT public, file_size_limit FROM storage.buckets WHERE id = 'campus-plus-attachments';"
    );
    const storagePolicies = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';"
    );
    const functionPrivileges = await db.query<{ anon_can_execute: boolean; authenticated_can_execute: boolean }>(
      `SELECT has_function_privilege('anon', 'public.auth_has_role(character varying)', 'EXECUTE') AS anon_can_execute,
              has_function_privilege('authenticated', 'public.auth_has_role(character varying)', 'EXECUTE') AS authenticated_can_execute;`
    );
    const viewOptions = await db.query<{ reloptions: string[] | null }>(
      `SELECT reloptions FROM pg_class WHERE oid = 'public.recurring_complaint_clusters'::regclass;`
    );

    expect(bucket.rows[0]).toEqual({ public: false, file_size_limit: 5242880 });
    expect(Number(storagePolicies.rows[0].count)).toBe(0);
    expect(functionPrivileges.rows[0]).toEqual({ anon_can_execute: false, authenticated_can_execute: true });
    expect(viewOptions.rows[0].reloptions).toContain("security_invoker=true");
  });
});
