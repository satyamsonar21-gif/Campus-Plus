"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { ProtectedRoute } from "@/presentation/components/auth/ProtectedRoute";
import { useAuth } from "@/presentation/context/AuthContext";
import { validateRouteId } from "@/presentation/utils/security";
import { apiClient, ComplaintDTO, TimelineItem } from "@/presentation/services/apiClient";
import { Card } from "@/presentation/components/primitives/Card";
import { Button } from "@/presentation/components/primitives/Button";
import { Skeleton } from "@/presentation/components/primitives/Skeleton";
import { Modal } from "@/presentation/components/overlays/Modal";
import { ConflictModal } from "@/presentation/components/overlays/ConflictModal";
import { TrackingCodeBadge } from "@/presentation/components/domain/TrackingCodeBadge";
import { StatusPill } from "@/presentation/components/domain/StatusPill";
import { PriorityBadge } from "@/presentation/components/domain/PriorityBadge";
import { TimelineFeed, TimelineEventItem } from "@/presentation/components/domain/TimelineFeed";
import { AlertBanner } from "@/presentation/components/feedback/AlertBanner";
import { TextInput } from "@/presentation/components/forms/TextInput";
import { TextArea } from "@/presentation/components/forms/TextArea";
import {
  formatDepartmentName,
  formatDateTime,
  formatCategoryLabel,
} from "@/presentation/utils/formatters";

interface ComplaintDetailPageProps {
  params: Promise<{ id: string }>;
}

