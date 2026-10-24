"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/presentation/context/AuthContext";
import { PersonaId, PERSONA_CONFIGS } from "./authTypes";
import { RoleSelector } from "./RoleSelector";
import { PasswordField } from "./PasswordField";
import { AlertBanner } from "@/presentation/components/feedback/AlertBanner";
import { sanitizeRedirect } from "@/presentation/utils/security";
import { formatRoleLabel } from "@/presentation/navigation/navigationConfig";

export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_CONFIRMED"
  | "ACCOUNT_INACTIVE"
  | "ACCOUNT_PENDING_APPROVAL"
  | "VERIFICATION_REJECTED"
  | "MISSING_ROLE_MAPPING"
  | "IDENTITY_NOT_PROVISIONED"
  | "NETWORK_FAILURE"
  | "SERVER_FAILURE"
  | "UNKNOWN_AUTH_FAILURE";

export interface ParsedAuthError {
  code: AuthErrorCode;
  message: string;
}

export function parseAuthError(err: unknown): ParsedAuthError {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    // 1. Email Not Confirmed
    if (msg.includes("email not confirmed") || msg.includes("email_not_confirmed")) {
      return {
        code: "EMAIL_NOT_CONFIRMED",
        message: "Please verify your institutional email before signing in.",
      };
    }

    // 2. Pending Institutional Approval
    if (
      msg.includes("pending departmental verification") ||
      msg.includes("pending institutional") ||
      msg.includes("pending verification")
    ) {
      return {
        code: "ACCOUNT_PENDING_APPROVAL",
        message: "Your institutional onboarding request is currently pending departmental verification.",
      };
    }

    // 3. Verification Request Rejected
    if (
      msg.includes("verification request was not approved") ||
      msg.includes("verification rejected")
    ) {
      return {
        code: "VERIFICATION_REJECTED",
        message: "Your institutional verification request was not approved. Please contact your department head.",
      };
    }

    // 4. Missing Role Mapping
    if (
      msg.includes("no institutional role has been assigned") ||
      msg.includes("no campus role has been assigned")
    ) {
      return {
        code: "MISSING_ROLE_MAPPING",
        message: "Your account is active, but no institutional role has been assigned. Please contact Campus Administration.",
      };
    }

    // 5. Account Inactive / Disabled
    if (
      msg.includes("deactivated") ||
      msg.includes("disabled") ||
      msg.includes("inactive") ||
      msg.includes("user account is deactivated")
    ) {
      return {
        code: "ACCOUNT_INACTIVE",
        message: "This account is currently inactive. Please contact your institution.",
      };
    }

    // 6. Identity Not Provisioned / Missing Mapping
    if (
      msg.includes("does not map to any active user record") ||
      msg.includes("not provisioned") ||
      msg.includes("not assigned an active campus role") ||
      msg.includes("unmapped identity")
    ) {
      return {
        code: "IDENTITY_NOT_PROVISIONED",
        message: "Your account exists, but institutional access has not yet been provisioned.",
      };
    }

    // 7. Network Failure
    if (
      msg.includes("network") ||
      msg.includes("failed to fetch") ||
      msg.includes("timeout") ||
      msg.includes("could not reach")
    ) {
      return {
        code: "NETWORK_FAILURE",
        message: "We couldn't reach Campus Plus. Please check your connection and try again.",
      };
    }

    // 8. Server Failure
    if (
      msg.includes("internal server error") ||
      msg.includes("server failure") ||
      msg.includes("not configured") ||
      msg.includes("500")
    ) {
      return {
        code: "SERVER_FAILURE",
        message: "Campus Plus could not complete authentication right now. Please try again.",
      };
    }

    // 9. Invalid Credentials (password mismatch, user not found, invalid_credentials)
    if (
      msg.includes("invalid login credentials") ||
      msg.includes("invalid credentials") ||
      msg.includes("wrong password") ||
      msg.includes("user not found") ||
      msg.includes("invalid_credentials")
    ) {
      return {
        code: "INVALID_CREDENTIALS",
        message: "The email or password is incorrect.",
      };
    }
  }

  return {
    code: "UNKNOWN_AUTH_FAILURE",
    message: "Unable to verify campus credentials. Please check your details and try again.",
  };
}

