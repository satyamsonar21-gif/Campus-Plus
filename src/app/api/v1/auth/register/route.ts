import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";

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
 * Implements real Supabase Auth sign-up followed by a server-side profile insert.
 *
 * SAFETY INVARIANTS:
 * - Uses SUPABASE_SERVICE_ROLE_KEY for the admin client (never exposed to browser).
 * - The public.users row is inserted via the service-role client so it is authoritative.
 * - On any failure, the Supabase Auth user is cleaned up to avoid orphaned auth records.
 * - Privileged roles (handler, hod, director, management) require institutional
 *   verification by an admin before is_active becomes true.
 * - Students are set is_active=true immediately (standard enrollment flow).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const validated = RegisterSchema.parse(body);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
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

    // Use service-role admin client for authoritative user creation
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create the Supabase Auth user
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: validated.email,
      password: validated.password,
      email_confirm: true, // Skip email confirmation for campus self-service flow
      user_metadata: {
        full_name: validated.fullName,
        persona_id: validated.personaId,
        identifier: validated.identifier,
      },
    });

    if (authError || !authData.user) {
      const msg = authError?.message || "Failed to create account";

      // Distinguish duplicate email from other errors
      if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("unique")) {
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

    const newUserId = authData.user.id;

    try {
      // 2. Insert canonical public.users profile row
      const db = await getDatabaseClient();

      // Students become active immediately; privileged roles require admin verification
      const isActive = validated.personaId === "student";

      await db.query(
        `INSERT INTO users (id, email, full_name, roll_or_prn, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING;`,
        [newUserId, validated.email, validated.fullName, validated.identifier, isActive]
      );

      // 3. Assign role based on persona
      const roleMap: Record<string, string> = {
        student: "ROLE_STUDENT",
        handler: "ROLE_HANDLER",
        hod: "ROLE_DEPT_HEAD",
        director: "ROLE_ADMIN",
        management: "ROLE_MANAGEMENT",
      };
      const roleId = roleMap[validated.personaId] || "ROLE_STUDENT";

      await db.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, assigned_at = NOW();`,
        [newUserId, roleId]
      );

      // 4. Assign department membership if provided
      if (validated.department) {
        // Look up department by name (case-insensitive)
        const deptRes = await db.query<{ id: string }>(
          `SELECT id FROM departments WHERE LOWER(name) = LOWER($1) LIMIT 1;`,
          [validated.department]
        );
        if (deptRes.rows.length > 0) {
          await db.query(
            `INSERT INTO department_memberships (user_id, department_id, is_active, joined_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, department_id) DO NOTHING;`,
            [newUserId, deptRes.rows[0].id, isActive]
          );
        }
      }

      return createSuccessResponse(
        {
          userId: newUserId,
          email: validated.email,
          isActive,
          message: isActive
            ? "Account created successfully. You may now sign in."
            : "Account request submitted. Institutional verification is required before you can sign in.",
        },
        { status: 201 }
      );
    } catch (dbError) {
      // DB insert failed — clean up the Supabase Auth user to avoid orphaned records
      await adminClient.auth.admin.deleteUser(newUserId).catch(() => {});
      throw dbError;
    }
  } catch (error) {
    return handleApiError(error);
  }
}