function ComplaintDetailView({ id }: { id: string }) {
  const { role } = useAuth();
  const [complaint, setComplaint] = useState<ComplaintDTO | null>(null);
  const [timeline, setTimeline] = useState<TimelineEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mutation & OCC State
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [modalInput, setModalInput] = useState("");
  const [secondaryInput, setSecondaryInput] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isConflictOpen, setIsConflictOpen] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const validation = validateRouteId(id);

  useEffect(() => {
    if (!validation.isValid) return;
    let isCancelled = false;

    Promise.all([
      apiClient.getComplaint(id),
      apiClient.getTimeline(id).catch(() => [] as TimelineItem[]),
    ])
      .then(([complaintData, timelineData]) => {
        if (isCancelled) return;
        setComplaint(complaintData);
        const mapped: TimelineEventItem[] = timelineData.map((t) => ({
          id: t.id,
          action: t.actionType,
          previousStatus: t.fromStatus,
          newStatus: t.toStatus,
          actorRole: t.actorRole,
          createdAt: t.createdAt,
          remarks: t.remarks,
        }));
        setTimeline(mapped);
        setErrorMessage(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (isCancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "Failed to load complaint details.");
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [id, validation.isValid]);

  const refreshData = async () => {
    setIsLoading(true);
    try {
      const [complaintData, timelineData] = await Promise.all([
        apiClient.getComplaint(id),
        apiClient.getTimeline(id).catch(() => [] as TimelineItem[]),
      ]);
      setComplaint(complaintData);
      const mapped: TimelineEventItem[] = timelineData.map((t) => ({
        id: t.id,
        action: t.actionType,
        previousStatus: t.fromStatus,
        newStatus: t.toStatus,
        actorRole: t.actorRole,
        createdAt: t.createdAt,
        remarks: t.remarks,
      }));
      setTimeline(mapped);
      setErrorMessage(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load complaint details.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadAttachment = async (attachmentId: string) => {
    if (!complaint) return;
    setAttachmentError(null);
    try {
      const { downloadUrl } = await apiClient.getComplaintAttachmentDownloadUrl(complaint.id, attachmentId);
      window.location.assign(downloadUrl);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not open this attachment.");
    }
  };

  if (!validation.isValid) {
    return (
      <div className="space-y-4">
        <AlertBanner variant="error" title="Invalid Identifier">
          The requested reference &quot;{id}&quot; does not match the required UUID or CP-YYYY-XXXXX format.
        </AlertBanner>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">&larr; Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const isComplainant = role === "ROLE_STUDENT" || role === "ROLE_FACULTY";
  const isHandler = role === "ROLE_HANDLER";
  const isDeptHead = role === "ROLE_DEPT_HEAD";
  const isManagement = role === "ROLE_MANAGEMENT";

  // Handle Lifecycle Mutations with OCC Versioning
  const handleExecuteMutation = async (action: string) => {
    if (!complaint) return;
    setIsMutating(true);
    setMutationError(null);

    const version = complaint.version;

    try {
      switch (action) {
        case "REVIEW":
          await apiClient.reviewComplaint(complaint.id, version);
          break;
        case "ASSIGN":
          if (!modalInput.trim()) throw new Error("Handler ID is required.");
          await apiClient.assignComplaint(complaint.id, {
            handlerId: modalInput.trim(),
            reason: secondaryInput.trim() || undefined,
            expectedVersion: version,
          });
          break;
        case "PROGRESS":
          await apiClient.startProgress(complaint.id, version);
          break;
        case "FORWARD":
          if (!modalInput.trim()) throw new Error("Target Department ID is required.");
          if (secondaryInput.trim().length < 10) throw new Error("Forwarding rationale must be at least 10 characters.");
          await apiClient.forwardComplaint(complaint.id, {
            targetDepartmentId: modalInput.trim(),
            rationale: secondaryInput.trim(),
            expectedVersion: version,
          });
          break;
        case "ESCALATE":
          if (!secondaryInput.trim()) throw new Error("Escalation reason is required.");
          await apiClient.escalateComplaint(complaint.id, {
            targetTier: modalInput === "TIER_3" ? "TIER_3_MANAGEMENT" : "TIER_2_DEPARTMENT_HEAD",
            reason: secondaryInput.trim(),
            expectedVersion: version,
          });
          break;
        case "RESOLVE":
          if (secondaryInput.trim().length < 20) throw new Error("Resolution summary must be at least 20 characters.");
          await apiClient.resolveComplaint(complaint.id, {
            resolutionSummary: secondaryInput.trim(),
            expectedVersion: version,
          });
          break;
        case "VERIFY":
          await apiClient.verifyResolution(complaint.id, version);
          break;
        case "DISPUTE":
          if (!secondaryInput.trim()) throw new Error("Dispute reason is mandatory.");
          await apiClient.disputeResolution(complaint.id, {
            disputeReason: secondaryInput.trim(),
            expectedVersion: version,
          });
          break;
        case "REJECT":
          if (!secondaryInput.trim()) throw new Error("Rejection reason is mandatory.");
          await apiClient.rejectComplaint(complaint.id, {
            reason: secondaryInput.trim(),
            expectedVersion: version,
          });
          break;
        case "DUPLICATE":
          if (!modalInput.trim()) throw new Error("Master reference complaint ID is required.");
          await apiClient.duplicateComplaint(complaint.id, {
            originalRefId: modalInput.trim(),
            expectedVersion: version,
          });
          break;
        case "CANCEL":
          await apiClient.cancelComplaint(complaint.id, {
            reason: secondaryInput.trim() || "Withdrawn by complainant",
            expectedVersion: version,
          });
          break;
      }

      setActiveModal(null);
      setModalInput("");
      setSecondaryInput("");
      await refreshData();
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 409) {
        setActiveModal(null);
        setIsConflictOpen(true);
      } else {
        setMutationError(err instanceof Error ? err.message : "Failed to execute lifecycle transition.");
      }
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link href="/complaints">
          <Button variant="ghost" size="sm" className="text-xs">
            &larr; Back to Grievances Directory
          </Button>
        </Link>
        <span className="text-xs text-slate-400">Ledger Record: {id}</span>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton variant="rectangular" height="120px" />
          <Skeleton variant="rectangular" height="300px" />
        </div>
      )}

      {!isLoading && errorMessage && (
        <AlertBanner variant="error" title="Grievance Access Error">
          {errorMessage}
        </AlertBanner>
      )}

      {!isLoading && !errorMessage && complaint && (
        <>
          {/* Header Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center space-x-3">
                <TrackingCodeBadge trackingCode={complaint.trackingCode} size="md" />
                <StatusPill status={complaint.status} size="md" />
                <PriorityBadge priority={complaint.suggestedPriority} size="md" />
              </div>
              <span className="text-xs text-slate-500">Version: v{complaint.version}</span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{complaint.title}</h1>

            {/* Contextual Action Bar */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              {/* Complainant Actions */}
              {isComplainant && complaint.status === "RESOLVED" && (
                <>
                  <Button variant="primary" size="sm" onClick={() => { setActiveModal("VERIFY"); setMutationError(null); }}>
                    Confirm Resolution
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => { setActiveModal("DISPUTE"); setMutationError(null); }}>
                    Dispute &amp; Reopen
                  </Button>
                </>
              )}
              {isComplainant && complaint.status === "SUBMITTED" && (
                <Button variant="outline" size="sm" onClick={() => { setActiveModal("CANCEL"); setMutationError(null); }}>
                  Cancel Grievance
                </Button>
              )}

              {/* Handler Actions */}
              {isHandler && complaint.status === "ASSIGNED" && (
                <Button variant="primary" size="sm" onClick={() => handleExecuteMutation("PROGRESS")}>
                  Start Progress
                </Button>
              )}
              {isHandler && complaint.status === "IN_PROGRESS" && (
                <>
                  <Button variant="primary" size="sm" onClick={() => { setActiveModal("RESOLVE"); setMutationError(null); }}>
                    Resolve Grievance
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setActiveModal("FORWARD"); setMutationError(null); }}>
                    Forward to Department
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setActiveModal("ESCALATE"); setMutationError(null); }}>
                    Escalate Issue
                  </Button>
                </>
              )}

              {/* HOD Actions */}
              {isDeptHead && complaint.status === "SUBMITTED" && (
                <>
                  <Button variant="primary" size="sm" onClick={() => handleExecuteMutation("REVIEW")}>
                    Mark Reviewed
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setActiveModal("ASSIGN"); setMutationError(null); }}>
                    Assign Handler
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => { setActiveModal("REJECT"); setMutationError(null); }}>
                    Reject Grievance
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setActiveModal("DUPLICATE"); setMutationError(null); }}>
                    Mark Duplicate
                  </Button>
                </>
              )}
              {isDeptHead && complaint.status === "REVIEWED" && (
                <>
                  <Button variant="primary" size="sm" onClick={() => { setActiveModal("ASSIGN"); setMutationError(null); }}>
                    Assign Handler
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => { setActiveModal("REJECT"); setMutationError(null); }}>
                    Reject Grievance
                  </Button>
                </>
              )}
              {isDeptHead && complaint.status === "ESCALATED" && (
                <>
                  <Button variant="primary" size="sm" onClick={() => { setActiveModal("ASSIGN"); setMutationError(null); }}>
                    Reassign Handler
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setActiveModal("FORWARD"); setMutationError(null); }}>
                    Forward
                  </Button>
                </>
              )}

              {/* Management Actions */}
              {isManagement && complaint.status === "ESCALATED" && (
                <Button variant="primary" size="sm" onClick={() => { setActiveModal("RESOLVE"); setMutationError(null); }}>
                  Executive Resolution
                </Button>
              )}
            </div>
          </div>

          {/* Two-Column Details & Timeline Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Complaint Data */}
            <div className="lg:col-span-7 space-y-6">
              <Card title="Grievance Description" description="Authoritative submission text.">
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{complaint.description}</p>
                <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="font-semibold text-slate-500 uppercase">Category</span>
                    <p className="text-slate-800 font-medium mt-0.5">{formatCategoryLabel(complaint.categoryId)}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 uppercase">Department Jurisdiction</span>
                    <p className="text-slate-800 font-medium mt-0.5">{formatDepartmentName(complaint.departmentId)}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 uppercase">Location</span>
                    <p className="text-slate-800 font-medium mt-0.5">{complaint.locationDetails}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 uppercase">Submitted At</span>
                    <p className="text-slate-800 font-medium mt-0.5">{formatDateTime(complaint.createdAt)}</p>
                  </div>
                </div>
              </Card>

              {(complaint.attachments?.length ?? 0) > 0 && (
                <Card title="Evidence & Attachments" description="Files are available only to users authorized to view this complaint.">
                  {attachmentError && <AlertBanner variant="error" title="Attachment unavailable">{attachmentError}</AlertBanner>}
                  <ul className="space-y-2">
                    {complaint.attachments?.map((attachment) => (
                      <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">{attachment.originalFilename}</p>
                          <p className="text-xs text-slate-500">{attachment.mimeType} · {(attachment.fileSizeBytes / 1024).toFixed(0)} KB</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => void handleDownloadAttachment(attachment.id)}>
                          Download
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* Formal Resolution Outcome if Resolved */}
              {complaint.resolution && (
                <Card title="Resolution Summary" description="Formal outcome recorded by assigned handler.">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-2">
                    <p className="text-sm text-emerald-950">{complaint.resolution.summary}</p>
                    <div className="text-xs text-emerald-800 pt-1 border-t border-emerald-200/60">
                      Resolved on {formatDateTime(complaint.resolution.resolvedAt)}
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Right Column: Lifecycle Timeline */}
            <div className="lg:col-span-5 space-y-6">
              <Card title="Lifecycle Timeline" description={isComplainant ? "Public milestone events." : "Audited workflow progression."}>
                <TimelineFeed events={timeline} />
              </Card>
            </div>
          </div>
        </>
      )}

      {/* Mutation Modals */}
      <Modal
        isOpen={!!activeModal}
        onClose={() => setActiveModal(null)}
        title={`Execute ${activeModal} Transition`}
        size="md"
      >
        <div className="space-y-4">
          {mutationError && (
            <AlertBanner variant="error" title="Action Error">
              {mutationError}
            </AlertBanner>
          )}

          {activeModal === "ASSIGN" && (
            <div className="space-y-3">
              <TextInput
                id="assign-handler-id"
                label="Assignee Handler UUID"
                required
                placeholder="Institutional Staff Account UUID"
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
              />
              <TextArea
                id="assign-instructions"
                label="Instructions / Reason (Optional)"
                rows={2}
                value={secondaryInput}
                onChange={(e) => setSecondaryInput(e.target.value)}
              />
            </div>
          )}

          {activeModal === "FORWARD" && (
            <div className="space-y-3">
              <TextInput
                id="forward-dept-id"
                label="Target Department UUID"
                required
                placeholder="Target Department UUID"
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
              />
              <TextArea
                id="forward-rationale"
                label="Forwarding Rationale (minimum 10 chars)"
                required
                rows={3}
                value={secondaryInput}
                onChange={(e) => setSecondaryInput(e.target.value)}
                helperText={`${secondaryInput.trim().length} / 10 characters minimum`}
              />
            </div>
          )}

          {activeModal === "ESCALATE" && (
            <div className="space-y-3">
              <select
                aria-label="Escalation Tier"
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
                className="w-full rounded-md border border-slate-300 p-2 text-xs"
              >
                <option value="TIER_2">Tier 2 — Department Head</option>
                <option value="TIER_3">Tier 3 — Campus Management</option>
              </select>
              <TextArea
                id="escalate-reason"
                label="Escalation Reason"
                required
                rows={3}
                placeholder="Explain why this grievance requires elevated institutional authority..."
                value={secondaryInput}
                onChange={(e) => setSecondaryInput(e.target.value)}
              />
            </div>
          )}

          {activeModal === "RESOLVE" && (
            <div className="space-y-3">
              <TextArea
                id="resolve-summary"
                label="Resolution Summary (minimum 20 characters)"
                required
                rows={4}
                placeholder="Detail the concrete technical or administrative actions taken to resolve the issue..."
                value={secondaryInput}
                onChange={(e) => setSecondaryInput(e.target.value)}
                helperText={`${secondaryInput.trim().length} / 20 characters minimum`}
              />
            </div>
          )}

          {activeModal === "DISPUTE" && (
            <div className="space-y-3">
              <TextArea
                id="dispute-reason"
                label="Dispute Rationale"
                required
                rows={3}
                placeholder="Explain why the reported resolution does not resolve your grievance..."
                value={secondaryInput}
                onChange={(e) => setSecondaryInput(e.target.value)}
              />
            </div>
          )}

          {activeModal === "REJECT" && (
            <div className="space-y-3">
              <TextArea
                id="reject-reason"
                label="Rejection Justification"
                required
                rows={3}
                placeholder="State the institutional justification for rejecting this grievance..."
                value={secondaryInput}
                onChange={(e) => setSecondaryInput(e.target.value)}
              />
            </div>
          )}

          {activeModal === "DUPLICATE" && (
            <div className="space-y-3">
              <TextInput
                id="duplicate-master-id"
                label="Master Complaint Reference / UUID"
                required
                placeholder="UUID of existing primary complaint"
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
              />
            </div>
          )}

          {activeModal === "VERIFY" && (
            <p className="text-xs text-slate-600">
              Are you sure you want to verify and confirm this resolution? This will mark the grievance as successfully verified.
            </p>
          )}

          {activeModal === "CANCEL" && (
            <p className="text-xs text-slate-600">
              Are you sure you want to cancel and withdraw this grievance?
            </p>
          )}

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="outline" size="sm" onClick={() => setActiveModal(null)} disabled={isMutating}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={isMutating}
              onClick={() => handleExecuteMutation(activeModal || "")}
            >
              Confirm Transition
            </Button>
          </div>
        </div>
      </Modal>

      {/* OCC 409 Conflict Modal */}
      <ConflictModal
        isOpen={isConflictOpen}
        expectedVersion={complaint?.version}
        onClose={() => setIsConflictOpen(false)}
        onReload={async () => {
          setIsConflictOpen(false);
          await refreshData();
        }}
      />
    </div>
  );
}

export default function ComplaintDetailPage({ params }: ComplaintDetailPageProps) {
  const resolvedParams = use(params);
  return (
    <ProtectedRoute>
      <ComplaintDetailView id={resolvedParams.id} />
    </ProtectedRoute>
  );
}
