import { createHash } from "node:crypto";
import { UseCase } from "../common/UseCase";
import { IComplaintRepository } from "../ports/IComplaintRepository";
import { ITrackingCodeGeneratorPort } from "../ports/ITrackingCodeGeneratorPort";
import { IIdempotencyPort } from "../ports/IIdempotencyPort";
import { Complaint } from "@/domain/complaint";
import { Result, ok, err } from "@/domain/common/Result";
import { AppError } from "@/shared/errors/AppError";
import { IdempotencyConflictError } from "@/domain/complaint/DomainErrors";
import { CategoryId, ComplaintPriority, Priority } from "@/domain/complaint";
import { ISLAPolicyPort } from "../ports/ISLAPolicyPort";

export interface SubmitComplaintCommand {
  complainantId: string;
  departmentId: string;
  categoryId: string;
  title: string;
  description: string;
  locationDetails: string;
  locationId?: string;
  suggestedPriority?: string;
  attachments?: Array<{
    fileKey: string;
    originalFilename: string;
    mimeType: string;
    fileSizeBytes: number;
  }>;
  idempotencyKey?: string;
}

export interface SubmitComplaintResult {
  complaintId: string;
  trackingCode: string;
  status: string;
}

export class SubmitComplaintUseCase implements UseCase<SubmitComplaintCommand, Result<SubmitComplaintResult, AppError>> {
  constructor(
    private readonly complaintRepo: IComplaintRepository,
    private readonly codeGenerator: ITrackingCodeGeneratorPort,
    private readonly idempotencyPort?: IIdempotencyPort,
    private readonly slaPolicy?: ISLAPolicyPort
  ) {}

  public async execute(command: SubmitComplaintCommand): Promise<Result<SubmitComplaintResult, AppError>> {
    const attachments = command.attachments ?? [];
    const fileKeys = new Set(attachments.map((attachment) => attachment.fileKey));
    if (attachments.length > 3 || fileKeys.size !== attachments.length) {
      return err(new AppError({
        message: "Complaint evidence must contain no more than three unique files.",
        code: "VALIDATION_FAILED",
        statusCode: 400,
      }));
    }
    if (attachments.some((attachment) => !attachment.fileKey.startsWith(`complaints/temp/${command.complainantId}/`))) {
      return err(new AppError({
        message: "One or more uploaded files do not belong to the authenticated student.",
        code: "FORBIDDEN",
        statusCode: 403,
      }));
    }

    // 1. Idempotency Check
    if (command.idempotencyKey && this.idempotencyPort) {
      const rawPayload = JSON.stringify({
        title: command.title,
        complainantId: command.complainantId,
        departmentId: command.departmentId,
        categoryId: command.categoryId,
        description: command.description,
        locationDetails: command.locationDetails,
        attachments: command.attachments ?? [],
      });
      const requestHash = createHash("sha256").update(rawPayload).digest("hex");
      const acquired = await this.idempotencyPort.acquireKey(command.idempotencyKey, requestHash);
      if (!acquired) {
        const existing = await this.idempotencyPort.getExistingResponse(command.idempotencyKey);
        if (existing) {
          return ok(existing.responseBody as SubmitComplaintResult);
        }
        return err(new IdempotencyConflictError(command.idempotencyKey));
      }
    }

    // 2. Concurrency-Safe Tracking Code Generation
    const trackingCode = await this.codeGenerator.generate();

    const createdAt = new Date();
    const slaDueAt = this.slaPolicy
      ? await this.slaPolicy.calculateResolutionDeadline(
          new CategoryId(command.categoryId),
          new Priority(ComplaintPriority.MEDIUM),
          createdAt
        )
      : null;

    // 3. Domain Aggregate Creation
    const complaintResult = Complaint.create({
      refId: trackingCode.toString(),
      title: command.title,
      description: command.description,
      complainantId: command.complainantId,
      departmentId: command.departmentId,
      categoryId: command.categoryId,
      locationDetails: command.locationDetails,
      locationId: command.locationId,
      suggestedPriority: command.suggestedPriority,
      officialPriority: ComplaintPriority.MEDIUM,
      slaDueAt: slaDueAt?.toISOString(),
      createdAt: createdAt.toISOString(),
    });

    if (complaintResult.isFailure) {
      return err(complaintResult.error as AppError);
    }

    const complaint = complaintResult.value;

    // 4. Persistence
    await this.complaintRepo.save(complaint, undefined, attachments);

    const result: SubmitComplaintResult = {
      complaintId: complaint.id.toString(),
      trackingCode: complaint.refId.toString(),
      status: complaint.status,
    };

    // 5. Complete Idempotency Token
    if (command.idempotencyKey && this.idempotencyPort) {
      await this.idempotencyPort.completeKey(command.idempotencyKey, 201, result);
    }

    return ok(result);
  }
}
