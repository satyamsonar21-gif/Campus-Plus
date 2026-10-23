import { Complaint, ActorContext, UserRole } from "@/domain/complaint";

export interface ComplaintAttachmentDTO {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: string;
}

export interface StudentComplaintDTO {
  id: string;
  trackingCode: string;
  title: string;
  description: string;
  categoryId: string;
  departmentId: string;
  locationDetails: string;
  status: string;
  suggestedPriority: string;
  officialPriority: string;
  version: number;
  isEscalated: boolean;
  slaDueAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  attachments?: ComplaintAttachmentDTO[];
  resolution?: {
    summary: string;
    resolvedAt: string;
    studentVerified?: boolean;
    disputeReason?: string;
  };
}

export interface StaffComplaintDTO extends StudentComplaintDTO {
  complainantId: string;
  assignedHandlerId?: string;
  escalationTier: string;
  assignments: Array<{
    id: string;
    handlerId: string;
    assignedById: string;
    assignedAt: string;
    unassignedAt?: string;
    isCurrent: boolean;
    reason?: string;
  }>;
  forwards: Array<{
    id: string;
    fromDepartmentId: string;
    toDepartmentId: string;
    forwardedById: string;
    forwardSequence: number;
    rationale: string;
    forwardedAt: string;
  }>;
  escalations: Array<{
    id: string;
    fromTier: string;
    toTier: string;
    escalatedById?: string;
    isAutomated: boolean;
    reason: string;
    escalatedAt: string;
  }>;
}

export interface TimelineEventDTO {
  id: string;
  complaintId: string;
  actorRole: string;
  actionType: string;
  fromStatus: string | null;
  toStatus: string | null;
  remarks: string | null;
  createdAt: string;
}

/**
 * Projects a domain Complaint aggregate into the appropriate role-scoped DTO.
 * Guarantees zero leakage of internal staff notes, staff PII, or internal administrative metadata to students.
 */
export function toComplaintDTO(
  complaint: Complaint,
  actor: ActorContext
): StudentComplaintDTO | StaffComplaintDTO {
  const isStudent =
    actor.role === UserRole.ROLE_STUDENT || actor.role === UserRole.ROLE_FACULTY;

  const base: StudentComplaintDTO = {
    id: complaint.id.toString(),
    trackingCode: complaint.refId.toString(),
    title: complaint.title.toString(),
    description: complaint.description.toString(),
    categoryId: complaint.categoryId.toString(),
    departmentId: complaint.departmentId.toString(),
    locationDetails: complaint.locationDetails,
    status: complaint.status,
    suggestedPriority: complaint.suggestedPriority.toString(),
    officialPriority: complaint.officialPriority.toString(),
    version: complaint.version.toNumber(),
    isEscalated: complaint.isEscalated,
    slaDueAt: complaint.slaDueAt,
    resolvedAt: complaint.resolvedAt,
    closedAt: complaint.closedAt,
    createdAt: complaint.createdAt,
    updatedAt: complaint.updatedAt,
    resolution: complaint.resolution
      ? {
          summary: complaint.resolution.summary,
          resolvedAt: complaint.resolution.resolvedAt,
          studentVerified: complaint.resolution.studentVerified,
          disputeReason: complaint.resolution.disputeReason,
        }
      : undefined,
  };

  if (isStudent) {
    return base;
  }

  const staffDTO: StaffComplaintDTO = {
    ...base,
    complainantId: complaint.complainantId.toString(),
    assignedHandlerId: complaint.assignedHandlerId?.toString(),
    escalationTier: complaint.escalationTier,
    assignments: complaint.assignments.map((a) => ({
      id: a.id,
      handlerId: a.handlerId,
      assignedById: a.assignedById,
      assignedAt: a.assignedAt,
      unassignedAt: a.unassignedAt,
      isCurrent: a.isCurrent,
      reason: a.reason,
    })),
    forwards: complaint.forwards.map((f) => ({
      id: f.id,
      fromDepartmentId: f.fromDepartmentId,
      toDepartmentId: f.toDepartmentId,
      forwardedById: f.forwardedById,
      forwardSequence: f.forwardSequence,
      rationale: f.rationale,
      forwardedAt: f.forwardedAt,
    })),
    escalations: complaint.escalations.map((e) => ({
      id: e.id,
      fromTier: e.fromTier,
      toTier: e.toTier,
      escalatedById: e.escalatedById,
      isAutomated: e.isAutomated,
      reason: e.reason,
      escalatedAt: e.escalatedAt,
    })),
  };

  return staffDTO;
}