export function getAuthErrorNextStep(code: AuthErrorCode): string | null {
  switch (code) {
    case "ACCOUNT_PENDING_APPROVAL":
      return "Next Step: Your appointment is awaiting verification by your Department Head or Administrator. You will be able to sign in once approved.";
    case "EMAIL_NOT_CONFIRMED":
      return "Next Step: Check your inbox and spam folder for the confirmation email, and click the activation link.";
    case "IDENTITY_NOT_PROVISIONED":
      return "Next Step: If you are an invited authority or faculty member, please redeem your invitation token, or contact Campus IT to provision your profile.";
    case "ACCOUNT_INACTIVE":
      return "Next Step: If you believe this deactivation is in error, please contact your department administrator or Campus IT.";
    case "MISSING_ROLE_MAPPING":
      return "Next Step: Please ask Campus Administration to assign your technical role in the institutional registry.";
    case "VERIFICATION_REJECTED":
      return "Next Step: Contact your department head or academic affairs office for details regarding your appointment status.";
    case "INVALID_CREDENTIALS":
      return "Next Step: Double-check your campus email address and password, or use the password reset link.";
    default:
      return null;
  }
}

export function mapAuthErrorMessage(err: unknown): string {
  return parseAuthError(err).message;
}

export interface SignInFormProps {
  selectedPersona: PersonaId;
  onSelectPersona: (id: PersonaId) => void;
}

