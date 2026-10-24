import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { ResolveComplaintSchema } from "@/presentation/schemas/complaintSchemas";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { requireAuthHeader } from "@/presentation/utils/authGuard";
import { AttachmentSummary } from "@/domain/complaint";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authDenied = requireAuthHeader(request);
  if (authDenied) return authDenied;

  try {
    const { id } = await context.params;
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);

    const body = await request.json();
    const validated = ResolveComplaintSchema.parse(body);

    const attachments: AttachmentSummary[] | undefined = validated.proofAttachmentKeys?.map((key) => ({
      id: key,
      attachmentType: "RESOLUTION_PROOF",
      originalFilename: key.split("/").pop() || key,
      mimeType: "image/jpeg",
    }));

    const result = await container.resolveComplaintUseCase.execute({
      complaintId: id,
      resolvedBy: actor,
      summary: validated.resolutionSummary,
      attachments,
      expectedVersion: validated.expectedVersion,
    });

    if (result.isFailure) {
      return handleApiError(result.error);
    }

    return createSuccessResponse({ message: "Complaint resolved successfully" });
  } catch (error) {
    return handleApiError(error);
  }
}
