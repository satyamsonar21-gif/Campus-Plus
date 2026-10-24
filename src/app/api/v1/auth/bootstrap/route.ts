import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import crypto from "node:crypto";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import {
  BootstrapAlreadyCompletedError,
  BootstrapUnauthorizedError,
} from "@/domain/authority/AuthorityErrors";
import { ValidationError } from "@/shared/errors/AppError";

export const dynamic = "force-dynamic";

const AuthorityItemSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(100),
  roleId: z.enum([
    "ROLE_ADMIN",
    "ROLE_MANAGEMENT",
    "ROLE_DEPT_HEAD",
    "ROLE_HANDLER",
  ]),
  departmentId: z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      "Invalid Department UUID"
    )
    .optional(),
  password: z.string().min(8).max(128).optional(),
});

const BootstrapSchema = z.object({
  operatorId: z.string().min(3).max(100),
  authorities: z.array(AuthorityItemSchema).min(1),
});

/**
 * POST /api/v1/auth/bootstrap
 *
 * Secure Initial Institutional Authority Bootstrap Mechanism.
 *
 * SAFETY INVARIANTS:
 * - Requires server-only secret via x-bootstrap-secret header.
 * - Idempotent and one-time: Once completed, permanently locked.
 * - Enforces role eligibility and prevents conflicting privileged roles.
 * - Provisions Supabase Auth and PostgreSQL profiles in tandem.
 * - Appends immutable records to authority_audit_logs.
 * - Never returns or logs plaintext credentials.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authorize operator via server-only bootstrap secret
    const bootstrapSecret =
      process.env.BOOTSTRAP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const providedSecret =
      request.headers.get("x-bootstrap-secret") ||
      request.headers.get("authorization")?.replace("Bearer ", "");

    if (!bootstrapSecret || !providedSecret || providedSecret !== bootstrapSecret) {
      throw new BootstrapUnauthorizedError(
        "Invalid or missing institutional bootstrap authorization secret."
      );
    }

    const body = await request.json().catch(() => ({}));
    const validated = BootstrapSchema.parse(body);

    const db = await getDatabaseClient();

    // 2. Check if bootstrap has already been executed (One-Time Gate)
    const stateRes = await db.query<{ is_completed: boolean; recovery_lock: boolean }>(
      `SELECT is_completed, recovery_lock FROM system_bootstrap_state WHERE id = 'INITIAL_AUTHORITY_BOOTSTRAP' LIMIT 1;`
    );

    if (stateRes.rows.length > 0 && stateRes.rows[0].is_completed) {
      throw new BootstrapAlreadyCompletedError(
        "Initial institutional authority bootstrap has already been executed and is permanently locked."
      );
    }

    // 3. Validate authority definitions and prevent conflicts
    const seenEmails = new Set<string>();
    for (const auth of validated.authorities) {
      const emailLower = auth.email.toLowerCase();
      if (seenEmails.has(emailLower)) {
        throw new ValidationError(`Duplicate authority email in bootstrap payload: '${auth.email}'.`);
      }
      seenEmails.add(emailLower);

      if (auth.roleId === "ROLE_DEPT_HEAD" || auth.roleId === "ROLE_HANDLER") {
        if (!auth.departmentId) {
          throw new ValidationError(
            `Department ID is required for authority role '${auth.roleId}' (${auth.email}).`
          );
        }

        const deptCheck = await db.query<{ id: string; is_active: boolean }>(
          `SELECT id, is_active FROM departments WHERE id = $1 LIMIT 1;`,
          [auth.departmentId]
        );
        if (deptCheck.rows.length === 0 || !deptCheck.rows[0].is_active) {
          throw new ValidationError(
            `Designated department '${auth.departmentId}' for '${auth.email}' does not exist or is inactive.`
          );
        }

        // Prevent conflicting multiple active department heads
        if (auth.roleId === "ROLE_DEPT_HEAD") {
          const headCheck = await db.query<{ user_id: string }>(
            `SELECT user_id FROM department_memberships WHERE department_id = $1 AND is_head = TRUE AND is_active = TRUE LIMIT 1;`,
            [auth.departmentId]
          );
          if (headCheck.rows.length > 0) {
            throw new ValidationError(
              `Department '${auth.departmentId}' already has an active department head appointed.`
            );
          }
        }
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let adminClient: ReturnType<typeof createClient> | null = null;
    if (supabaseUrl && serviceRoleKey) {
      adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }

    const provisionedUsers: Array<{ id: string; email: string; role: string }> = [];

    // 4. Provision each initial authority
    for (const auth of validated.authorities) {
      let userId: string;

      if (adminClient) {
        // Look up or create Supabase Auth identity
        const initialPassword = auth.password || crypto.randomBytes(16).toString("hex") + "A1!";
        const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
          email: auth.email,
          password: initialPassword,
          email_confirm: true,
          user_metadata: {
            full_name: auth.fullName,
            role_id: auth.roleId,
            bootstrapped: true,
          },
        });

        if (createError) {
          // If already exists, lookup user
          const { data: listData } = await adminClient.auth.admin.listUsers();
          const existing = listData?.users.find((u) => u.email?.toLowerCase() === auth.email.toLowerCase());
          if (!existing) {
            throw new Error(`Failed to provision authority '${auth.email}' in auth directory: ${createError.message}`);
          }
          userId = existing.id;
          if (auth.password) {
            await adminClient.auth.admin.updateUserById(userId, {
              password: auth.password,
              email_confirm: true,
            });
          }
        } else {
          userId = createData.user.id;
        }
      } else {
        userId = crypto.randomUUID();
      }

      // Upsert public.users profile
      await db.query(
        `INSERT INTO users (id, email, full_name, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, TRUE, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           full_name = EXCLUDED.full_name,
           is_active = TRUE,
           updated_at = NOW();`,
        [userId, auth.email, auth.fullName]
      );

      // Assign authority role
      await db.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, role_id) DO NOTHING;`,
        [userId, auth.roleId]
      );

      // Assign department membership if applicable
      if (auth.departmentId) {
        const isHead = auth.roleId === "ROLE_DEPT_HEAD";
        await db.query(
          `INSERT INTO department_memberships (user_id, department_id, is_head, is_active, joined_at)
           VALUES ($1, $2, $3, TRUE, NOW())
           ON CONFLICT (user_id, department_id, is_active) DO UPDATE SET
             is_head = EXCLUDED.is_head;`,
          [userId, auth.departmentId, isHead]
        );
      }

      // Record immutable audit record
      await db.query(
        `INSERT INTO authority_audit_logs (
           action_type, actor_role, target_user_id, target_email, target_role, target_department_id, metadata
         ) VALUES (
           'BOOTSTRAP_INITIAL_AUTHORITIES', 'SYSTEM_OPERATOR', $1, $2, $3, $4::uuid,
           jsonb_build_object('operator_id', $5::text, 'timestamp', NOW())
         );`,
        [userId, auth.email, auth.roleId, auth.departmentId || null, validated.operatorId]
      );

      provisionedUsers.push({ id: userId, email: auth.email, role: auth.roleId });
    }

    // 5. Permanently lock bootstrap state
    await db.query(
      `INSERT INTO system_bootstrap_state (id, is_completed, completed_at, completed_by_operator, metadata, recovery_lock, updated_at)
       VALUES ('INITIAL_AUTHORITY_BOOTSTRAP', TRUE, NOW(), $1, jsonb_build_object('provisioned_count', $2::int), TRUE, NOW())
       ON CONFLICT (id) DO UPDATE SET
         is_completed = TRUE,
         completed_at = NOW(),
         completed_by_operator = EXCLUDED.completed_by_operator,
         metadata = EXCLUDED.metadata,
         recovery_lock = TRUE,
         updated_at = NOW();`,
      [validated.operatorId, provisionedUsers.length]
    );

    return createSuccessResponse(
      {
        isCompleted: true,
        operatorId: validated.operatorId,
        provisionedCount: provisionedUsers.length,
        provisionedAuthorities: provisionedUsers.map((u) => ({
          email: u.email,
          role: u.role,
        })),
        message:
          "Initial institutional authority accounts successfully bootstrapped. The bootstrap mechanism is now permanently locked.",
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
