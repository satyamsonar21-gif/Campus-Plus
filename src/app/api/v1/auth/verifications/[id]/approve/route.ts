import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { requireAuthHeader } from "@/presentation/utils/authGuard";
import { AuthorizationError, NotFoundError } from "@/shared/errors/AppError";
import { DepartmentScopeViolationError } from "@/domain/complaint/DomainErrors";
import { AuthorityDelegationPolicy } from "@/domain/authority/AuthorityDelegationPolicy";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/auth/verifications/[id]/approve
 *
 * Approves an institutional verification request for faculty/handlers.
 * Activates user account in public.users and department_memberships.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const authDenied = requireAuthHeader(request);
  if (authDenied) return authDenied;

  try {
    const { id } = await params;
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);

    const db = await getDatabaseClient();

    const reqRes = await db.query<{
      id: string;
      user_id: string;
      email: string;
      department_id: string;
      requested_role: string;
      status: string;
    }>(
      `SELECT id, user_id, email, department_id, requested_role, status
       FROM institutional_verification_requests
       WHERE id = $1
       LIMIT 1;`,
      [id]
    );

    if (reqRes.rows.length === 0) {
      throw new NotFoundError("VerificationRequest", id);
    }

    const verification = reqRes.rows[0];

    const canReview = AuthorityDelegationPolicy.canReviewVerification(
      actor.role,
      actor.departmentId,
      verification.department_id
    );

    if (!canReview) {
      if (actor.role === "ROLE_DEPT_HEAD") {
        throw new DepartmentScopeViolationError(
          actor.departmentId || "NONE",
          verification.department_id,
          "Department Heads may only approve personnel verification for their own department."
        );
      }
      throw new AuthorizationError(
        `Role '${actor.role}' is not authorized to approve institutional verifications.`
      );
    }

    // 1. Mark request approved
    await db.query(
      `UPDATE institutional_verification_requests
       SET status = 'APPROVED',
           reviewed_by = $1,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2;`,
      [actor.userId, id]
    );

    // 2. Activate user profile in public.users
    await db.query(
      `UPDATE users
       SET is_active = TRUE,
           updated_at = NOW()
       WHERE id = $1;`,
      [verification.user_id]
    );

    // 3. Activate department membership
    await db.query(
      `UPDATE department_memberships
       SET is_active = TRUE
       WHERE user_id = $1 AND department_id = $2;`,
      [verification.user_id, verification.department_id]
    );

    // 4. Record immutable audit log
    await db.query(
      `INSERT INTO authority_audit_logs (
         action_type, actor_id, actor_role, target_user_id, target_email, target_role, target_department_id, metadata
       ) VALUES (
         'VERIFICATION_APPROVED', $1, $2, $3, $4, $5, $6,
         jsonb_build_object('verification_request_id', $7::text)
       );`,
      [
        actor.userId,
        actor.role,
        verification.user_id,
        verification.email,
        verification.requested_role,
        verification.department_id,
        id,
      ]
    );

    return createSuccessResponse(
      {
        verificationId: id,
        userId: verification.user_id,
        status: "APPROVED",
        message: "Institutional verification approved. User account is now active.",
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
