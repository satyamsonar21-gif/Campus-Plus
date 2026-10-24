import { NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { requireAuthHeader } from "@/presentation/utils/authGuard";
import { AuthorizationError, NotFoundError } from "@/shared/errors/AppError";
import { DepartmentScopeViolationError } from "@/domain/complaint/DomainErrors";
import { AuthorityDelegationPolicy } from "@/domain/authority/AuthorityDelegationPolicy";

export const dynamic = "force-dynamic";

const RejectSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/auth/verifications/[id]/reject
 *
 * Rejects an institutional verification request for faculty/handlers.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const authDenied = requireAuthHeader(request);
  if (authDenied) return authDenied;

  try {
    const { id } = await params;
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);

    const body = await request.json().catch(() => ({}));
    const validated = RejectSchema.parse(body);

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
          "Department Heads may only manage personnel verification for their own department."
        );
      }
      throw new AuthorizationError(
        `Role '${actor.role}' is not authorized to reject institutional verifications.`
      );
    }

    // 1. Mark request rejected
    await db.query(
      `UPDATE institutional_verification_requests
       SET status = 'REJECTED',
           reviewed_by = $1,
           reviewed_at = NOW(),
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $3;`,
      [actor.userId, validated.reason || "Rejected by institutional authority", id]
    );

    // 2. Ensure user remains deactivated
    await db.query(
      `UPDATE users
       SET is_active = FALSE,
           updated_at = NOW()
       WHERE id = $1;`,
      [verification.user_id]
    );

    // 3. Record immutable audit log
    await db.query(
      `INSERT INTO authority_audit_logs (
         action_type, actor_id, actor_role, target_user_id, target_email, target_role, target_department_id, metadata
       ) VALUES (
         'VERIFICATION_REJECTED', $1, $2, $3, $4, $5, $6,
         jsonb_build_object('verification_request_id', $7::text, 'reason', $8::text)
       );`,
      [
        actor.userId,
        actor.role,
        verification.user_id,
        verification.email,
        verification.requested_role,
        verification.department_id,
        id,
        validated.reason || "Rejected by authority",
      ]
    );

    return createSuccessResponse(
      {
        verificationId: id,
        userId: verification.user_id,
        status: "REJECTED",
        message: "Institutional verification rejected.",
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
