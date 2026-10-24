import { NextRequest } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { getContainer } from "@/infrastructure/container";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { requireAuthHeader } from "@/presentation/utils/authGuard";
import { AuthorityDelegationPolicy } from "@/domain/authority/AuthorityDelegationPolicy";
import { ValidationError } from "@/shared/errors/AppError";
import { UserRoleType } from "@/domain/complaint";

export const dynamic = "force-dynamic";

const CreateInvitationSchema = z.object({
  email: z.string().email(),
  roleId: z.enum([
    "ROLE_ADMIN",
    "ROLE_MANAGEMENT",
    "ROLE_DEPT_HEAD",
    "ROLE_HANDLER",
    "ROLE_FACULTY",
  ]),
  departmentId: z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      "Invalid Department UUID format"
    )
    .optional(),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

/**
 * POST /api/v1/auth/invitations
 *
 * Issues a single-use, time-limited, cryptographically hashed institutional invitation.
 */
export async function POST(request: NextRequest) {
  const authDenied = requireAuthHeader(request);
  if (authDenied) return authDenied;

  try {
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);

    const body = await request.json().catch(() => ({}));
    const validated = CreateInvitationSchema.parse(body);

    // 1. Enforce Authority Delegation Matrix
    AuthorityDelegationPolicy.validateDelegation({
      actorRole: actor.role,
      actorDepartmentId: actor.departmentId,
      targetRole: validated.roleId as UserRoleType,
      targetDepartmentId: validated.departmentId,
    });

    // 2. Validate department requirement for department-scoped roles
    if (["ROLE_DEPT_HEAD", "ROLE_HANDLER", "ROLE_FACULTY"].includes(validated.roleId)) {
      if (!validated.departmentId) {
        throw new ValidationError(
          `A department ID must be specified when inviting for role '${validated.roleId}'.`
        );
      }
    }

    const db = await getDatabaseClient();

    // 3. Cryptographically generate random token and SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const insertRes = await db.query<{
      id: string;
      email: string;
      role_id: string;
      department_id: string | null;
      expires_at: string;
    }>(
      `INSERT INTO authority_invitations (
         email, role_id, department_id, token_hash, invited_by, invited_by_role, expires_at
       ) VALUES ($1, $2, $3::uuid, $4, $5, $6, NOW() + ($7 * INTERVAL '1 day'))
       RETURNING id, email, role_id, department_id, expires_at;`,
      [
        validated.email.toLowerCase(),
        validated.roleId,
        validated.departmentId || null,
        tokenHash,
        actor.userId,
        actor.role,
        validated.expiresInDays,
      ]
    );

    const invitation = insertRes.rows[0];

    // 4. Record immutable audit log
    await db.query(
      `INSERT INTO authority_audit_logs (
         action_type, actor_id, actor_role, target_email, target_role, target_department_id, metadata
       ) VALUES (
         'INVITATION_CREATED', $1, $2, $3, $4, $5::uuid,
         jsonb_build_object('invitation_id', $6::text, 'expires_at', $7::text)
       );`,
      [
        actor.userId,
        actor.role,
        validated.email.toLowerCase(),
        validated.roleId,
        validated.departmentId || null,
        invitation.id,
        invitation.expires_at,
      ]
    );

    return createSuccessResponse(
      {
        invitationId: invitation.id,
        email: invitation.email,
        roleId: invitation.role_id,
        departmentId: invitation.department_id,
        token: rawToken, // Single exposure to authorized issuer
        expiresAt: invitation.expires_at,
        invitationUrl: `/accept-invitation?token=${rawToken}`,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
