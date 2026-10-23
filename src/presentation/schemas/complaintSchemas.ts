import { z } from "zod";
import { ComplaintPriority, ComplaintStatus, EscalationTier } from "@/domain/complaint";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidField = z.string().regex(UUID_REGEX, "Must be a valid UUID format");

export const SubmitComplaintSchema = z
  .object({
    title: z.string().trim().min(10, "Title must be at least 10 characters").max(120, "Title must not exceed 120 characters"),
    description: z.string().trim().min(30, "Description must be at least 30 characters"),
    categoryId: uuidField,
    departmentId: uuidField,
    locationDetails: z.string().trim().min(1, "Location details are required").max(255),
    locationId: uuidField.optional(),
    suggestedPriority: z.nativeEnum(ComplaintPriority).optional(),
    attachments: z.array(z.object({
      fileKey: z.string().trim().min(1).max(500),
      originalFilename: z.string().trim().min(1).max(255),
      mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
      fileSizeBytes: z.number().int().positive().max(5242880),
    }).strict()).max(3).optional(),
  })
  .strict();

export const ReviewComplaintSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const AssignComplaintSchema = z
  .object({
    handlerId: uuidField,
    reason: z.string().trim().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const StartProgressSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const ForwardComplaintSchema = z
  .object({
    targetDepartmentId: uuidField,
    rationale: z.string().trim().min(10, "Forwarding rationale must be at least 10 characters"),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const EscalateComplaintSchema = z
  .object({
    targetTier: z.enum([EscalationTier.TIER_2_DEPARTMENT_HEAD, EscalationTier.TIER_3_MANAGEMENT]),
    reason: z.string().trim().min(1, "Escalation justification is mandatory"),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const ResolveComplaintSchema = z
  .object({
    resolutionSummary: z.string().trim().min(20, "Resolution summary must be at least 20 characters"),
    proofAttachmentKeys: z.array(z.string()).optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const VerifyResolutionSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const DisputeReopenSchema = z
  .object({
    disputeReason: z.string().trim().min(10, "Dispute explanation must be at least 10 characters"),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const CloseComplaintSchema = z
  .object({
    reason: z.string().trim().min(1, "Closure rationale is mandatory"),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const RejectComplaintSchema = z
  .object({
    reason: z.string().trim().min(1, "Rejection justification is mandatory"),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const MarkDuplicateSchema = z
  .object({
    originalRefId: z.string().trim().min(1, "Original reference tracking code is mandatory"),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const CancelComplaintSchema = z
  .object({
    reason: z.string().trim().min(1, "Cancellation reason is mandatory"),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const PresignUploadSchema = z
  .object({
    filename: z.string().trim().min(1, "Filename is mandatory"),
    mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"], {
      message: "MIME type must be image/jpeg, image/png, or application/pdf",
    }),
    fileSizeBytes: z
      .number()
      .int()
      .positive("File size must be positive")
      .max(5242880, "Maximum file size is 5 MB (5,242,880 bytes)"),
  })
  .strict();

export const ListComplaintsQuerySchema = z.object({
  status: z.nativeEnum(ComplaintStatus).optional(),
  priority: z.nativeEnum(ComplaintPriority).optional(),
  departmentId: uuidField.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
