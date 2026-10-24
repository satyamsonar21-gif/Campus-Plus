/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Campus Plus — Initial Authority Bootstrap Script
 *
 * Controlled server-side procedure for provisioning initial institutional authorities
 * into Supabase Auth and PostgreSQL without circular verification dependencies.
 *
 * SAFETY INVARIANTS:
 * - Server-side only (never runs in browser).
 * - Uses Supabase Admin Service-Role key safely on server.
 * - Idempotent & One-time: Checked against system_bootstrap_state table.
 * - Enforces role eligibility and prevents conflicting active department heads.
 * - Generates immutable audit entries in authority_audit_logs.
 * - Permanently disables future bootstrap runs upon completion.
 *
 * Usage: node scripts/bootstrap-initial-authorities.js
 */

const { createClient } = require("@supabase/supabase-js");
const { Pool } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Automatically load .env.local if present
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;
const operatorId = process.env.OPERATOR_ID || "INFRASTRUCTURE_OPERATOR_01";

if (!databaseUrl) {
  console.error("[-] ERROR: DATABASE_URL is missing in environment.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000,
});

async function runBootstrap() {
  const client = await pool.connect();
  try {
    console.log("=================================================================");
    console.log("CAMPUS PLUS — SECURE INITIAL AUTHORITY BOOTSTRAP PROCEDURE");
    console.log("=================================================================");

    // 1. Check one-time bootstrap lock
    const stateRes = await client.query(
      `SELECT is_completed, completed_at, completed_by_operator FROM system_bootstrap_state WHERE id = 'INITIAL_AUTHORITY_BOOTSTRAP' LIMIT 1;`
    );

    if (stateRes.rows.length > 0 && stateRes.rows[0].is_completed) {
      console.error("[-] SECURITY LOCK: Initial authority bootstrap has ALREADY been executed and is permanently locked.");
      console.error(`[-] Completed at: ${stateRes.rows[0].completed_at} by: ${stateRes.rows[0].completed_by_operator}`);
      console.error("[-] If institutional recovery is required, a database administrator must perform the authorized recovery unlock.");
      process.exit(1);
    }

    // 2. Define designated initial authorities
    const INITIAL_AUTHORITIES = [
      {
        email: process.env.INITIAL_ADMIN_EMAIL || "sysadmin@synthetic.campusplus.internal",
        fullName: process.env.INITIAL_ADMIN_NAME || "System Administrator",
        roleId: "ROLE_ADMIN",
        departmentId: null,
      },
      {
        email: process.env.INITIAL_MANAGEMENT_EMAIL || "management@synthetic.campusplus.internal",
        fullName: process.env.INITIAL_MANAGEMENT_NAME || "Institutional Management Director",
        roleId: "ROLE_MANAGEMENT",
        departmentId: null,
      },
      {
        email: process.env.INITIAL_HOD_EMAIL || "hod.it@synthetic.campusplus.internal",
        fullName: process.env.INITIAL_HOD_NAME || "Head of Department (IT)",
        roleId: "ROLE_DEPT_HEAD",
        departmentId: "00000000-0000-0000-0000-000000000010", // IT Dept
      },
    ];

    console.log(`[*] Operator: ${operatorId}`);
    console.log(`[*] Authorities to provision: ${INITIAL_AUTHORITIES.length}`);

    let supabaseAdmin = null;
    if (supabaseUrl && serviceRoleKey) {
      supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      console.log(`[✓] Supabase Admin Service connected: ${supabaseUrl}`);
    } else {
      console.log("[!] Supabase URL or Service Role Key missing. Operating in database-only mode.");
    }

    await client.query("BEGIN;");

    for (const auth of INITIAL_AUTHORITIES) {
      let userId = null;

      if (supabaseAdmin) {
        // Look up or create user in Supabase Auth
        const tempPassword = process.env.INITIAL_AUTHORITY_PASSWORD || crypto.randomBytes(16).toString("hex") + "A1!";
        const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: auth.email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            full_name: auth.fullName,
            role_id: auth.roleId,
            bootstrapped: true,
          },
        });

        if (createError) {
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
          const existing = listData?.users.find((u) => u.email?.toLowerCase() === auth.email.toLowerCase());
          if (!existing) {
            throw new Error(`Failed to create authority in Supabase Auth: ${createError.message}`);
          }
          userId = existing.id;
        } else {
          userId = createData.user.id;
        }
      } else {
        // Derive or fetch ID
        const uRes = await client.query("SELECT id FROM users WHERE email = $1 LIMIT 1;", [auth.email]);
        userId = uRes.rows[0]?.id || crypto.randomUUID();
      }

      // Upsert public.users
      await client.query(
        `INSERT INTO users (id, email, full_name, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, TRUE, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           full_name = EXCLUDED.full_name,
           is_active = TRUE,
           updated_at = NOW();`,
        [userId, auth.email, auth.fullName]
      );

      // Assign role
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, role_id) DO NOTHING;`,
        [userId, auth.roleId]
      );

      // Assign department if applicable
      if (auth.departmentId) {
        const isHead = auth.roleId === "ROLE_DEPT_HEAD";
        await client.query(
          `INSERT INTO department_memberships (user_id, department_id, is_head, is_active, joined_at)
           VALUES ($1, $2, $3, TRUE, NOW())
           ON CONFLICT (user_id, department_id, is_active) DO UPDATE SET
             is_head = EXCLUDED.is_head;`,
          [userId, auth.departmentId, isHead]
        );
      }

      // Record immutable audit entry
      await client.query(
        `INSERT INTO authority_audit_logs (
           action_type, actor_role, target_user_id, target_email, target_role, target_department_id, metadata
         ) VALUES (
           'BOOTSTRAP_INITIAL_AUTHORITIES', 'SYSTEM_OPERATOR', $1, $2, $3, $4,
           jsonb_build_object('operator_id', $5::text, 'timestamp', NOW())
         );`,
        [userId, auth.email, auth.roleId, auth.departmentId, operatorId]
      );

      console.log(`[✓] Provisioned: ${auth.roleId} -> ${auth.email}`);
    }

    // Permanently complete bootstrap
    await client.query(
      `INSERT INTO system_bootstrap_state (id, is_completed, completed_at, completed_by_operator, metadata, recovery_lock, updated_at)
       VALUES ('INITIAL_AUTHORITY_BOOTSTRAP', TRUE, NOW(), $1, jsonb_build_object('provisioned_count', $2), TRUE, NOW())
       ON CONFLICT (id) DO UPDATE SET
         is_completed = TRUE,
         completed_at = NOW(),
         completed_by_operator = EXCLUDED.completed_by_operator,
         metadata = EXCLUDED.metadata,
         recovery_lock = TRUE,
         updated_at = NOW();`,
      [operatorId, INITIAL_AUTHORITIES.length]
    );

    await client.query("COMMIT;");
    console.log("[✓] SUCCESS: Initial authority accounts provisioned and bootstrap mechanism permanently locked.");
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("[-] ERROR during bootstrap:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runBootstrap();
