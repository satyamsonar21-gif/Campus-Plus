/**
 * Campus Plus — Centralized Typed API Client.
 *
 * Implements all 19 verified route operations across 18 backend route files.
 * Enforces:
 * - Automatic Bearer JWT attachment
 * - Correlation ID propagation (x-correlation-id)
 * - Deterministic error normalization to ApiClientError
 * - Idempotency-Key strictly on POST /api/v1/complaints
 * - expectedVersion payload inclusion on OCC state mutations
 * - Zero secret leakage (client-side safe)
 */

import { UserRoleType } from "@/domain/complaint";
import { StudentComplaintDTO, StaffComplaintDTO } from "@/presentation/dtos/complaintDTOs";
import { PaginationMeta } from "@/presentation/utils/apiResponse";

export type ComplaintDTO = StudentComplaintDTO | StaffComplaintDTO;

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly correlationId?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  public get isConflict(): boolean {
    return this.statusCode === 409;
  }

  public get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  public get isForbidden(): boolean {
    return this.statusCode === 403;
  }

  public get isNotFound(): boolean {
    return this.statusCode === 404;
  }

  public get isValidation(): boolean {
    return this.statusCode === 400;
  }
}

export interface AuthMeResponse {
  userId: string;
  role: UserRoleType;
  departmentId: string | null;
}

export interface SubmitComplaintInput {
  title: string;
  description: string;
  categoryId: string;
  departmentId: string;
  locationDetails: string;
  locationId?: string;
  suggestedPriority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  attachments?: Array<{
    fileKey: string;
    originalFilename: string;
    mimeType: "image/jpeg" | "image/png" | "application/pdf";
    fileSizeBytes: number;
  }>;
}

export interface CategoryReferenceData {
  id: string;
  name: string;
  defaultDepartmentId: string;
  defaultDepartmentName: string;
  requiresResolutionProof: boolean;
}

export interface DepartmentReferenceData {
  id: string;
  name: string;
}

export interface PublicReferenceData {
  categories: CategoryReferenceData[];
  departments: DepartmentReferenceData[];
}

export interface SubmitComplaintResult {
  complaintId: string;
  trackingCode: string;
  status: string;
}

export interface AttachmentDownloadResult {
  downloadUrl: string;
  expiresInSeconds: number;
}

export interface ListComplaintsParams {
  page?: number;
  limit?: number;
  status?: string;
  priority?: string;
  department_id?: string;
}

export interface PresignUploadInput {
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  fileSizeBytes: number;
}

export interface PresignUploadResult {
  uploadUrl: string;
  fileKey: string;
  expiresInSeconds: number;
}

export interface TimelineItem {
  id: string;
  complaintId: string;
  actorRole: string;
  actionType: string;
  fromStatus: string | null;
  toStatus: string | null;
  remarks: string | null;
  createdAt: string;
}

interface EnvelopePayload {
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export type TokenProvider = () => Promise<string | null> | string | null;

export class ApiClient {
  private tokenProvider: TokenProvider | null = null;
  private baseUrl: string = "";

  constructor(options?: { baseUrl?: string; tokenProvider?: TokenProvider }) {
    if (options?.baseUrl) {
      this.baseUrl = options.baseUrl.replace(/\/$/, "");
    }
    if (options?.tokenProvider) {
      this.tokenProvider = options.tokenProvider;
    }
  }

