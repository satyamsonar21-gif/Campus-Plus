import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { NotFoundError } from "@/shared/errors/AppError";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { handleApiError } from "@/presentation/utils/errorHandler";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const { id, attachmentId } = await context.params;
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);

    const complaintResult = await container.getComplaintUseCase.execute({
      idOrTrackingCode: id,
      actor,
    });
    if (complaintResult.isFailure) return handleApiError(complaintResult.error);

    const attachmentResult = await container.db.query<{ storage_key: string }>(
      `SELECT storage_key
       FROM attachments
       WHERE id = $1 AND complaint_id = $2
       LIMIT 1;`,
      [attachmentId, complaintResult.value.id.toString()]
    );
    const attachment = attachmentResult.rows[0];
    if (!attachment) throw new NotFoundError("Complaint attachment", attachmentId);

    const expiresInSeconds = 60;
    const downloadUrl = await container.storageAdapter.getDownloadUrl(
      attachment.storage_key,
      expiresInSeconds
    );

    return createSuccessResponse({ downloadUrl, expiresInSeconds });
  } catch (error) {
    return handleApiError(error);
  }
}
