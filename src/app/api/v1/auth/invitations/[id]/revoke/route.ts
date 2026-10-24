import { NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { requireAuthHeader } from "@/presentation/utils/authGuard";
import { AuthorizationError, NotFoundError } from "@/shared/errors/AppError";
import { DepartmentScopeViolationError } from "@/domain/complaint/DomainErrors";
import { UserRole } from "@/domain/complaint";

export const dynamic = "force-dynamic";

const RevokeSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/auth/invitations/[id]/revoke
 *
 * Revokes a pending institutional invitation.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const authDenied = requireAuthHeader(request);
  if (authDenied) return authDenied;

  try {
    const { id } = await params;
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);

    // Only Admin, Management, or HOD can revoke invitations
    if (
      ![UserRole.ROLE_ADMIN, UserRole.ROLE_MANAGEMENT, UserRole.ROLE_DEPT_HEAD].includes(
        actor.role
      )
    ) {
      throw new AuthorizationError(
        `Role '${actor.role}' is not authorized to revoke institutional invitations.`
      );
    }

    const body = await request.json().catch(() => ({}));
    const validated = RevokeSchema.parse(body);

    const db = await getDatabaseClient();

    const invRes = await db.query<{
      id: string;
      email: string;
      role_id: string;
      department_id: string | null;
      status: string;
      is_used: boolean;
      is_revoked: boolean;
    }>(
      `SELECT id, email, role_id, department_id, status, is_used, is_revoked
       FROM authority_invitations
       WHERE id = $1
       LIMIT 1;`,
      [id]
    );

    if (invRes.rows.length === 0) {
      throw new NotFoundError("Invitation", id);
    }

    const invitation = invRes.rows[0];

    // HOD can only revoke invitations within their own department
    if (actor.role === UserRole.ROLE_DEPT_HEAD) {
      if (
        !actor.departmentId ||
        !invitation.department_id ||
        actor.departmentId !== invitation.department_id
      ) {
        throw new DepartmentScopeViolationError(
          actor.departmentId || "NONE",
          invitation.department_id || "NONE",
          "Department Heads may only manage invitations for their own department."
        );
      }
    }

    await db.query(
      `UPDATE authority_invitations
       SET is_revoked = TRUE,
           status = 'REVOKED',
           revoked_at = NOW(),
           revoked_by = $1,
           revocation_reason = $2
       WHERE id = $3;`,
      [actor.userId, validated.reason || "Revoked by institutional authority", id]
    );

    await db.query(
      `INSERT INTO authority_audit_logs (
         action_type, actor_id, actor_role, target_email, target_role, target_department_id, metadata
       ) VALUES (
         'INVITATION_REVOKED', $1, $2, $3, $4, $5,
         jsonb_build_object('invitation_id', $6::text, 'reason', $7::text)
       );`,
      [
        actor.userId,
        actor.role,
        invitation.email,
        invitation.role_id,
        invitation.department_id || null,
        id,
        validated.reason || "Revoked by authority",
      ]
    );

    return createSuccessResponse(
      {
        invitationId: id,
        email: invitation.email,
        isRevoked: true,
        message: "Invitation successfully revoked.",
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