  public setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
      headers?: Record<string, string>;
      idempotencyKey?: string;
    } = {}
  ): Promise<{ data: T; meta?: Record<string, unknown>; correlationId?: string }> {
    const method = options.method ?? "GET";
    const correlationId = crypto.randomUUID();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-correlation-id": correlationId,
      ...(options.headers ?? {}),
    };

    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    if (this.tokenProvider) {
      const token = await this.tokenProvider();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const url = `${this.baseUrl}${endpoint}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (networkError: unknown) {
      const msg = networkError instanceof Error ? networkError.message : "Network error";
      throw new ApiClientError(
        `Network connection failed: ${msg}`,
        0,
        "NETWORK_ERROR",
        correlationId
      );
    }

    const responseCorrelationId =
      response.headers.get("x-correlation-id") || correlationId;

    let json: EnvelopePayload | null = null;
    try {
      json = (await response.json()) as EnvelopePayload;
    } catch {
      // Empty or non-JSON body
    }

    if (!response.ok) {
      const errorCode = json?.error?.code || `HTTP_${response.status}`;
      const errorMessage =
        json?.error?.message || `Request failed with status ${response.status}`;
      const details = json?.error?.details;

      throw new ApiClientError(
        errorMessage,
        response.status,
        errorCode,
        responseCorrelationId,
        details
      );
    }

    return {
      data: (json?.data !== undefined ? json.data : json) as T,
      meta: json?.meta,
      correlationId: responseCorrelationId,
    };
  }

  // ============================================================================
  // 1. SYSTEM & AUTHENTICATION OPERATIONS
  // ============================================================================

  /**
   * GET /api/health — Decoupled system liveness.
   */
  public async getHealth(): Promise<{ status: string; timestamp: string }> {
    const res = await this.request<{ status: string; timestamp: string }>("/api/health");
    return res.data;
  }

  /**
   * GET /api/v1/auth/me — Resolves trusted server-side ActorContext.
   */
  public async getAuthMe(): Promise<AuthMeResponse> {
    const res = await this.request<AuthMeResponse>("/api/v1/auth/me");
    return res.data;
  }

  /** GET /api/v1/reference-data — Active complaint categories and their configured routing. */
  public async getReferenceData(): Promise<PublicReferenceData> {
    const res = await this.request<PublicReferenceData>("/api/v1/reference-data");
    return res.data;
  }

  // ============================================================================
  // 2. COMPLAINT INTAKE & RETRIEVAL OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/complaints — Submits a new formal grievance.
   * REQUIRES Idempotency-Key header per contract.
   */
  public async submitComplaint(
    payload: SubmitComplaintInput,
    idempotencyKey?: string
  ): Promise<SubmitComplaintResult> {
    const key = idempotencyKey || crypto.randomUUID();
    const res = await this.request<SubmitComplaintResult>("/api/v1/complaints", {
      method: "POST",
      body: payload,
      idempotencyKey: key,
    });
    return res.data;
  }

  /**
   * GET /api/v1/complaints — Paginated list of complaints scoped by actor role and filters.
   */
  public async listComplaints(params: ListComplaintsParams = {}): Promise<{
    items: StudentComplaintDTO[] | StaffComplaintDTO[];
    pagination?: PaginationMeta;
  }> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.status) searchParams.set("status", params.status);
    if (params.priority) searchParams.set("priority", params.priority);
    if (params.department_id) searchParams.set("department_id", params.department_id);

    const qs = searchParams.toString();
    const endpoint = `/api/v1/complaints${qs ? `?${qs}` : ""}`;
    const res = await this.request<StudentComplaintDTO[] | StaffComplaintDTO[]>(endpoint);
    return {
      items: res.data,
      pagination: res.meta?.pagination as PaginationMeta | undefined,
    };
  }

  /**
   * GET /api/v1/complaints/[id] — Role-scoped complaint details.
   */
  public async getComplaint(
    idOrTrackingCode: string
  ): Promise<StudentComplaintDTO | StaffComplaintDTO> {
    const res = await this.request<StudentComplaintDTO | StaffComplaintDTO>(
      `/api/v1/complaints/${encodeURIComponent(idOrTrackingCode)}`
    );
    return res.data;
  }

  /** GET /api/v1/complaints/:id/attachments/:attachmentId — Authorized short-lived download URL. */
  public async getComplaintAttachmentDownloadUrl(
    complaintId: string,
    attachmentId: string
  ): Promise<AttachmentDownloadResult> {
    const res = await this.request<AttachmentDownloadResult>(
      `/api/v1/complaints/${complaintId}/attachments/${attachmentId}`
    );
    return res.data;
  }

  /**
   * GET /api/v1/complaints/[id]/timeline — Public or staff timeline history.
   */
  public async getTimeline(idOrTrackingCode: string): Promise<TimelineItem[]> {
    const res = await this.request<TimelineItem[]>(
      `/api/v1/complaints/${encodeURIComponent(idOrTrackingCode)}/timeline`
    );
    return res.data;
  }

  // ============================================================================
  // 3. LIFECYCLE MUTATION OPERATIONS (OCC GOVERNED VIA expectedVersion)
  // ============================================================================

  /**
   * POST /api/v1/complaints/[id]/review — HOD/Supervisor initial triage review.
   */
  public async reviewComplaint(id: string, expectedVersion?: number): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/review`, {
      method: "POST",
      body: { expectedVersion },
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/assign — HOD assigns departmental handler.
   */
  public async assignComplaint(
    id: string,
    payload: { handlerId: string; reason?: string; expectedVersion?: number }
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/assign`, {
      method: "POST",
      body: payload,
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/progress — Assigned handler starts work.
   */
  public async startProgress(id: string, expectedVersion?: number): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/progress`, {
      method: "POST",
      body: { expectedVersion },
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/forward — Routes to different department.
   */
  public async forwardComplaint(
    id: string,
    payload: { targetDepartmentId: string; rationale: string; expectedVersion?: number }
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/forward`, {
      method: "POST",
      body: payload,
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/escalate — Escalates to higher tier.
   */
  public async escalateComplaint(
    id: string,
    payload: {
      targetTier: "TIER_2_DEPARTMENT_HEAD" | "TIER_3_MANAGEMENT";
      reason: string;
      expectedVersion?: number;
    }
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/escalate`, {
      method: "POST",
      body: payload,
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/resolve — Handler records formal resolution.
   */
  public async resolveComplaint(
    id: string,
    payload: {
      resolutionSummary: string;
      proofAttachmentKeys?: string[];
      expectedVersion?: number;
    }
  ): Promise<{ message: string }> {
    const res = await this.request<{ message: string }>(
      `/api/v1/complaints/${id}/resolve`,
      {
        method: "POST",
        body: payload,
      }
    );
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/verify — Complainant verifies resolution.
   */
  public async verifyResolution(id: string, expectedVersion?: number): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/verify`, {
      method: "POST",
      body: { expectedVersion },
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/dispute — Complainant disputes resolution.
   */
  public async disputeResolution(
    id: string,
    payload: { disputeReason: string; expectedVersion?: number }
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/dispute`, {
      method: "POST",
      body: payload,
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/close — Administrative terminal closure.
   */
  public async closeComplaint(
    id: string,
    payload: { reason: string; expectedVersion?: number }
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/close`, {
      method: "POST",
      body: payload,
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/reject — HOD rejection with justification.
   */
  public async rejectComplaint(
    id: string,
    payload: { reason: string; expectedVersion?: number }
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/reject`, {
      method: "POST",
      body: payload,
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/duplicate — Mark redundant complaint.
   */
  public async duplicateComplaint(
    id: string,
    payload: { originalRefId: string; expectedVersion?: number }
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/duplicate`, {
      method: "POST",
      body: payload,
    });
    return res.data;
  }

  /**
   * POST /api/v1/complaints/[id]/cancel — Complainant cancels pre-triage ticket.
   */
  public async cancelComplaint(
    id: string,
    payload: { reason: string; expectedVersion?: number }
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/api/v1/complaints/${id}/cancel`, {
      method: "POST",
      body: payload,
    });
    return res.data;
  }

  // ============================================================================
  // 4. ATTACHMENT STORAGE OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/attachments/presign-upload — Generates signed upload URL.
   */
  public async presignUpload(payload: PresignUploadInput): Promise<PresignUploadResult> {
    const res = await this.request<PresignUploadResult>(
      "/api/v1/attachments/presign-upload",
      {
        method: "POST",
        body: payload,
      }
    );
    return res.data;
  }
}

export const apiClient = new ApiClient();
