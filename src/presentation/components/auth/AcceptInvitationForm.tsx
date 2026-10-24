"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PasswordField } from "./PasswordField";
import { AlertBanner } from "@/presentation/components/feedback/AlertBanner";

export function AcceptInvitationForm() {
  const searchParams = useSearchParams();
  const initialToken = searchParams.get("token") || "";

  const [token, setToken] = useState(initialToken);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successDetails, setSuccessDetails] = useState<{
    email: string;
    role: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedToken = token.trim();
    const trimmedEmail = email.trim();
    const trimmedName = fullName.trim();

    if (!trimmedToken) {
      setErrorMessage("Please enter your invitation token.");
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setErrorMessage("Please enter the institutional email address bound to your invitation.");
      return;
    }
    if (!trimmedName) {
      setErrorMessage("Please enter your full official name.");
      return;
    }
    if (!password || password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: trimmedToken,
          email: trimmedEmail,
          fullName: trimmedName,
          identifier: identifier.trim() || undefined,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(
          data?.error?.message ||
            "Failed to accept invitation. Please check your token and email address."
        );
        setIsSubmitting(false);
        return;
      }

      setIsSuccess(true);
      setSuccessDetails({
        email: trimmedEmail,
        role: data.data.role,
      });
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess && successDetails) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 lg:p-10 space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div className="space-y-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-emerald-200 bg-emerald-50 text-emerald-800 uppercase tracking-wider">
            Account Activated
          </span>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Welcome to Campus Plus
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
            Your institutional credentials for <strong className="text-slate-800">{successDetails.email}</strong> have been provisioned with role <strong className="text-slate-800">{successDetails.role}</strong>.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition-colors"
          >
            Continue to Institutional Sign In &rarr;
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 lg:p-10 space-y-6 text-left">
      <div className="border-b border-slate-100 pb-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Authority Onboarding
        </span>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
          Redeem Institutional Invitation
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Activate your appointed institutional authority account using your secure invitation token.
        </p>
      </div>

      {errorMessage && (
        <AlertBanner variant="error" title="Invitation Verification Notice">
          {errorMessage}
        </AlertBanner>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="inv-token" className="block text-xs font-semibold text-slate-700">
            Invitation Token
          </label>
          <input
            id="inv-token"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your 64-character token"
            required
            className="block w-full font-mono rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-slate-500 focus:outline-hidden focus:ring-2 focus:ring-slate-200"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="inv-email" className="block text-xs font-semibold text-slate-700">
            Invited Institutional Email
          </label>
          <input
            id="inv-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="personnel@institution.edu"
            required
            className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-slate-500 focus:outline-hidden focus:ring-2 focus:ring-slate-200"
          />
          <p className="text-[11px] text-slate-500">
            Must exactly match the email address the invitation was issued to.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1.5">
            <label htmlFor="inv-fullname" className="block text-xs font-semibold text-slate-700">
              Full Official Name
            </label>
            <input
              id="inv-fullname"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Dr. Jane Doe"
              required
              className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-slate-500 focus:outline-hidden focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="inv-id" className="block text-xs font-semibold text-slate-700">
              Employee / Appointment ID (Optional)
            </label>
            <input
              id="inv-id"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. EMP-2026-09"
              className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-slate-500 focus:outline-hidden focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <PasswordField
            id="inv-password"
            label="Create Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
          <PasswordField
            id="inv-confirm-password"
            label="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isSubmitting ? "Activating Institutional Account…" : "Activate Institutional Account"}
        </button>
      </form>

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <Link href="/login" className="text-blue-600 hover:underline">
          &larr; Return to Sign In
        </Link>
        <Link href="/help" className="hover:text-slate-800">
          Need assistance?
        </Link>
      </div>
    </div>
  );
}
