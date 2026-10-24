import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { PresignUploadSchema } from "@/presentation/schemas/complaintSchemas";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { AuthorizationError } from "@/shared/errors/AppError";
import { UserRole } from "@/domain/complaint";
import { requireAuthHeader } from "@/presentation/utils/authGuard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authDenied = requireAuthHeader(request);
  if (authDenied) return authDenied;

  try {
    const container = await getContainer();
    const actor = await container.authAdapter.authenticate(request);
    if (actor.role !== UserRole.ROLE_STUDENT) {
      throw new AuthorizationError("Only student accounts may upload initial complaint evidence.");
    }

    const body = await request.json();
    const validated = PresignUploadSchema.parse(body);

    const result = await container.storageAdapter.generateUploadUrl({
      filename: validated.filename,
      contentType: validated.mimeType,
      sizeBytes: validated.fileSizeBytes,
      ownerId: actor.userId,
    });

    return createSuccessResponse(result, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}