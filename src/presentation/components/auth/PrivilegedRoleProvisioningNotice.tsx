"use client";

import React from "react";
import Link from "next/link";
import { PersonaConfig } from "./authTypes";

export interface PrivilegedRoleProvisioningNoticeProps {
  personaConfig: PersonaConfig;
  onChangeRole: () => void;
}

export function PrivilegedRoleProvisioningNotice({
  personaConfig,
  onChangeRole,
}: PrivilegedRoleProvisioningNoticeProps) {
  const { label, detailedDescription, palette } = personaConfig;

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 lg:p-10 space-y-6 text-left">
      {/* Top Header & Role Switcher */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Institutional Provisioning
          </span>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            {label} Enrollment
          </h2>
        </div>

        <button
          type="button"
          onClick={onChangeRole}
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
        >
          &larr; Change account type
        </button>
      </div>

      {/* Security & Access Notice */}
      <div
        style={{
          backgroundColor: palette.accent,
          borderColor: palette.secondary,
        }}
        className="rounded-2xl border p-4 sm:p-5 space-y-3"
      >
        <div className="flex items-start gap-3.5">
          <div
            style={{
              backgroundColor: palette.primary,
              color: "#FFFFFF",
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-2xs"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">
              Institutional Account Provisioning Required
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              {detailedDescription}
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200/60 text-xs text-slate-600 space-y-2">
          <p className="font-semibold text-slate-800">
            Identity &amp; Access Governance:
          </p>
          <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-500">
            <li>Privileged roles cannot be self-provisioned through public registration.</li>
            <li>Departmental registrars authorize faculty and handler accounts.</li>
            <li>HOD, Director, and Management credentials are issued by Institutional Administration.</li>
            <li>Role-Based Access Control (RBAC) is enforced cryptographically on every request.</li>
          </ul>
        </div>
      </div>

      {/* Action Guidance */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          Next Steps for Personnel
        </h4>
        <p className="text-xs text-slate-600 leading-relaxed">
          No account request is submitted from this page. If you already have institutional credentials, sign in. Otherwise contact Campus IT to request administrator-managed provisioning.
        </p>
        <div className="pt-1 flex flex-col sm:flex-row gap-3">
          <Link
            href="/login"
            style={{
              backgroundColor: palette.primary,
              color: palette.actionText,
            }}
            className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-xs font-bold shadow-xs hover:opacity-95 transition-opacity text-center"
          >
            Sign In with Existing Account &rarr;
          </Link>
          <Link
            href="/help"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-center"
          >
            Contact Campus IT Helpdesk
          </Link>
        </div>
      </div>

      {/* Return Links */}
      <div className="pt-2 flex items-center justify-between text-xs text-slate-500">
        <button
          type="button"
          onClick={onChangeRole}
          className="hover:text-slate-800 transition-colors cursor-pointer"
        >
          &larr; Choose another persona
        </button>
        <Link href="/" className="hover:text-slate-800 transition-colors">
          Back to Campus Plus &rarr;
        </Link>
      </div>
    </div>
  );
}
