import { UserRole, UserRoleType } from "@/domain/complaint";
import { AuthorizationError } from "@/shared/errors/AppError";
import { DepartmentScopeViolationError } from "@/domain/complaint/DomainErrors";

export interface DelegationRequest {
  actorRole: UserRoleType;
  actorDepartmentId?: string;
  targetRole: UserRoleType;
  targetDepartmentId?: string;
}

/**
 * Institutional Authority Delegation Policy & Access Matrix.
 * Enforces strict, deny-by-default role creation and invitation boundaries.
 */
export class AuthorityDelegationPolicy {
  /**
   * Evaluates whether an actor role is permitted to invite or provision a target role,
   * respecting institutional hierarchy and departmental boundary constraints.
   *
   * @throws {AuthorizationError} when the caller lacks authority to delegate the target role.
   * @throws {DepartmentScopeViolationError} when an HOD attempts cross-department delegation.
   */
  public static validateDelegation(request: DelegationRequest): void {
    const { actorRole, actorDepartmentId, targetRole, targetDepartmentId } = request;

    switch (actorRole) {
      case UserRole.ROLE_ADMIN:
        // System Administrator / Director can delegate all institutional roles
        const adminAllowed: UserRoleType[] = [
          UserRole.ROLE_ADMIN,
          UserRole.ROLE_MANAGEMENT,
          UserRole.ROLE_DEPT_HEAD,
          UserRole.ROLE_HANDLER,
          UserRole.ROLE_FACULTY,
        ];
        if (!adminAllowed.includes(targetRole)) {
          throw new AuthorizationError(
            `Role '${actorRole}' is not authorized to delegate target role '${targetRole}'.`
          );
        }
        return;

      case UserRole.ROLE_MANAGEMENT:
        // Management can delegate Management, HOD, Handler, or Faculty
        const managementAllowed: UserRoleType[] = [
          UserRole.ROLE_MANAGEMENT,
          UserRole.ROLE_DEPT_HEAD,
          UserRole.ROLE_HANDLER,
          UserRole.ROLE_FACULTY,
        ];
        if (!managementAllowed.includes(targetRole)) {
          throw new AuthorizationError(
            `Institutional Management is not permitted to delegate '${targetRole}'.`
          );
        }
        return;

      case UserRole.ROLE_DEPT_HEAD:
        // Department Head can ONLY delegate Handler or Faculty for their OWN department
        const deptHeadAllowed: UserRoleType[] = [UserRole.ROLE_HANDLER, UserRole.ROLE_FACULTY];
        if (!deptHeadAllowed.includes(targetRole)) {
          throw new AuthorizationError(
            `Department Heads are only authorized to invite departmental Handlers or Faculty, not '${targetRole}'.`
          );
        }
        if (!actorDepartmentId || !targetDepartmentId || actorDepartmentId !== targetDepartmentId) {
          throw new DepartmentScopeViolationError(
            actorDepartmentId || "NONE",
            targetDepartmentId || "NONE",
            "Department Heads may only invite or authorize personnel within their own assigned department."
          );
        }
        return;

      default:
        // Deny by default for any other role (ROLE_STUDENT, ROLE_HANDLER, ROLE_FACULTY)
        throw new AuthorizationError(
          `Role '${actorRole}' is not authorized to create invitations or provision accounts.`
        );
    }
  }

  /**
   * Determines whether an actor is authorized to review (approve/reject) an institutional verification request.
   */
  public static canReviewVerification(
    actorRole: UserRoleType,
    actorDepartmentId: string | undefined,
    requestDepartmentId: string
  ): boolean {
    if (actorRole === UserRole.ROLE_ADMIN || actorRole === UserRole.ROLE_MANAGEMENT) {
      return true;
    }
    if (actorRole === UserRole.ROLE_DEPT_HEAD) {
      return Boolean(actorDepartmentId && actorDepartmentId === requestDepartmentId);
    }
    return false;
  }
}
