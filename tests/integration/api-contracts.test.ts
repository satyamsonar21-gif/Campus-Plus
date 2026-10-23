import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetTestDatabase } from "@/infrastructure/database/pool";
import { resetContainer } from "@/infrastructure/container";
import { POST as submitComplaintHandler, GET as listComplaintsHandler } from "@/app/api/v1/complaints/route";
import { GET as getComplaintHandler } from "@/app/api/v1/complaints/[id]/route";
import { GET as getTimelineHandler } from "@/app/api/v1/complaints/[id]/timeline/route";
import { POST as presignUploadHandler } from "@/app/api/v1/attachments/presign-upload/route";
import { GET as authMeHandler } from "@/app/api/v1/auth/me/route";
import { GET as downloadComplaintAttachmentHandler } from "@/app/api/v1/complaints/[id]/attachments/[attachmentId]/route";
import { getContainer } from "@/infrastructure/container";

const FIXTURES = {
  studentA: "00000000-0000-0000-0000-000000001001",
  deptIt: "00000000-0000-0000-0000-000000000010",
  categoryWifi: "00000000-0000-0000-0000-000000000101",
  existingComplaintId: "00000000-0000-0000-0000-000000002001",
};

describe("Phase 06 API Contracts & Envelope Compliance", () => {
  beforeEach(async () => {
    resetContainer();
    await resetTestDatabase();
  });

  it("POST /api/v1/complaints: rejects unauthenticated requests with 401 and error envelope", async () => {
    const req = new NextRequest("http://localhost/api/v1/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test Complaint With Adequate Title Length",
        description: "Test description that easily exceeds the required thirty characters minimum constraint.",
        departmentId: FIXTURES.deptIt,
        categoryId: FIXTURES.categoryWifi,
        locationDetails: "Room 101",
      }),
    });

    const res = await submitComplaintHandler(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("UNAUTHENTICATED");
    expect(json.error.correlation_id).toBeDefined();
  });

  it("POST /api/v1/complaints: rejects invalid payloads with 400 and validation error details", async () => {
    const req = new NextRequest("http://localhost/api/v1/complaints", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.studentA,
      },
      body: JSON.stringify({
        title: "Short", // < 10 chars
        description: "Too short", // < 30 chars
        departmentId: "not-a-uuid",
        categoryId: FIXTURES.categoryWifi,
        locationDetails: "",
      }),
    });

    const res = await submitComplaintHandler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(json.error.details)).toBe(true);
    expect(json.error.details.length).toBeGreaterThan(0);
  });

  it("POST /api/v1/complaints: successfully creates complaint and returns 201 with standard envelope", async () => {
    const req = new NextRequest("http://localhost/api/v1/complaints", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.studentA,
      },
      body: JSON.stringify({
        title: "Wi-Fi not working in Computer Lab 3",
        description: "Internet connectivity completely down across all terminals in lab 3 during scheduled session.",
        departmentId: FIXTURES.deptIt,
        categoryId: FIXTURES.categoryWifi,
        locationDetails: "Computer Lab 3, 2nd Floor",
        suggestedPriority: "HIGH",
      }),
    });

    const res = await submitComplaintHandler(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.complaintId).toBeDefined();
    expect(json.data.trackingCode).toMatch(/^CP-2026-\d{5}$/);
    expect(json.data.status).toBe("SUBMITTED");
    expect(json.meta.correlation_id).toBeDefined();
    expect(json.meta.timestamp).toBeDefined();
  });

  it("GET /api/v1/complaints: returns 200 with paginated collection envelope", async () => {
    const req = new NextRequest("http://localhost/api/v1/complaints?page=1&limit=10", {
      method: "GET",
      headers: {
        "x-actor-id": FIXTURES.studentA,
      },
    });

    const res = await listComplaintsHandler(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.meta.pagination).toBeDefined();
    expect(json.meta.pagination.page).toBe(1);
    expect(json.meta.pagination.page_size).toBe(10);
    expect(typeof json.meta.pagination.total_records).toBe("number");
  });

  it("GET /api/v1/complaints/[id]: returns 200 with complaint DTO by UUID", async () => {
    const req = new NextRequest(`http://localhost/api/v1/complaints/${FIXTURES.existingComplaintId}`, {
      method: "GET",
      headers: {
        "x-actor-id": FIXTURES.studentA,
      },
    });

    const res = await getComplaintHandler(req, {
      params: Promise.resolve({ id: FIXTURES.existingComplaintId }),
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(FIXTURES.existingComplaintId);
    expect(json.data.trackingCode).toBe("CP-2026-00001");
    expect(json.data.status).toBe("IN_PROGRESS");
  });

  it("GET /api/v1/complaints/[id]: returns 404 for non-existent complaint", async () => {
    const nonExistentId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const req = new NextRequest(`http://localhost/api/v1/complaints/${nonExistentId}`, {
      method: "GET",
      headers: {
        "x-actor-id": FIXTURES.studentA,
      },
    });

    const res = await getComplaintHandler(req, {
      params: Promise.resolve({ id: nonExistentId }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("GET /api/v1/complaints/[id]/attachments/[attachmentId]: returns a short-lived URL only after complaint access is authorized", async () => {
    const container = await getContainer();
    const upload = await container.storageAdapter.generateUploadUrl({
      filename: "supporting-image.png",
      contentType: "image/png",
      sizeBytes: 2048,
      ownerId: FIXTURES.studentA,
    });
    const attachmentInsert = await container.db.query<{ id: string }>(
      `INSERT INTO attachments (
         complaint_id, storage_key, original_filename, mime_type, file_size_bytes, uploaded_by_id
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text AS id;`,
      [FIXTURES.existingComplaintId, upload.fileKey, "supporting-image.png", "image/png", 2048, FIXTURES.studentA]
    );
    const attachmentId = attachmentInsert.rows[0].id;
    const request = new NextRequest(
      `http://localhost/api/v1/complaints/${FIXTURES.existingComplaintId}/attachments/${attachmentId}`,
      { headers: { "x-actor-id": FIXTURES.studentA } }
    );

    const response = await downloadComplaintAttachmentHandler(request, {
      params: Promise.resolve({ id: FIXTURES.existingComplaintId, attachmentId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.downloadUrl).toContain(upload.fileKey);
    expect(body.data.expiresInSeconds).toBe(60);
  });

  it("GET /api/v1/complaints/[id]/timeline: returns 200 with timeline event array", async () => {
    const req = new NextRequest(`http://localhost/api/v1/complaints/${FIXTURES.existingComplaintId}/timeline`, {
      method: "GET",
      headers: {
        "x-actor-id": FIXTURES.studentA,
      },
    });

    const res = await getTimelineHandler(req, {
      params: Promise.resolve({ id: FIXTURES.existingComplaintId }),
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0].action_type).toBeDefined();
  });

  it("POST /api/v1/attachments/presign-upload: returns 200 with presigned URL details", async () => {
    const req = new NextRequest("http://localhost/api/v1/attachments/presign-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.studentA,
      },
      body: JSON.stringify({
        filename: "screenshot.png",
        mimeType: "image/png",
        fileSizeBytes: 102400,
      }),
    });

    const res = await presignUploadHandler(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.uploadUrl).toBeDefined();
    expect(json.data.fileKey).toBeDefined();
    expect(json.data.expiresInSeconds).toBe(3600);
  });

  it("POST /api/v1/attachments/presign-upload: rejects disallowed file extensions with 400", async () => {
    const req = new NextRequest("http://localhost/api/v1/attachments/presign-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.studentA,
      },
      body: JSON.stringify({
        filename: "script.exe",
        mimeType: "application/x-msdownload",
        fileSizeBytes: 102400,
      }),
    });

    const res = await presignUploadHandler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });

  it("GET /api/v1/auth/me: returns 200 with active authenticated actor context", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/me", {
      method: "GET",
      headers: {
        "x-actor-id": FIXTURES.studentA,
      },
    });

    const res = await authMeHandler(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.userId).toBe(FIXTURES.studentA);
    expect(json.data.role).toBe("ROLE_STUDENT");
  });
});
