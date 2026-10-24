import { AppError } from "@/shared/errors/AppError";
import { ErrorCodes } from "@/shared/errors/ErrorCodes";

export class AccountPendingApprovalError extends AppError {
  constructor(message = "Your institutional onboarding request is currently pending departmental verification.") {
    super({
      message,
      code: "ACCOUNT_PENDING_APPROVAL" as any,
      statusCode: 403,
    });
  }
}

export class AccountDeactivatedError extends AppError {
  constructor(message = "Your campus account access has been deactivated or revoked by institutional administration.") {
    super({
      message,
      code: "ACCOUNT_REVOKED" as any,
      statusCode: 403,
    });
  }
}

export class MissingRoleMappingError extends AppError {
  constructor(message = "Your account is active, but no institutional role has been assigned to your profile.") {
    super({
      message,
      code: "MISSING_ROLE_MAPPING" as any,
      statusCode: 403,
    });
  }
}

export class IdentityNotMappedError extends AppError {
  constructor(message = "Your authentication credentials are valid, but your institutional profile has not been provisioned in the directory.") {
    super({
      message,
      code: "IDENTITY_NOT_MAPPED" as any,
      statusCode: 401,
    });
  }
}

export class PrivilegedRegistrationForbiddenError extends AppError {
  constructor(roleLabel: string) {
    super({
      message: `Public self-registration is disabled for ${roleLabel} accounts. Privileged accounts must be provisioned through an authorized institutional invitation or bootstrap workflow.`,
      code: ErrorCodes.FORBIDDEN,
      statusCode: 403,
    });
  }
}

export class BootstrapAlreadyCompletedError extends AppError {
  constructor(message = "Initial institutional authority bootstrap has already been executed and is permanently locked.") {
    super({
      message,
      code: ErrorCodes.CONFLICT,
      statusCode: 409,
    });
  }
}

export class BootstrapUnauthorizedError extends AppError {
  constructor(message = "Invalid or missing institutional bootstrap authorization secret.") {
    super({
      message,
      code: ErrorCodes.UNAUTHENTICATED,
      statusCode: 401,
    });
  }
}

export class InvitationNotFoundError extends AppError {
  constructor(message = "Invitation token was not found or is invalid.") {
    super({
      message,
      code: ErrorCodes.NOT_FOUND,
      statusCode: 404,
    });
  }
}

export class InvitationExpiredError extends AppError {
  constructor(message = "This invitation token has expired. Please contact your institution for a new invitation.") {
    super({
      message,
      code: "INVITATION_EXPIRED" as any,
      statusCode: 410,
    });
  }
}

export class InvitationAlreadyUsedError extends AppError {
  constructor(message = "This invitation token has already been accepted and cannot be reused.") {
    super({
      message,
      code: ErrorCodes.CONFLICT,
      statusCode: 409,
    });
  }
}

export class InvitationRevokedError extends AppError {
  constructor(message = "This invitation has been revoked by institutional administration.") {
    super({
      message,
      code: "INVITATION_REVOKED" as any,
      statusCode: 403,
    });
  }
}

export class InvitationEmailMismatchError extends AppError {
  constructor(message = "The invitation token is bound to a different email address.") {
    super({
      message,
      code: ErrorCodes.FORBIDDEN,
      statusCode: 403,
    });
  }
}
