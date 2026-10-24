import { NextRequest, NextResponse } from "next/server";
import { ApiErrorEnvelope } from "./errorHandler";
import { ErrorCodes } from "@/shared/errors/ErrorCodes";

/**
 * Fast-fail unauthenticated request guard.
 *
 * Checks for a valid Authorization: Bearer <token> header (or x-actor-id in
 * non-production) BEFORE any database connection is attempted. This prevents
 * the Supabase/PostgreSQL cold-start pool checkout on every unauthenticated
 * request, which previously caused spurious HTTP 500 responses instead of 401.
 *
 * Call this at the very top of each route handler, before getContainer().
 * Returns null if the request appears to be authenticated (proceed normally).
 * Returns a NextResponse<ApiErrorEnvelope> (401) if auth headers are absent.
 */
export function requireAuthHeader(
  request: NextRequest
): NextResponse<ApiErrorEnvelope> | null {
  const isProduction = process.env.NODE_ENV === "production";

  // In non-production, the x-actor-id test fixture header is also accepted
  if (!isProduction && request.headers.get("x-actor-id")) {
    return null;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ") && authHeader.length > 8) {
    return null;
  }

  const correlationId = crypto.randomUUID();
  return NextResponse.json<ApiErrorEnvelope>(
    {
      success: false,
      error: {
        code: ErrorCodes.UNAUTHENTICATED,
        message: "Authentication token is required. Please sign in to Campus Plus.",
        correlation_id: correlationId,
      },
    },
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "x-correlation-id": correlationId,
        "WWW-Authenticate": "Bearer",
      },
    }
  );
}
