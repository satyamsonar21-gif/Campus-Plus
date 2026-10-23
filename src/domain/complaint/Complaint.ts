import {
  ComplaintId,
  TrackingCode,
  UserId,
  DepartmentId,
  CategoryId,
  LocationId,
  ComplaintTitle,
  ComplaintDescription,
  Priority,
  ResolutionSummary,
  ForwardingRationale,
  ComplaintVersion,
} from "./ValueObjects";
import { ComplaintStatus, ComplaintStatusType, canTransition, isTerminalStatus } from "./ComplaintStatus";
import {
  EscalationTier,
  EscalationTierType,
  ComplaintPriority,
} from "./ComplaintTypes";
import {
  ComplaintAssignment,
  ComplaintForward,
  ComplaintEscalation,
  Resolution,
} from "./Entities";
import {
  InvalidStateTransitionError,
  ComplaintClosedError,
  SelfForwardingError,
  ReopenWindowExpiredError,
  InvalidValueObjectError,
} from "./DomainErrors";
import { DomainEvent } from "@/domain/common/DomainEvent";
import { createComplaintDomainEvent } from "./DomainEvents";
import { Result, ok, err } from "@/domain/common/Result";
import { ActorContext, AuthorizationPolicy, DomainOperation, ComplaintResourceContext } from "./policies/AuthorizationPolicy";

