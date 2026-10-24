import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

const RegisterSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  personaId: z.enum(["student", "handler", "hod", "director", "management"]),
  identifier: z.string().min(1).max(50),
  department: z.string().optional(),
});

/**
 * POST /api/v1/auth/register
 *
 * Implements role-based registration with strict institutional access control:
 *
 * 1. STUDENT:
 *    - Public registration is allowed.
 *    - Real Supabase Auth account created.
 *    - Backend assigns ROLE_STUDENT strictly. Account is active immediately.
 *
 * 2. FACULTY / HANDLER:
 *    - Registration follows institutional verification.
 *    - Backend assigns ROLE_HANDLER strictly (cannot self-assign HOD, Director, or Management).
 *    - Account is created with is_active = false.
 *    - Enters institutional_verification_requests queue for HOD/Director approval.
 *    - Audited in authority_audit_logs.
 *
 * 3. HOD, DIRECTOR, INSTITUTIONAL MANAGEMENT:
 *    - Public registration is strictly DISABLED (HTTP 403 Forbidden).
 *    - Accounts can only be created via authorized invitation or bootstrap provisioning.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const validated = RegisterSchema.parse(body);

    // Rule 1: Strictly reject public self-registration for privileged authority roles
    if (["hod", "director", "management"].includes(validated.personaId)) {
      const roleMap: Record<string, string> = {
        hod: "Department Head (HOD)",
        director: "Director",
        management: "Institutional Management",
      };
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "PRIVILEGED_SELF_REGISTRATION_FORBIDDEN",
            message: `Public registration is disabled for ${roleMap[validated.personaId]} accounts. Privileged accounts can only be created through an authorized institutional invitation or provisioning workflow.`,
            correlation_id: crypto.randomUUID(),
          },
        },
        { status: 403 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let newUserId: string;
    let adminClient: ReturnType<typeof createClient> | null = null;

    if (supabaseUrl && serviceRoleKey) {
      // Production & Staging: Authoritative creation via Supabase Admin API
      adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email: validated.email,
        password: validated.password,
        email_confirm: true,
        user_metadata: {
          full_name: validated.fullName,
          persona_id: validated.personaId,
          identifier: validated.identifier,
        },
      });

      if (authError || !authData.user) {
        const msg = authError?.message || "Failed to create account";
        if (
          msg.toLowerCase().includes("already registered") ||
          msg.toLowerCase().includes("already exists") ||
          msg.toLowerCase().includes("unique")
        ) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "CONFLICT",
                message: "An account with this email address already exists. Please sign in instead.",
                correlation_id: crypto.randomUUID(),
              },
            },
            { status: 409 }
          );
        }

        return NextResponse.json(
          {
            success: false,
            error: {
              code: "BAD_REQUEST",
              message: msg,
              correlation_id: crypto.randomUUID(),
            },
          },
          { status: 400 }
        );
      }

      newUserId = authData.user.id;
    } else {
      // Test environment fallback when Supabase Auth credentials are not provided
      if (process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "development") {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Registration service is temporarily unavailable. Please try again later.",
              correlation_id: crypto.randomUUID(),
            },
          },
          { status: 503 }
        );
      }
      newUserId = crypto.randomUUID();
    }

    try {
      const db = await getDatabaseClient();

      // Check if email already exists in public.users
      const existingUser = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
        [validated.email]
      );
      if (existingUser.rows.length > 0) {
        if (adminClient) {
          await adminClient.auth.admin.deleteUser(newUserId).catch(() => {});
        }
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "CONFLICT",
              message: "An account with this email address already exists in the campus directory.",
              correlation_id: crypto.randomUUID(),
            },
          },
          { status: 409 }
        );
      }

      // Check duplicate roll_or_prn if provided
      if (validated.identifier) {
        const existingPrn = await db.query<{ id: string }>(
          `SELECT id FROM users WHERE roll_or_prn = $1 LIMIT 1;`,
          [validated.identifier]
        );
        if (existingPrn.rows.length > 0) {
          if (adminClient) {
            await adminClient.auth.admin.deleteUser(newUserId).catch(() => {});
          }
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "CONFLICT",
                message: "An account with this institutional roll number or PRN already exists.",
                correlation_id: crypto.randomUUID(),
              },
            },
            { status: 409 }
          );
        }
      }

      // Students are active immediately; Faculty / Handler requires institutional verification
      const isStudent = validated.personaId === "student";
      const isActive = isStudent;

      // 1. Insert user profile
      await db.query(
        `INSERT INTO users (id, email, full_name, roll_or_prn, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           full_name = EXCLUDED.full_name,
           roll_or_prn = EXCLUDED.roll_or_prn,
           is_active = EXCLUDED.is_active;`,
        [newUserId, validated.email, validated.fullName, validated.identifier, isActive]
      );

      // 2. Assign strictly trusted role (never trust client-supplied elevated roles)
      const assignedRole = isStudent ? "ROLE_STUDENT" : "ROLE_HANDLER";

      await db.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, role_id) DO NOTHING;`,
        [newUserId, assignedRole]
      );

      // 3. Resolve department membership
      let resolvedDepartmentId: string | null = null;
      if (validated.department) {
        const deptRes = await db.query<{ id: string }>(
          `SELECT id FROM departments WHERE id::text = $1 OR LOWER(name) = LOWER($1) OR LOWER(code) = LOWER($1) LIMIT 1;`,
          [validated.department]
        );
        if (deptRes.rows.length > 0) {
          resolvedDepartmentId = deptRes.rows[0].id;
          await db.query(
            `INSERT INTO department_memberships (user_id, department_id, is_active, joined_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, department_id, is_active) DO NOTHING;`,
            [newUserId, resolvedDepartmentId, isActive]
          );
        }
      }

      // 4. For Faculty / Handler: Create institutional verification request and audit record
      if (!isStudent) {
        if (!resolvedDepartmentId) {
          const firstDept = await db.query<{ id: string }>(`SELECT id FROM departments LIMIT 1;`);
          resolvedDepartmentId = firstDept.rows[0]?.id || null;
        }

        if (resolvedDepartmentId) {
          await db.query(
            `INSERT INTO institutional_verification_requests (
               user_id, email, full_name, employee_id, department_id, requested_role, status
             ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING');`,
            [
              newUserId,
              validated.email,
              validated.fullName,
              validated.identifier,
              resolvedDepartmentId,
              assignedRole,
            ]
          );

          await db.query(
            `INSERT INTO authority_audit_logs (
               action_type, target_user_id, target_email, target_role, target_department_id, metadata
             ) VALUES (
               'VERIFICATION_REQUESTED', $1, $2, $3, $4,
               jsonb_build_object('employee_id', $5::text, 'flow', 'FACULTY_ONBOARDING')
             );`,
            [newUserId, validated.email, assignedRole, resolvedDepartmentId, validated.identifier]
          );
        }
      }

      return createSuccessResponse(
        {
          userId: newUserId,
          email: validated.email,
          role: assignedRole,
          isActive,
          message: isActive
            ? "Account created successfully. You may now sign in."
            : "Faculty registration request submitted. Institutional verification by your department head or administrator is required before you can sign in.",
        },
        { status: 201 }
      );
    } catch (dbError) {
      if (adminClient) {
        await adminClient.auth.admin.deleteUser(newUserId).catch(() => {});
      }
      throw dbError;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
