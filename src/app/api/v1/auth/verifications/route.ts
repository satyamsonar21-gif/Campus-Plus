import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { requireAuthHeader } from "@/presentation/utils/authGuard";
import { AuthorizationError } from "@/shared/errors/AppError";
import { UserRole } from "@/domain/complaint";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/verifications
 *
 * Lists pending institutional verification requests.
 * Accessible only to HOD (scoped to department), Director, and Management.
 */
export async function GET(request: NextRequest) {
  const authDenied = requireAuthHeader(request);
  if (authDenied) return authDenied;

  try {
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);

    if (
      ![UserRole.ROLE_ADMIN, UserRole.ROLE_MANAGEMENT, UserRole.ROLE_DEPT_HEAD].includes(
        actor.role
      )
    ) {
      throw new AuthorizationError(
        `Role '${actor.role}' is not authorized to review institutional verifications.`
      );
    }

    const db = await getDatabaseClient();

    let query: string;
    let params: unknown[];

    if (actor.role === UserRole.ROLE_DEPT_HEAD) {
      query = `
        SELECT 
          v.id, v.user_id, v.email, v.full_name, v.employee_id,
          v.department_id, d.name as department_name,
          v.requested_role, v.status, v.created_at
        FROM institutional_verification_requests v
        JOIN departments d ON v.department_id = d.id
        WHERE v.department_id = $1
        ORDER BY v.created_at DESC;
      `;
      params = [actor.departmentId];
    } else {
      query = `
        SELECT 
          v.id, v.user_id, v.email, v.full_name, v.employee_id,
          v.department_id, d.name as department_name,
          v.requested_role, v.status, v.created_at
        FROM institutional_verification_requests v
        JOIN departments d ON v.department_id = d.id
        ORDER BY v.created_at DESC;
      `;
      params = [];
    }

    const res = await db.query(query, params);

    return createSuccessResponse(res.rows);
  } catch (error) {
    return handleApiError(error);
  }
}
