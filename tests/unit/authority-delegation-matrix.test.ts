import { describe, it, expect } from "vitest";
import { AuthorityDelegationPolicy } from "@/domain/authority/AuthorityDelegationPolicy";
import { UserRole, UserRoleType } from "@/domain/complaint";
import { AuthorizationError } from "@/shared/errors/AppError";
import { DepartmentScopeViolationError } from "@/domain/complaint/DomainErrors";

describe("Authority Delegation Policy & Authorization Matrix Unit Suite", () => {
  const DEPT_IT = "00000000-0000-0000-0000-000000000010";
  const DEPT_HOSTEL = "00000000-0000-0000-0000-000000000020";

  describe("Director / System Administrator (ROLE_ADMIN)", () => {
    it("permits delegating all institutional roles globally", () => {
      const allowedRoles = [
        UserRole.ROLE_ADMIN,
        UserRole.ROLE_MANAGEMENT,
        UserRole.ROLE_DEPT_HEAD,
        UserRole.ROLE_HANDLER,
        UserRole.ROLE_FACULTY,
      ];

      for (const targetRole of allowedRoles) {
        expect(() =>
          AuthorityDelegationPolicy.validateDelegation({
            actorRole: UserRole.ROLE_ADMIN,
            targetRole,
            targetDepartmentId: DEPT_IT,
          })
        ).not.toThrow();
      }
    });

    it("rejects delegating invalid or non-existent roles", () => {
      expect(() =>
        AuthorityDelegationPolicy.validateDelegation({
          actorRole: UserRole.ROLE_ADMIN,
          targetRole: "ROLE_UNKNOWN" as unknown as UserRoleType,
        })
      ).toThrow(AuthorizationError);
    });
  });

  describe("Institutional Management (ROLE_MANAGEMENT)", () => {
    it("permits delegating Management, HOD, and Staff roles", () => {
      const allowedRoles = [
        UserRole.ROLE_MANAGEMENT,
        UserRole.ROLE_DEPT_HEAD,
        UserRole.ROLE_HANDLER,
        UserRole.ROLE_FACULTY,
      ];

      for (const targetRole of allowedRoles) {
        expect(() =>
          AuthorityDelegationPolicy.validateDelegation({
            actorRole: UserRole.ROLE_MANAGEMENT,
            targetRole,
            targetDepartmentId: DEPT_IT,
          })
        ).not.toThrow();
      }
    });

    it("strictly prohibits Management from delegating System Administrator (ROLE_ADMIN)", () => {
      expect(() =>
        AuthorityDelegationPolicy.validateDelegation({
          actorRole: UserRole.ROLE_MANAGEMENT,
          targetRole: UserRole.ROLE_ADMIN,
        })
      ).toThrow(AuthorizationError);
    });
  });

  describe("Department Head (ROLE_DEPT_HEAD)", () => {
    it("permits inviting Handler and Faculty within own department", () => {
      expect(() =>
        AuthorityDelegationPolicy.validateDelegation({
          actorRole: UserRole.ROLE_DEPT_HEAD,
          actorDepartmentId: DEPT_IT,
          targetRole: UserRole.ROLE_HANDLER,
          targetDepartmentId: DEPT_IT,
        })
      ).not.toThrow();

      expect(() =>
        AuthorityDelegationPolicy.validateDelegation({
          actorRole: UserRole.ROLE_DEPT_HEAD,
          actorDepartmentId: DEPT_IT,
          targetRole: UserRole.ROLE_FACULTY,
          targetDepartmentId: DEPT_IT,
        })
      ).not.toThrow();
    });

    it("strictly blocks inviting staff to a different department (horizontal isolation)", () => {
      expect(() =>
        AuthorityDelegationPolicy.validateDelegation({
          actorRole: UserRole.ROLE_DEPT_HEAD,
          actorDepartmentId: DEPT_IT,
          targetRole: UserRole.ROLE_HANDLER,
          targetDepartmentId: DEPT_HOSTEL,
        })
      ).toThrow(DepartmentScopeViolationError);
    });

    it("strictly blocks Department Head from delegating privileged authority roles", () => {
      const forbiddenRoles = [
        UserRole.ROLE_ADMIN,
        UserRole.ROLE_MANAGEMENT,
        UserRole.ROLE_DEPT_HEAD,
      ];

      for (const targetRole of forbiddenRoles) {
        expect(() =>
          AuthorityDelegationPolicy.validateDelegation({
            actorRole: UserRole.ROLE_DEPT_HEAD,
            actorDepartmentId: DEPT_IT,
            targetRole,
            targetDepartmentId: DEPT_IT,
          })
        ).toThrow(AuthorizationError);
      }
    });
  });

  describe("Unprivileged Roles (Deny by Default)", () => {
    it("rejects Handler attempting to invite any role", () => {
      expect(() =>
        AuthorityDelegationPolicy.validateDelegation({
          actorRole: UserRole.ROLE_HANDLER,
          actorDepartmentId: DEPT_IT,
          targetRole: UserRole.ROLE_HANDLER,
          targetDepartmentId: DEPT_IT,
        })
      ).toThrow(AuthorizationError);
    });

    it("rejects Student attempting to invite any role", () => {
      expect(() =>
        AuthorityDelegationPolicy.validateDelegation({
          actorRole: UserRole.ROLE_STUDENT,
          targetRole: UserRole.ROLE_HANDLER,
        })
      ).toThrow(AuthorizationError);
    });
  });

  describe("Verification Review Access", () => {
    it("authorizes Admin and Management to review verifications across any department", () => {
      expect(
        AuthorityDelegationPolicy.canReviewVerification(UserRole.ROLE_ADMIN, undefined, DEPT_IT)
      ).toBe(true);
      expect(
        AuthorityDelegationPolicy.canReviewVerification(UserRole.ROLE_MANAGEMENT, undefined, DEPT_HOSTEL)
      ).toBe(true);
    });

    it("authorizes Department Head only for their own department", () => {
      expect(
        AuthorityDelegationPolicy.canReviewVerification(UserRole.ROLE_DEPT_HEAD, DEPT_IT, DEPT_IT)
      ).toBe(true);
      expect(
        AuthorityDelegationPolicy.canReviewVerification(UserRole.ROLE_DEPT_HEAD, DEPT_IT, DEPT_HOSTEL)
      ).toBe(false);
    });

    it("denies Handler and Student from reviewing verifications", () => {
      expect(
        AuthorityDelegationPolicy.canReviewVerification(UserRole.ROLE_HANDLER, DEPT_IT, DEPT_IT)
      ).toBe(false);
      expect(
        AuthorityDelegationPolicy.canReviewVerification(UserRole.ROLE_STUDENT, undefined, DEPT_IT)
      ).toBe(false);
    });
  });
});
