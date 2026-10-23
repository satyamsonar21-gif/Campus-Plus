"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PersonaConfig, RegistrationState } from "./authTypes";
import { PasswordField } from "./PasswordField";
import { AlertBanner } from "@/presentation/components/feedback/AlertBanner";
import { getBrowserSupabaseClient } from "@/presentation/context/AuthContext";
import { apiClient, DepartmentReferenceData } from "@/presentation/services/apiClient";
import { PrivilegedRoleProvisioningNotice } from "./PrivilegedRoleProvisioningNotice";

export interface RoleRegistrationFormProps {
  personaConfig: PersonaConfig;
  onChangeRole?: () => void;
}

export function RoleRegistrationForm({
  personaConfig,
  onChangeRole,
}: RoleRegistrationFormProps) {
  const { id: personaId, label, badgeLabel, palette } = personaConfig;

  // Form input states (backed strictly by users & department_memberships schema)
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState(""); // Maps to users.roll_or_prn
  const [department, setDepartment] = useState(""); // Maps to department_memberships.department_id
  const [departments, setDepartments] = useState<DepartmentReferenceData[]>([]);
  const [isLoadingDepartments, setIsLoadingDepartments] = useState(true);
  const [departmentLoadError, setDepartmentLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);

  // Lifecycle states
  const [registrationState, setRegistrationState] = useState<RegistrationState>("IDLE");
  const [validationError, setValidationError] = useState<string | null>(null);

  const isPrivileged = personaId !== "student";

  useEffect(() => {
    let isMounted = true;
    apiClient.getReferenceData()
      .then((referenceData) => {
        if (!isMounted) return;
        setDepartments(referenceData.departments);
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setDepartmentLoadError(error instanceof Error ? error.message : "Could not load academic departments.");
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingDepartments(false);
      });
    return () => { isMounted = false; };
  }, []);

  const identifierLabel = "Student Roll / ID Number";
  const identifierPlaceholder = "e.g. 23011045";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    const trimmedId = identifier.trim();

    if (!trimmedName) {
      setValidationError("Please enter your full official name.");
      setRegistrationState("VALIDATION_ERROR");
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setValidationError("Please enter a valid institutional email address.");
      setRegistrationState("VALIDATION_ERROR");
      return;
    }
    if (!trimmedId) {
      setValidationError(`Please enter your ${identifierLabel.toLowerCase()}.`);
      setRegistrationState("VALIDATION_ERROR");
      return;
    }
    if (!department) {
      setValidationError("Please select your academic or operational department.");
      setRegistrationState("VALIDATION_ERROR");
      return;
    }
    if (isLoadingDepartments || !departments.some((item) => item.id === department)) {
      setValidationError("Select an active department from the current institutional directory.");
      setRegistrationState("VALIDATION_ERROR");
      return;
    }
    if (password.length < 8) {
      setValidationError("Password must be at least 8 characters in length.");
      setRegistrationState("VALIDATION_ERROR");
      return;
    }
    if (password !== confirmPassword) {
      setValidationError("Passwords do not match. Please re-enter.");
      setRegistrationState("VALIDATION_ERROR");
      return;
    }
    if (!agreeTerms) {
      setValidationError("Please agree to the Campus Plus Terms of Use and Privacy Policy.");
      setRegistrationState("VALIDATION_ERROR");
      return;
    }

    setRegistrationState("SUBMITTING");
    const client = getBrowserSupabaseClient();
    if (!client) {
      setValidationError("Supabase sign-up is not configured. Please contact the campus administrator.");
      setRegistrationState("SERVER_ERROR");
      return;
    }

    try {
      const { data, error } = await client.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            full_name: trimmedName,
            roll_or_prn: trimmedId,
            department_id: department,
          },
        },
      });

      if (error) {
        setValidationError(error.message);
        setRegistrationState(/already registered|already exists/i.test(error.message)
          ? "EMAIL_ALREADY_REGISTERED"
          : "SERVER_ERROR");
        return;
      }
      if (!data.user) {
        setValidationError("Supabase did not create an account. Please try again.");
        setRegistrationState("SERVER_ERROR");
        return;
      }

      setRegistrationState(data.session ? "SUCCESS" : "PENDING_VERIFICATION");
    } catch (error: unknown) {
      setValidationError(error instanceof Error ? error.message : "Student registration failed. Please try again.");
      setRegistrationState("SERVER_ERROR");
    }
  };

  const handleReset = () => {
    setRegistrationState("IDLE");
    setFullName("");
    setEmail("");
    setIdentifier("");
    setDepartment("");
    setPassword("");
    setConfirmPassword("");
    setAgreeTerms(false);
    setValidationError(null);
  };

  // -------------------------------------------------------------
  // Submitted State: Truthful Institutional Intake Confirmation
  // -------------------------------------------------------------
  if (registrationState === "PENDING_VERIFICATION" || registrationState === "SUCCESS") {
    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6 text-center">
        <div
          style={{
            backgroundColor: palette.accent,
            borderColor: palette.secondary,
            color: palette.actionText,
          }}
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border shadow-2xs"
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div className="space-y-2">
          <span
            style={{
              backgroundColor: palette.accent,
              color: palette.actionText,
              borderColor: palette.secondary,
            }}
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wider"
          >
            {registrationState === "PENDING_VERIFICATION" ? "Email Verification Required" : "Account Created"}
          </span>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {registrationState === "PENDING_VERIFICATION" ? "Check your email to activate your account" : "Your student account is active"}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
            {registrationState === "PENDING_VERIFICATION" ? (
              <>A student account for <strong className="text-slate-800">{fullName}</strong> has been created. Follow the verification link sent to <strong className="text-slate-800">{email}</strong> before signing in.</>
            ) : (
              <>A student account for <strong className="text-slate-800">{fullName}</strong> is active. You can continue to your dashboard.</>
            )}
          </p>
        </div>

        {/* Institutional Verification & Provisioning Policy Notice */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-600 text-left space-y-2.5">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <svg className="h-4 w-4 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Student Account Access</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Your account uses the Student role. Staff and administrator roles can only be granted by an authorized institutional administrator.
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
            <li>Only Student access is created by public sign-up.</li>
            <li>Verify the email address before signing in.</li>
            <li>Institutional staff access must be provisioned by an authorized administrator.</li>
          </ul>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            style={{
              backgroundColor: palette.primary,
              color: palette.actionText,
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl px-6 py-2.5 text-xs font-bold shadow-xs hover:opacity-95 transition-opacity"
          >
            &larr; Return to Campus Plus Home
          </Link>
          <button
            type="button"
            onClick={handleReset}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Create Another Student Account
          </button>
        </div>

        <div className="pt-2 border-t border-slate-100 text-center text-xs text-slate-500">
          <span>{registrationState === "SUCCESS" ? "Your student account is active. " : "Already have an account? "}</span>
          <Link href={registrationState === "SUCCESS" ? "/dashboard" : "/login"} className="font-semibold text-blue-600 hover:underline">
            {registrationState === "SUCCESS" ? "Open dashboard" : "Sign In"} &rarr;
          </Link>
        </div>
      </div>
    );
  }

  if (isPrivileged) {
    return (
      <PrivilegedRoleProvisioningNotice
        personaConfig={personaConfig}
        onChangeRole={onChangeRole ?? (() => undefined)}
      />
    );
  }

  // -------------------------------------------------------------
  // Default State: Role-Specific Onboarding Form
  // -------------------------------------------------------------
  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6 text-left">
      {/* Header & Role Switcher */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {badgeLabel} Enrollment
          </span>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            Create Student Account
          </h2>
        </div>

        {onChangeRole && (
          <button
            type="button"
            onClick={onChangeRole}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
          >
            &larr; Change account type
          </button>
        )}
      </div>

      {/* Role Identity & Architectural Purview Notice */}
      <div
        style={{
          backgroundColor: palette.accent,
          borderColor: palette.secondary,
        }}
        className="rounded-2xl border p-4 space-y-2 text-xs"
      >
        <div className="flex items-center gap-2 font-bold" style={{ color: palette.actionText }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: palette.primary }} />
          <span>Role Purview: {label}</span>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: palette.text }}>
          {personaConfig.detailedDescription}
        </p>
      </div>

      {validationError && (
        <AlertBanner variant="error" title={registrationState === "EMAIL_ALREADY_REGISTERED" ? "Email already registered" : "Registration error"}>
          {validationError}
        </AlertBanner>
      )}
      {departmentLoadError && (
        <AlertBanner variant="error" title="Department directory unavailable">
          {departmentLoadError}
        </AlertBanner>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Full Name */}
        <div className="space-y-1.5">
          <label htmlFor="reg-fullname" className="block text-xs font-semibold text-slate-700">
            Full Official Name
          </label>
          <input
            id="reg-fullname"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Official institutional name"
            required
            className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-slate-500 focus:outline-hidden focus:ring-2 focus:ring-slate-200"
          />
        </div>

        {/* Two-Column Grid: ID & Department (when applicable) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1.5">
            <label htmlFor="reg-identifier" className="block text-xs font-semibold text-slate-700">
              {identifierLabel}
            </label>
            <input
              id="reg-identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={identifierPlaceholder}
              required
              className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-slate-500 focus:outline-hidden focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reg-department" className="block text-xs font-semibold text-slate-700">
              Academic Department
            </label>
            <select
              id="reg-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              required
              disabled={isLoadingDepartments || Boolean(departmentLoadError)}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 shadow-2xs transition-colors focus:border-slate-500 focus:outline-hidden focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
            >
              <option value="">{isLoadingDepartments ? "Loading departments…" : "Select Academic Department"}</option>
              {departments.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Institutional Email */}
        <div className="space-y-1.5">
          <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-700">
            Institutional Campus Email
          </label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@college.edu"
            required
            className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-slate-500 focus:outline-hidden focus:ring-2 focus:ring-slate-200"
          />
        </div>

        {/* Password Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <PasswordField
            id="reg-password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder="Min 8 characters"
            helperText="Minimum 8 characters"
          />
          <PasswordField
            id="reg-confirm-password"
            label="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder="Re-enter password"
          />
        </div>

        {/* Terms and Privacy Checkbox */}
        <div className="pt-1">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-600 leading-normal">
              I agree to the{" "}
              <Link href="/terms" className="text-blue-600 hover:underline font-medium">
                Campus Plus Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-blue-600 hover:underline font-medium">
                Privacy Policy
              </Link>
              , and acknowledge that all actions are bound by institutional IAM governance.
            </span>
          </label>
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={registrationState === "SUBMITTING" || isLoadingDepartments || Boolean(departmentLoadError)}
            style={{
              backgroundColor: palette.primary,
              color: palette.actionText,
            }}
            className="w-full flex items-center justify-center rounded-xl py-3 px-4 text-xs sm:text-sm font-bold shadow-xs hover:opacity-95 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {registrationState === "SUBMITTING" ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating Student Account...
              </span>
            ) : (
              "Create Student Account →"
            )}
          </button>
        </div>
      </form>

      {/* Alternative Navigation & Existing Account Shortcut */}
      <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
        <div>
          <span>Already have an institutional account? </span>
          <Link href="/login" className="font-semibold text-blue-600 hover:underline">
            Sign In &rarr;
          </Link>
        </div>
        <Link href="/help" className="hover:text-slate-800 transition-colors">
          IT Helpdesk &rarr;
        </Link>
      </div>
    </div>
  );
}
