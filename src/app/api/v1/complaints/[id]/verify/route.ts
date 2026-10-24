import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { VerifyResolutionSchema } from "@/presentation/schemas/complaintSchemas";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { requireAuthHeader } from "@/presentation/utils/authGuard";

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

    const body = await request.json().catch(() => ({}));
    const validated = VerifyResolutionSchema.parse(body);

    const result = await container.closeComplaintUseCase.execute({
      complaintId: id,
      actor,
      reason: "Verified and closed by complainant",
      isComplainantVerification: true,
      expectedVersion: validated.expectedVersion,
    });

    if (result.isFailure) {
      return handleApiError(result.error);
    }

    return createSuccessResponse({ message: "Resolution verified and complaint closed successfully" });
  } catch (error) {
    return handleApiError(error);
  }
}
