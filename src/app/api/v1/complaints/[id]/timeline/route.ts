import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
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

    const result = await container.getTimelineUseCase.execute({
      idOrTrackingCode: id,
      actor,
    });

    if (result.isFailure) {
      return handleApiError(result.error);
    }

    return createSuccessResponse(result.value);
  } catch (error) {
    return handleApiError(error);
  }
}
