import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { toComplaintDTO } from "@/presentation/dtos/complaintDTOs";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { requireAuthHeader } from "@/presentation/utils/authGuard";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authDenied = requireAuthHeader(request);
  if (authDenied) return authDenied;

  try {
    const { id } = await context.params;
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);

    const result = await container.getComplaintUseCase.execute({
      idOrTrackingCode: id,
      actor,
    });

    if (result.isFailure) {
      return handleApiError(result.error);
    }

    const dto = toComplaintDTO(result.value, actor);
    const attachmentResult = await container.db.query<{
      id: string;
      original_filename: string;
      mime_type: string;
      file_size_bytes: number;
      created_at: string;
    }>(
      `SELECT id::text AS id, original_filename, mime_type, file_size_bytes, created_at
       FROM attachments WHERE complaint_id = $1 ORDER BY created_at ASC;`,
      [result.value.id.toString()]
    );
    return createSuccessResponse({
      ...dto,
      attachments: attachmentResult.rows.map((attachment) => ({
        id: attachment.id,
        originalFilename: attachment.original_filename,
        mimeType: attachment.mime_type,
        fileSizeBytes: attachment.file_size_bytes,
        createdAt: attachment.created_at,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}