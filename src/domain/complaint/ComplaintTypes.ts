/**
 * Complaint Domain Taxonomy & Classification Types
 * Reconciled with Phase 04 PostgreSQL Enumerations and Phase 01 Domain Taxonomy.
 */

export const ComplaintCategory = {
  NETWORK_WIFI: "NETWORK_WIFI",
  HOSTEL_MAINTENANCE: "HOSTEL_MAINTENANCE",
  CLASSROOM_INFRASTRUCTURE: "CLASSROOM_INFRASTRUCTURE",
  ACADEMIC_EVALUATION: "ACADEMIC_EVALUATION",
  CAMPUS_SANITATION: "CAMPUS_SANITATION",
  OTHER: "OTHER",
} as const;

export type ComplaintCategoryType = (typeof ComplaintCategory)[keyof typeof ComplaintCategory];

export const ComplaintPriority = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;

export type ComplaintPriorityType = (typeof ComplaintPriority)[keyof typeof ComplaintPriority];

export const EscalationTier = {
  TIER_1_HANDLER: "TIER_1_HANDLER",
  TIER_2_DEPARTMENT_HEAD: "TIER_2_DEPARTMENT_HEAD",
  TIER_3_MANAGEMENT: "TIER_3_MANAGEMENT",
} as const;

export type EscalationTierType = (typeof EscalationTier)[keyof typeof EscalationTier];

export const AttachmentType = {
  INITIAL_EVIDENCE: "INITIAL_EVIDENCE",
  RESOLUTION_PROOF: "RESOLUTION_PROOF",
} as const;

export type AttachmentTypeType = (typeof AttachmentType)[keyof typeof AttachmentType];

export const UserRole = {
  ROLE_STUDENT: "ROLE_STUDENT",
  ROLE_FACULTY: "ROLE_FACULTY",
  ROLE_HANDLER: "ROLE_HANDLER",
  ROLE_DEPT_HEAD: "ROLE_DEPT_HEAD",
  ROLE_MANAGEMENT: "ROLE_MANAGEMENT",
  ROLE_ADMIN: "ROLE_ADMIN",
} as const;

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];
