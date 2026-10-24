import { NextRequest } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { EscalateComplaintSchema } from "@/presentation/schemas/complaintSchemas";
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

    const body = await request.json();
    const validated = EscalateComplaintSchema.parse(body);

    const result = await container.escalateComplaintUseCase.execute({
      complaintId: id,
      toTier: validated.targetTier,
      reason: validated.reason,
      actor,
      expectedVersion: validated.expectedVersion,
    });

    if (result.isFailure) {
      return handleApiError(result.error);
    }

    return createSuccessResponse({ message: "Complaint escalated successfully" });
  } catch (error) {
    return handleApiError(error);
  }
}
