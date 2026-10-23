import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { FileMetadata, StoragePort, UploadPresignedUrlResult } from "@/application/ports/ExternalPorts";
import crypto from "node:crypto";
import path from "node:path";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const MAX_FILE_SIZE_BYTES = 5242880; // 5 MB strictly enforced

/**
 * Supabase Private Storage Adapter.
 * Enforces server-side validation:
 * - 5 MB file size limit
 * - Strict MIME type whitelist (JPEG, PNG, PDF)
 * - Sanitized non-traversing storage keys
 * - Signed time-limited URLs for upload and download
 * - Private bucket access only
 */
export class SupabaseStorageAdapter implements StoragePort {
  private supabase: SupabaseClient;
  private bucket: string;

  constructor(supabaseClient?: SupabaseClient, bucketName?: string) {
    this.bucket = bucketName || process.env.STORAGE_BUCKET_ATTACHMENTS || "campus-plus-attachments";

    if (supabaseClient) {
      this.supabase = supabaseClient;
    } else {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!url || !key) {
        throw new Error("SupabaseStorageAdapter requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
      }

      this.supabase = createClient(url, key);
    }
  }

  public async generateUploadUrl(metadata: FileMetadata): Promise<UploadPresignedUrlResult> {
    // 1. File size validation
    if (metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File size violation: File size (${metadata.sizeBytes} bytes) must be between 1 and ${MAX_FILE_SIZE_BYTES} bytes (5 MB).`
      );
    }

    // 2. MIME type whitelist validation
    if (!ALLOWED_MIME_TYPES.has(metadata.contentType)) {
      throw new Error(
        `MIME type violation: '${metadata.contentType}' is not permitted. Allowed: image/jpeg, image/png, application/pdf.`
      );
    }

    // 3. Sanitized path traversal-resistant file key
    const base = path.posix.basename(metadata.filename.replace(/\\/g, "/"));
    const ext = path.posix.extname(base).toLowerCase();
    const nameOnly = path.posix.basename(base, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    const sanitizedFilename = `${nameOnly || "file"}${ext}`.slice(0, 100);
    const fileUuid = crypto.randomUUID();
    const ownerSegment = metadata.ownerId ? `${metadata.ownerId}/` : "";
    const fileKey = `complaints/temp/${ownerSegment}${fileUuid}-${sanitizedFilename}`;

    // 4. Create signed upload URL from Supabase Storage
    const { data, error } = await this.supabase.storage.from(this.bucket).createSignedUploadUrl(fileKey);

    if (error || !data) {
      throw new Error(`Failed to generate signed upload URL from Supabase Storage: ${error?.message || "Unknown error"}`);
    }

    return {
      uploadUrl: data.signedUrl,
      fileKey,
      expiresInSeconds: 3600,
    };
  }

  public async verifyUploadedFile(file: {
    ownerId: string;
    fileKey: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<boolean> {
    if (!file.fileKey.startsWith(`complaints/temp/${file.ownerId}/`)) return false;

    const { data, error } = await this.supabase.storage.from(this.bucket).info(file.fileKey);
    if (error || !data) return false;

    return data.size === file.sizeBytes && data.contentType === file.contentType;
  }

  public async getDownloadUrl(fileKey: string, expiresInSeconds: number = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage.from(this.bucket).createSignedUrl(fileKey, expiresInSeconds);

    if (error || !data) {
      throw new Error(`Failed to generate signed download URL for key '${fileKey}': ${error?.message || "Unknown error"}`);
    }

    return data.signedUrl;
  }

  public async deleteFile(fileKey: string): Promise<void> {
    const { error } = await this.supabase.storage.from(this.bucket).remove([fileKey]);
    if (error) {
      throw new Error(`Failed to delete file key '${fileKey}' from Supabase Storage: ${error.message}`);
    }
  }
}
