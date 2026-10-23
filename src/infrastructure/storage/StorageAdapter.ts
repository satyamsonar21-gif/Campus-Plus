import { FileMetadata, StoragePort, UploadPresignedUrlResult } from "@/application/ports/ExternalPorts";
import { generateCorrelationId } from "@/shared/utils/id";

/**
 * Mock / In-Memory Storage Adapter for testing and local execution without cloud dependencies.
 */
export class InMemoryStorageAdapter implements StoragePort {
  private files: Map<string, { metadata: FileMetadata; data?: Buffer }> = new Map();

  async generateUploadUrl(metadata: FileMetadata): Promise<UploadPresignedUrlResult> {
    const ownerSegment = metadata.ownerId ? `${metadata.ownerId}/` : "";
    const fileKey = `complaints/temp/${ownerSegment}${Date.now()}-${generateCorrelationId().slice(0, 8)}-${metadata.filename}`;
    this.files.set(fileKey, { metadata });
    return {
      uploadUrl: `https://storage.local.campusplus/upload/${fileKey}`,
      fileKey,
      expiresInSeconds: 3600,
    };
  }

  async verifyUploadedFile(file: { ownerId: string; fileKey: string; contentType: string; sizeBytes: number }): Promise<boolean> {
    const stored = this.files.get(file.fileKey);
    return Boolean(
      stored &&
      stored.data &&
      stored.metadata.ownerId === file.ownerId &&
      stored.metadata.contentType === file.contentType &&
      stored.metadata.sizeBytes === file.sizeBytes
    );
  }

  async getDownloadUrl(fileKey: string): Promise<string> {
    if (!this.files.has(fileKey)) {
      throw new Error(`File key '${fileKey}' not found in storage.`);
    }
    return `https://storage.local.campusplus/download/${fileKey}`;
  }

  async deleteFile(fileKey: string): Promise<void> {
    this.files.delete(fileKey);
  }
}

/** Fails closed for production deployments missing the private Storage credential. */
export class UnavailableStorageAdapter implements StoragePort {
  async generateUploadUrl(): Promise<UploadPresignedUrlResult> {
    throw new Error("Private evidence storage is not configured. Set the server-only Supabase service role key.");
  }

  async verifyUploadedFile(): Promise<boolean> {
    return false;
  }

  async getDownloadUrl(): Promise<string> {
    throw new Error("Private evidence storage is not configured.");
  }

  async deleteFile(): Promise<void> {
    throw new Error("Private evidence storage is not configured.");
  }
}
