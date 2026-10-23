import { Complaint, ComplaintId, TrackingCode } from "@/domain/complaint";

export interface ComplaintAttachmentInput {
  fileKey: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface IComplaintRepository {
  findById(id: ComplaintId): Promise<Complaint | null>;
  findByTrackingCode(code: TrackingCode): Promise<Complaint | null>;
  save(complaint: Complaint, expectedVersion?: number, attachments?: ComplaintAttachmentInput[]): Promise<void>;
}
