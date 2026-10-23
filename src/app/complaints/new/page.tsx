"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ProtectedRoute } from "@/presentation/components/auth/ProtectedRoute";
import { UserRole } from "@/domain/complaint";
import { apiClient, CategoryReferenceData } from "@/presentation/services/apiClient";
import { Card } from "@/presentation/components/primitives/Card";
import { Button } from "@/presentation/components/primitives/Button";
import { TextInput } from "@/presentation/components/forms/TextInput";
import { TextArea } from "@/presentation/components/forms/TextArea";
import { AlertBanner } from "@/presentation/components/feedback/AlertBanner";
import { FileUploader, UploadedFileItem } from "@/presentation/components/domain/FileUploader";

const PRIORITIES: Array<{ id: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; label: string }> = [
  { id: "LOW", label: "Low" },
  { id: "MEDIUM", label: "Medium" },
  { id: "HIGH", label: "High" },
  { id: "URGENT", label: "Urgent" },
];

function NewComplaintForm() {
  const router = useRouter();

  // Form State
  const [categories, setCategories] = useState<CategoryReferenceData[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationDetails, setLocationDetails] = useState("");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);

  // Workflow & Validation State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedCategory = categories.find((category) => category.id === categoryId);

  useEffect(() => {
    let isMounted = true;

    apiClient.getReferenceData()
      .then((referenceData) => {
        if (!isMounted) return;
        setCategories(referenceData.categories);
        setCategoryId((current) => current || referenceData.categories[0]?.id || "");
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setCategoryLoadError(error instanceof Error ? error.message : "Could not load complaint categories.");
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingCategories(false);
      });

    return () => { isMounted = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validation checks matching domain value objects
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 10 || trimmedTitle.length > 120) {
      setErrorMessage("Title must be between 10 and 120 characters.");
      return;
    }

    const trimmedDesc = description.trim();
    if (trimmedDesc.length < 30) {
      setErrorMessage("Description must contain at least 30 characters detailing the issue.");
      return;
    }

    if (!locationDetails.trim()) {
      setErrorMessage("Please specify the campus location (e.g. Building, Room number, Floor).");
      return;
    }

    if (!selectedCategory) {
      setErrorMessage("Select an active complaint category before submitting.");
      return;
    }

    setIsSubmitting(true);
    try {
      const attachments: NonNullable<Parameters<typeof apiClient.submitComplaint>[0]["attachments"]> = [];
      for (const item of files) {
        const presignRes = await apiClient.presignUpload({
          filename: item.name,
          mimeType: item.file.type as "image/jpeg" | "image/png" | "application/pdf",
          fileSizeBytes: item.sizeBytes,
        });
        const uploadResponse = await fetch(presignRes.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": item.file.type },
          body: item.file,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Could not upload "${item.name}". Please retry the upload.`);
        }
        attachments.push({
          fileKey: presignRes.fileKey,
          originalFilename: item.name,
          mimeType: item.file.type as "image/jpeg" | "image/png" | "application/pdf",
          fileSizeBytes: item.sizeBytes,
        });
      }

      // Submit complaint with UUIDv4 Idempotency-Key
      const idempotencyKey = crypto.randomUUID();
      const result = await apiClient.submitComplaint(
        {
          title: trimmedTitle,
          description: trimmedDesc,
          categoryId: selectedCategory.id,
          departmentId: selectedCategory.defaultDepartmentId,
          locationDetails: locationDetails.trim(),
          suggestedPriority: priority,
          attachments,
        },
        idempotencyKey
      );

      // Redirect to newly created complaint detail view
      router.push(`/complaints/${result.complaintId}`);
    } catch (err: unknown) {
      setIsSubmitting(false);
      setErrorMessage(err instanceof Error ? err.message : "Failed to register grievance. Please try again.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Register Formal Grievance
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Submit a campus infrastructure, academic, or facility issue for authoritative triage and resolution.
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            &larr; Cancel
          </Button>
        </Link>
      </div>

      {errorMessage && (
        <AlertBanner variant="error" title="Validation &amp; Submission Error">
          {errorMessage}
        </AlertBanner>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Step 1: Category Selection */}
        <Card title="1. Category &amp; Jurisdiction" description="Select the institutional category that best describes your grievance.">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
            {isLoadingCategories && (
              <p className="col-span-full text-xs text-slate-500" role="status">Loading active categories…</p>
            )}
            {categoryLoadError && (
              <div className="col-span-full">
                <AlertBanner variant="error" title="Categories unavailable">{categoryLoadError}</AlertBanner>
              </div>
            )}
            {!isLoadingCategories && !categoryLoadError && categories.length === 0 && (
              <p className="col-span-full text-xs text-slate-500">No active complaint categories are configured.</p>
            )}
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryId(cat.id)}
                disabled={isSubmitting}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  categoryId === cat.id
                    ? "border-[var(--role-primary,#7FA8D9)] bg-[var(--role-accent,#EAF2FB)] ring-1 ring-[var(--role-primary,#7FA8D9)]"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="font-semibold text-xs text-slate-900">{cat.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Routed to {cat.defaultDepartmentName}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* Step 2 & 3: Subject and Description */}
        <Card title="2. Grievance Details" description="Provide clear, factual information to help handlers triage and investigate.">
          <div className="space-y-4 pt-2">
            <div>
              <TextInput
                id="complaint-title"
                label="Grievance Title / Subject (10–120 characters)"
                required
                placeholder="e.g. Wi-Fi Connectivity Down in Mechanical Lab 2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                disabled={isSubmitting}
                helperText={`${title.trim().length} / 120 characters (minimum 10 required)`}
              />
            </div>

            <div>
              <TextArea
                id="complaint-description"
                label="Detailed Description (minimum 30 characters)"
                required
                rows={4}
                placeholder="Describe the problem, when it started, and its impact on campus operations..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                helperText={`${description.trim().length} characters (minimum 30 required)`}
              />
            </div>

            <div>
              <TextInput
                id="complaint-location"
                label="Location Details"
                required
                placeholder="e.g. Academic Block B, 2nd Floor, Room 204"
                value={locationDetails}
                onChange={(e) => setLocationDetails(e.target.value)}
                disabled={isSubmitting}
                helperText="Specify the building, floor, lab, or hostel room where the issue occurred."
              />
            </div>
          </div>
        </Card>

        {/* Step 4: Suggested Priority */}
        <Card title="3. Impact &amp; Suggested Priority" description="This is a suggested level. Authorized staff confirm the official priority during review.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {PRIORITIES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPriority(p.id)}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  priority === p.id
                    ? "border-[var(--role-primary,#7FA8D9)] bg-[var(--role-accent,#EAF2FB)] ring-1 ring-[var(--role-primary,#7FA8D9)]"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-900">{p.label} Priority</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">For staff triage only; this does not set a resolution deadline.</p>
              </button>
            ))}
          </div>
        </Card>

        {/* Step 4: Supporting Attachments */}
        <Card title="4. Evidence &amp; Attachments (Optional)" description="Upload photos or PDF documents supporting your grievance (max 3 files, 5MB each).">
          <div className="pt-2">
            <FileUploader
              files={files}
              onChange={setFiles}
              maxFiles={3}
              maxSizeBytes={5 * 1024 * 1024}
              disabled={isSubmitting}
            />
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Private evidence:</span> Each upload is verified and linked to this complaint before submission completes. A failed upload blocks the complaint so no missing evidence is reported as attached.
            </div>
          </div>
        </Card>

        {/* Step 5: Review & Confirm Submission */}
        <Card title="5. Review &amp; Confirm Submission" description="Review all provided details before authoritatively filing this grievance into the Campus Plus ledger.">
          <div className="space-y-4 pt-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 divide-y divide-slate-200/80 text-xs">
              <div className="pb-2.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Jurisdiction &amp; Category:</span>
                <span className="font-semibold text-slate-900">{selectedCategory?.name ?? "Category unavailable"}</span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Suggested Priority:</span>
                <span className="font-semibold text-slate-900">{priority} Priority</span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Subject / Title:</span>
                <span className="font-semibold text-slate-900 truncate max-w-xs">{title.trim() || "(Pending input)"}</span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Campus Location:</span>
                <span className="font-semibold text-slate-900">{locationDetails.trim() || "(Pending input)"}</span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Description Length:</span>
                <span className="font-semibold text-slate-900">{description.trim().length} chars (min 30)</span>
              </div>
              <div className="pt-2.5 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Attached Proofs:</span>
                <span className="font-semibold text-slate-900">{files.length} file(s) attached</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              Upon clicking &quot;Submit Grievance&quot;, your complaint will be assigned a unique immutable tracking code (CP-YYYY-XXXXX) and queued for triage by the designated department head.
            </p>
          </div>
        </Card>

        {/* Submission Confirmation */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <Link href="/dashboard">
            <Button variant="outline" size="md" disabled={isSubmitting}>
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="font-bold shadow-xs"
            isLoading={isSubmitting}
            disabled={isSubmitting || isLoadingCategories || categories.length === 0}
          >
            Submit Grievance
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewComplaintPage() {
  return (
    <ProtectedRoute allowedRoles={[UserRole.ROLE_STUDENT]}>
      <NewComplaintForm />
    </ProtectedRoute>
  );
}