export function SignInForm({ selectedPersona, onSelectPersona }: SignInFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authState, signIn, actor, error: authError } = useAuth();

  // Strictly initialized empty — zero hardcoded credentials
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [roleMismatch, setRoleMismatch] = useState<{
    serverRole: string;
    expectedPersona: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const personaConfig = PERSONA_CONFIGS[selectedPersona];
  const { palette } = personaConfig;

  // Handle active session redirection
  useEffect(() => {
    if (authState === "AUTHENTICATED" && !roleMismatch) {
      const redirectParam = searchParams.get("redirect");
      const targetUrl = sanitizeRedirect(redirectParam, "/dashboard");
      router.replace(targetUrl);
    }
  }, [authState, router, searchParams, roleMismatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setFormError(null);
    setRoleMismatch(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError("Please enter your institutional email.");
      return;
    }
    if (!password) {
      setFormError("Please enter your password.");
      return;
    }

    setIsSubmitting(true);
    try {
      await signIn(trimmedEmail, password);

      // Section 3: Verify whether the authoritative server role matches selected persona
      if (actor && actor.role) {
        const isPermitted = personaConfig.allowedTechnicalRoles.includes(actor.role);
        if (!isPermitted) {
          const serverRoleLabel = formatRoleLabel(actor.role);
          setRoleMismatch({
            serverRole: serverRoleLabel,
            expectedPersona: personaConfig.label,
          });
          setIsSubmitting(false);
          return;
        }
      }

      const redirectParam = searchParams.get("redirect");
      const targetUrl = sanitizeRedirect(redirectParam, "/dashboard");
      router.push(targetUrl);
    } catch (err: unknown) {
      setIsSubmitting(false);
      setFormError(mapAuthErrorMessage(err));
    }
  };

  const handleProceedWithServerRole = () => {
    const redirectParam = searchParams.get("redirect");
    const targetUrl = sanitizeRedirect(redirectParam, "/dashboard");
    router.push(targetUrl);
  };

  const parsedError = authError ? parseAuthError(new Error(authError)) : null;
  const displayError = formError || (parsedError ? parsedError.message : null);
  const nextStepAdvice = parsedError ? getAuthErrorNextStep(parsedError.code) : null;

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 lg:p-10 space-y-6">
      {/* Header */}
      <div className="border-b border-slate-100 pb-4 space-y-1">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Welcome back
        </h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Sign in to continue to your Campus Plus account.
        </p>
      </div>

      {/* Role Mismatch Warning (Section 3 Security Compliance) */}
      {roleMismatch && (
        <AlertBanner variant="warning" title="Account Role Notice">
          <div className="space-y-2">
            <p>
              Your account is registered as a{" "}
              <strong className="font-bold">{roleMismatch.serverRole}</strong> account.
              Privileges are strictly governed by your server-authoritative credentials.
            </p>
            <div>
              <button
                type="button"
                onClick={handleProceedWithServerRole}
                className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 hover:underline cursor-pointer"
              >
                <span>Continue to {roleMismatch.serverRole} Workspace &rarr;</span>
              </button>
            </div>
          </div>
        </AlertBanner>
      )}

      {/* Form Error Banner with Actionable Next-Step Guidance */}
      {!roleMismatch && displayError && (
        <AlertBanner variant="error" title="Authentication Notice">
          <div className="space-y-1.5 text-left">
            <p>{displayError}</p>
            {nextStepAdvice && (
              <p className="text-[11px] font-medium text-red-700/90 pt-1 border-t border-red-200/50">
                {nextStepAdvice}
              </p>
            )}
          </div>
        </AlertBanner>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* 1. Account Type / Persona Selector */}
        <RoleSelector
          selectedPersona={selectedPersona}
          onSelectPersona={(p) => {
            onSelectPersona(p);
            setRoleMismatch(null);
          }}
          label="ACCOUNT TYPE"
          helperText="Select your designated campus role before signing in:"
        />

        {/* 2. Institutional Email */}
        <div className="space-y-1.5 text-left">
          <label
            htmlFor="campus-email"
            className="block text-xs font-semibold text-slate-700"
          >
            EMAIL / INSTITUTIONAL EMAIL
          </label>
          <input
            id="campus-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="username@institution.edu"
            aria-describedby="campus-email-helper"
            required
            className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-[var(--persona-primary,#7FA8D9)] focus:outline-hidden focus:ring-2 focus:ring-[var(--persona-secondary,#B8D0EC)]/40"
          />
          <p id="campus-email-helper" className="text-[11px] text-slate-500 pt-0.5">
            Use your registered academic or administrative email address.
          </p>
        </div>

        {/* 3. Password Field */}
        <PasswordField
          id="campus-password"
          name="password"
          label="PASSWORD"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />

        {/* 4. Meta Row: Session Persistence & Help */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center space-x-2 text-slate-500">
            <svg
              className="h-4 w-4 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            <span>Session secured via JWT</span>
          </div>

          <Link
            href="/help"
            className="font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Forgot password?
          </Link>
        </div>

        {/* 5. Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            style={{
              backgroundColor:
                selectedPersona === "student"
                  ? "var(--role-primary,#7FA8D9)"
                  : palette.primary,
              color:
                selectedPersona === "student"
                  ? "var(--role-btn-text,#1E3A5F)"
                  : palette.actionText,
            }}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 font-bold text-xs sm:text-sm shadow-xs transition-opacity hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {isSubmitting ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Signing in...</span>
              </>
            ) : (
              <span>SIGN IN</span>
            )}
          </button>
        </div>
      </form>

      {/* Footer Switcher */}
      <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
        <div>
          <span>Don&apos;t have an account? </span>
          <Link
            href="/register"
            className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
          >
            Create New Account
          </Link>
        </div>

        <Link
          href="/"
          className="text-slate-500 hover:text-slate-800 transition-colors"
        >
          &larr; Back to Campus Plus
        </Link>
      </div>

      {/* Institutional IT Helpdesk Footer */}
      <div className="pt-3 border-t border-slate-100 text-center sm:text-left text-[11px] text-slate-500 space-y-0.5">
        <p className="font-semibold text-slate-700">Having trouble signing in?</p>
        <p>Contact your institutional IT department or grievance coordinator</p>
      </div>
    </div>
  );
}