export interface ComplaintCreateProps {
  id?: string;
  refId: string;
  title: string;
  description: string;
  complainantId: string;
  departmentId: string;
  categoryId: string;
  locationId?: string;
  locationDetails: string;
  suggestedPriority?: string;
  officialPriority?: string;
  status?: ComplaintStatusType;
  version?: number;
  slaDueAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class Complaint {
  private readonly _id: ComplaintId;
  private readonly _refId: TrackingCode;
  private _title: ComplaintTitle;
  private _description: ComplaintDescription;
  private readonly _complainantId: UserId;
  private _departmentId: DepartmentId;
  private _categoryId: CategoryId;
  private _locationId?: LocationId;
  private _locationDetails: string;
  private _status: ComplaintStatusType;
  private _suggestedPriority: Priority;
  private _officialPriority: Priority;
  private _assignedHandlerId?: UserId;
  private _escalationTier: EscalationTierType;
  private _isEscalated: boolean;
  private _version: ComplaintVersion;
  private _slaDueAt?: string;
  private _resolvedAt?: string;
  private _closedAt?: string;
  private readonly _createdAt: string;
  private _updatedAt: string;

  private _assignments: ComplaintAssignment[] = [];
  private _forwards: ComplaintForward[] = [];
  private _escalations: ComplaintEscalation[] = [];
  private _resolution?: Resolution;
  private _uncommittedEvents: DomainEvent[] = [];

  constructor(
    id: ComplaintId,
    refId: TrackingCode,
    title: ComplaintTitle,
    description: ComplaintDescription,
    complainantId: UserId,
    departmentId: DepartmentId,
    categoryId: CategoryId,
    locationDetails: string,
    locationId?: LocationId,
    status: ComplaintStatusType = ComplaintStatus.SUBMITTED,
    suggestedPriority: Priority = new Priority(ComplaintPriority.MEDIUM),
    officialPriority: Priority = new Priority(ComplaintPriority.MEDIUM),
    assignedHandlerId?: UserId,
    escalationTier: EscalationTierType = EscalationTier.TIER_1_HANDLER,
    isEscalated: boolean = false,
    version: ComplaintVersion = new ComplaintVersion(1),
    slaDueAt?: string,
    resolvedAt?: string,
    closedAt?: string,
    createdAt?: string,
    updatedAt?: string,
    assignments: ComplaintAssignment[] = [],
    forwards: ComplaintForward[] = [],
    escalations: ComplaintEscalation[] = [],
    resolution?: Resolution
  ) {
    this._id = id;
    this._refId = refId;
    this._title = title;
    this._description = description;
    this._complainantId = complainantId;
    this._departmentId = departmentId;
    this._categoryId = categoryId;
    this._locationDetails = locationDetails;
    this._locationId = locationId;
    this._status = status;
    this._suggestedPriority = suggestedPriority;
    this._officialPriority = officialPriority;
    this._assignedHandlerId = assignedHandlerId;
    this._escalationTier = escalationTier;
    this._isEscalated = isEscalated;
    this._version = version;
    this._slaDueAt = slaDueAt;
    this._resolvedAt = resolvedAt;
    this._closedAt = closedAt;
    const now = new Date().toISOString();
    this._createdAt = createdAt ?? now;
    this._updatedAt = updatedAt ?? now;

    this._assignments = [...assignments];
    this._forwards = [...forwards];
    this._escalations = [...escalations];
    this._resolution = resolution;
  }

  // Getters
  get id(): ComplaintId { return this._id; }
  get refId(): TrackingCode { return this._refId; }
  get title(): ComplaintTitle { return this._title; }
  get description(): ComplaintDescription { return this._description; }
  get complainantId(): UserId { return this._complainantId; }
  get departmentId(): DepartmentId { return this._departmentId; }
  get categoryId(): CategoryId { return this._categoryId; }
  get locationId(): LocationId | undefined { return this._locationId; }
  get locationDetails(): string { return this._locationDetails; }
  get status(): ComplaintStatusType { return this._status; }
  get suggestedPriority(): Priority { return this._suggestedPriority; }
  get officialPriority(): Priority { return this._officialPriority; }
  get assignedHandlerId(): UserId | undefined { return this._assignedHandlerId; }
  get escalationTier(): EscalationTierType { return this._escalationTier; }
  get isEscalated(): boolean { return this._isEscalated; }
  get version(): ComplaintVersion { return this._version; }
  get slaDueAt(): string | undefined { return this._slaDueAt; }
  get resolvedAt(): string | undefined { return this._resolvedAt; }
  get closedAt(): string | undefined { return this._closedAt; }
  get createdAt(): string { return this._createdAt; }
  get updatedAt(): string { return this._updatedAt; }
  get assignments(): ReadonlyArray<ComplaintAssignment> { return this._assignments; }
  get forwards(): ReadonlyArray<ComplaintForward> { return this._forwards; }
  get escalations(): ReadonlyArray<ComplaintEscalation> { return this._escalations; }
  get resolution(): Resolution | undefined { return this._resolution; }

  public getUncommittedEvents(): ReadonlyArray<DomainEvent> {
    return this._uncommittedEvents;
  }

  public clearEvents(): void {
    this._uncommittedEvents = [];
  }

  public toResourceContext(): ComplaintResourceContext {
    return {
      complainantId: this._complainantId.toString(),
      departmentId: this._departmentId.toString(),
      assignedHandlerId: this._assignedHandlerId?.toString(),
      status: this._status,
    };
  }

  // Factory Creation
  public static create(props: ComplaintCreateProps): Result<Complaint, Error> {
    try {
      const id = new ComplaintId(props.id ?? crypto.randomUUID());
      const refId = new TrackingCode(props.refId);
      const title = new ComplaintTitle(props.title);
      const description = new ComplaintDescription(props.description);
      const complainantId = new UserId(props.complainantId);
      const departmentId = new DepartmentId(props.departmentId);
      const categoryId = new CategoryId(props.categoryId);
      const locationId = props.locationId ? new LocationId(props.locationId) : undefined;
      const suggestedPriority = new Priority(props.suggestedPriority ?? ComplaintPriority.MEDIUM);
      const officialPriority = new Priority(props.officialPriority ?? ComplaintPriority.MEDIUM);
      const status = props.status ?? ComplaintStatus.SUBMITTED;
      const version = new ComplaintVersion(props.version ?? 1);

      const complaint = new Complaint(
        id,
        refId,
        title,
        description,
        complainantId,
        departmentId,
        categoryId,
        props.locationDetails,
        locationId,
        status,
        suggestedPriority,
        officialPriority,
        undefined,
        EscalationTier.TIER_1_HANDLER,
        false,
        version,
        props.slaDueAt,
        undefined,
        undefined,
        props.createdAt,
        props.updatedAt
      );

      if (status === ComplaintStatus.SUBMITTED) {
        complaint._uncommittedEvents.push(
          createComplaintDomainEvent(id.toString(), "COMPLAINT_SUBMITTED", {
            complaintId: id.toString(),
            trackingCode: refId.toString(),
            complainantId: complainantId.toString(),
            departmentId: departmentId.toString(),
            categoryId: categoryId.toString(),
            priority: officialPriority.toString(),
            title: title.toString(),
          })
        );
      }

      return ok(complaint);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // Invariant Guard
  private checkNotClosed(operation: string): Result<void, ComplaintClosedError> {
    if (isTerminalStatus(this._status)) {
      return err(new ComplaintClosedError(this._id.toString(), operation));
    }
    return ok(undefined);
  }

  // Lifecycle Operations

  public review(actor: ActorContext): Result<void, Error> {
    const closedCheck = this.checkNotClosed("review");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.REVIEW, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!canTransition(this._status, ComplaintStatus.REVIEWED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.REVIEWED));
    }

    const previousStatus = this._status;
    this._status = ComplaintStatus.REVIEWED;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_REVIEWED", {
        complaintId: this._id.toString(),
        actorId: actor.userId,
        previousStatus,
        newStatus: this._status,
      })
    );

    return ok(undefined);
  }

  public assignHandler(handlerId: UserId, assignedBy: ActorContext, reason?: string): Result<void, Error> {
    const closedCheck = this.checkNotClosed("assignHandler");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(assignedBy, DomainOperation.ASSIGN, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!canTransition(this._status, ComplaintStatus.ASSIGNED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.ASSIGNED));
    }

    const now = new Date().toISOString();

    // End current active assignment if one exists
    const currentAssignment = this._assignments.find((a) => a.isCurrent);
    if (currentAssignment) {
      currentAssignment.endAssignment(now);
    }

    // Add new assignment
    const assignment = new ComplaintAssignment(
      {
        handlerId: handlerId.toString(),
        assignedById: assignedBy.userId,
        assignedAt: now,
        isCurrent: true,
        reason,
      },
      crypto.randomUUID()
    );
    this._assignments.push(assignment);

    this._assignedHandlerId = handlerId;
    this._status = ComplaintStatus.ASSIGNED;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_ASSIGNED", {
        complaintId: this._id.toString(),
        handlerId: handlerId.toString(),
        assignedById: assignedBy.userId,
        departmentId: this._departmentId.toString(),
      })
    );

    return ok(undefined);
  }

  public startProgress(actor: ActorContext): Result<void, Error> {
    const closedCheck = this.checkNotClosed("startProgress");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.START_PROGRESS, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!canTransition(this._status, ComplaintStatus.IN_PROGRESS)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.IN_PROGRESS));
    }

    const previousStatus = this._status;
    this._status = ComplaintStatus.IN_PROGRESS;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_PROGRESS_STARTED", {
        complaintId: this._id.toString(),
        actorId: actor.userId,
        previousStatus,
        newStatus: this._status,
      })
    );

    return ok(undefined);
  }

  public forwardDepartment(
    toDepartmentId: DepartmentId,
    actor: ActorContext,
    rationale: ForwardingRationale
  ): Result<void, Error> {
    const closedCheck = this.checkNotClosed("forwardDepartment");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.FORWARD, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    // Invariant INV-002: No self-forwarding
    if (toDepartmentId.toString() === this._departmentId.toString()) {
      return err(new SelfForwardingError(this._departmentId.toString()));
    }

    const nextSequence = this._forwards.length + 1;
    const now = new Date().toISOString();

    // Invariant INV-010: Sequential Forwarding & Anti-Deadlock (EDGE-004)
    // If nextSequence >= 3, detect circular forwarding deadlock and elevate to TIER_3_MANAGEMENT
    if (nextSequence >= 3) {
      const forwardRecord = new ComplaintForward(
        {
          fromDepartmentId: this._departmentId.toString(),
          toDepartmentId: toDepartmentId.toString(),
          forwardedById: actor.userId,
          forwardSequence: nextSequence,
          rationale: rationale.toString(),
          forwardedAt: now,
        },
        crypto.randomUUID()
      );
      this._forwards.push(forwardRecord);

      // Trigger automatic anti-deadlock escalation
      this._status = ComplaintStatus.ESCALATED;
      this._escalationTier = EscalationTier.TIER_3_MANAGEMENT;
      this._isEscalated = true;
      this._assignedHandlerId = undefined; // Clears handler for executive adjudication

      const escalation = new ComplaintEscalation(
        {
          fromTier: EscalationTier.TIER_1_HANDLER,
          toTier: EscalationTier.TIER_3_MANAGEMENT,
          escalatedById: undefined,
          isAutomated: true,
          reason: `Anti-deadlock limit reached with ${nextSequence} departmental transfers (EDGE-004 / INV-010).`,
          escalatedAt: now,
        },
        crypto.randomUUID()
      );
      this._escalations.push(escalation);
      this.advanceVersion();

      this._uncommittedEvents.push(
        createComplaintDomainEvent(this._id.toString(), "COMPLAINT_ESCALATED_ANTI_DEADLOCK", {
          complaintId: this._id.toString(),
          fromDepartmentId: this._departmentId.toString(),
          toDepartmentId: toDepartmentId.toString(),
          forwardSequence: nextSequence,
          toTier: EscalationTier.TIER_3_MANAGEMENT,
        })
      );

      return ok(undefined);
    }

    // Normal Department Forwarding
    if (!canTransition(this._status, ComplaintStatus.FORWARDED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.FORWARDED));
    }

    const forwardRecord = new ComplaintForward(
      {
        fromDepartmentId: this._departmentId.toString(),
        toDepartmentId: toDepartmentId.toString(),
        forwardedById: actor.userId,
        forwardSequence: nextSequence,
        rationale: rationale.toString(),
        forwardedAt: now,
      },
      crypto.randomUUID()
    );
    this._forwards.push(forwardRecord);

    const fromDeptId = this._departmentId;
    this._departmentId = toDepartmentId;
    this._assignedHandlerId = undefined; // Transferred department must re-assign
    this._status = ComplaintStatus.FORWARDED;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_FORWARDED", {
        complaintId: this._id.toString(),
        fromDepartmentId: fromDeptId.toString(),
        toDepartmentId: toDepartmentId.toString(),
        forwardedById: actor.userId,
        forwardSequence: nextSequence,
        rationale: rationale.toString(),
      })
    );

    return ok(undefined);
  }

  public manualEscalate(actor: ActorContext, toTier: EscalationTierType, reason: string): Result<void, Error> {
    const closedCheck = this.checkNotClosed("manualEscalate");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.ESCALATE, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!reason || reason.trim().length === 0) {
      return err(new InvalidValueObjectError("EscalationReason", "Escalation justification is mandatory (BR-013)."));
    }

    if (!canTransition(this._status, ComplaintStatus.ESCALATED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.ESCALATED));
    }

    const now = new Date().toISOString();
    const escalation = new ComplaintEscalation(
      {
        fromTier: this._escalationTier,
        toTier,
        escalatedById: actor.userId,
        isAutomated: false,
        reason: reason.trim(),
        escalatedAt: now,
      },
      crypto.randomUUID()
    );
    this._escalations.push(escalation);

    this._status = ComplaintStatus.ESCALATED;
    this._escalationTier = toTier;
    this._isEscalated = true;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_ESCALATED", {
        complaintId: this._id.toString(),
        fromTier: escalation.fromTier,
        toTier: escalation.toTier,
        isAutomated: false,
        escalatedById: actor.userId,
        reason: escalation.reason,
      })
    );

    return ok(undefined);
  }

  public systemEscalate(toTier: EscalationTierType, reason: string): Result<void, Error> {
    const closedCheck = this.checkNotClosed("systemEscalate");
    if (closedCheck.isFailure) return closedCheck;

    if (!canTransition(this._status, ComplaintStatus.ESCALATED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.ESCALATED));
    }

    const now = new Date().toISOString();
    const escalation = new ComplaintEscalation(
      {
        fromTier: this._escalationTier,
        toTier,
        escalatedById: undefined,
        isAutomated: true,
        reason,
        escalatedAt: now,
      },
      crypto.randomUUID()
    );
    this._escalations.push(escalation);

    this._status = ComplaintStatus.ESCALATED;
    this._escalationTier = toTier;
    this._isEscalated = true;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_ESCALATED", {
        complaintId: this._id.toString(),
        fromTier: escalation.fromTier,
        toTier: escalation.toTier,
        isAutomated: true,
        reason: escalation.reason,
      })
    );

    return ok(undefined);
  }

  public resolve(resolvedBy: ActorContext, summary: ResolutionSummary): Result<void, Error> {
    const closedCheck = this.checkNotClosed("resolve");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(resolvedBy, DomainOperation.RESOLVE, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!canTransition(this._status, ComplaintStatus.RESOLVED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.RESOLVED));
    }

    const now = new Date().toISOString();
    this._resolution = new Resolution(
      {
        resolvedById: resolvedBy.userId,
        summary: summary.toString(),
        resolvedAt: now,
        studentVerified: undefined,
        disputeReason: undefined,
      },
      crypto.randomUUID()
    );

    this._status = ComplaintStatus.RESOLVED;
    this._resolvedAt = now;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_RESOLVED", {
        complaintId: this._id.toString(),
        resolvedById: resolvedBy.userId,
        summary: summary.toString(),
        resolvedAt: now,
      })
    );

    return ok(undefined);
  }

  public verifyResolution(actor: ActorContext): Result<void, Error> {
    const closedCheck = this.checkNotClosed("verifyResolution");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.VERIFY_RESOLUTION, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!canTransition(this._status, ComplaintStatus.CLOSED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.CLOSED));
    }

    if (this._resolution) {
      this._resolution.verify();
    }

    const now = new Date().toISOString();
    this._status = ComplaintStatus.CLOSED;
    this._closedAt = now;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_CLOSED", {
        complaintId: this._id.toString(),
        closedAt: now,
        reason: "Complainant verified satisfaction with resolution (BR-016 / FR-017).",
        verifiedByComplainant: true,
      })
    );

    return ok(undefined);
  }

  public disputeAndReopen(
    actor: ActorContext,
    disputeReason: string,
    isEligible: boolean
  ): Result<void, Error> {
    const closedCheck = this.checkNotClosed("disputeAndReopen");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.DISPUTE_REOPEN, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!isEligible) {
      return err(new ReopenWindowExpiredError(this._resolvedAt ?? this._createdAt, 5));
    }

    const trimmedReason = disputeReason?.trim() ?? "";
    if (trimmedReason.length === 0) {
      return err(new InvalidValueObjectError("DisputeReason", "Mandatory explanation required when disputing resolution (BR-018)."));
    }

    if (!canTransition(this._status, ComplaintStatus.REOPENED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.REOPENED));
    }

    const now = new Date().toISOString();
    if (this._resolution) {
      this._resolution.dispute(trimmedReason, now);
    }

    this._status = ComplaintStatus.REOPENED;
    this._assignedHandlerId = undefined; // Reopened complaint returns to triage
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_REOPENED", {
        complaintId: this._id.toString(),
        complainantId: actor.userId,
        disputeReason: trimmedReason,
        reopenedAt: now,
      })
    );

    return ok(undefined);
  }

  public close(actor: ActorContext, reason: string): Result<void, Error> {
    const closedCheck = this.checkNotClosed("close");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.CLOSE, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!canTransition(this._status, ComplaintStatus.CLOSED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.CLOSED));
    }

    const now = new Date().toISOString();
    this._status = ComplaintStatus.CLOSED;
    this._closedAt = now;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_CLOSED", {
        complaintId: this._id.toString(),
        closedAt: now,
        reason,
        verifiedByComplainant: false,
      })
    );

    return ok(undefined);
  }

  public reject(actor: ActorContext, reason: string): Result<void, Error> {
    const closedCheck = this.checkNotClosed("reject");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.REJECT, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!reason || reason.trim().length === 0) {
      return err(new InvalidValueObjectError("RejectionReason", "Rejection rationale is mandatory (COMPLAINT-LIFECYCLE.md)."));
    }

    if (!canTransition(this._status, ComplaintStatus.REJECTED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.REJECTED));
    }

    const previousStatus = this._status;
    this._status = ComplaintStatus.REJECTED;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_REJECTED", {
        complaintId: this._id.toString(),
        actorId: actor.userId,
        previousStatus,
        newStatus: this._status,
        remarks: reason.trim(),
      })
    );

    return ok(undefined);
  }

  public markDuplicate(actor: ActorContext, originalRefId: string): Result<void, Error> {
    const closedCheck = this.checkNotClosed("markDuplicate");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.MARK_DUPLICATE, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!originalRefId || originalRefId.trim().length === 0) {
      return err(new InvalidValueObjectError("OriginalRefId", "Reference ID of master complaint is required."));
    }

    if (!canTransition(this._status, ComplaintStatus.DUPLICATE)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.DUPLICATE));
    }

    const previousStatus = this._status;
    this._status = ComplaintStatus.DUPLICATE;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_MARKED_DUPLICATE", {
        complaintId: this._id.toString(),
        actorId: actor.userId,
        previousStatus,
        newStatus: this._status,
        remarks: `Duplicate of ${originalRefId.trim()}`,
      })
    );

    return ok(undefined);
  }

  public cancel(actor: ActorContext, reason: string): Result<void, Error> {
    const closedCheck = this.checkNotClosed("cancel");
    if (closedCheck.isFailure) return closedCheck;

    const authCheck = AuthorizationPolicy.canExecute(actor, DomainOperation.CANCEL, this.toResourceContext());
    if (authCheck.isFailure) return authCheck;

    if (!canTransition(this._status, ComplaintStatus.CANCELLED)) {
      return err(new InvalidStateTransitionError(this._status, ComplaintStatus.CANCELLED));
    }

    const previousStatus = this._status;
    this._status = ComplaintStatus.CANCELLED;
    this.advanceVersion();

    this._uncommittedEvents.push(
      createComplaintDomainEvent(this._id.toString(), "COMPLAINT_CANCELLED", {
        complaintId: this._id.toString(),
        actorId: actor.userId,
        previousStatus,
        newStatus: this._status,
        remarks: reason,
      })
    );

    return ok(undefined);
  }

  private advanceVersion(): void {
    this._version = this._version.next();
    this._updatedAt = new Date().toISOString();
  }
}
