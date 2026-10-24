"use client";

import React, { Suspense } from "react";
import { CampusPlusAuthShell } from "@/presentation/components/auth/CampusPlusAuthShell";
import { PERSONA_CONFIGS } from "@/presentation/components/auth/authTypes";
import { AcceptInvitationForm } from "@/presentation/components/auth/AcceptInvitationForm";

export default function AcceptInvitationPage() {
  const currentConfig = PERSONA_CONFIGS.director;

  return (
    <CampusPlusAuthShell currentPersona={currentConfig} mode="login">
      <div className="max-w-xl mx-auto w-full">
        <Suspense fallback={<div className="p-8 text-center text-slate-500 text-xs">Loading invitation portal…</div>}>
          <AcceptInvitationForm />
        </Suspense>
      </div>
    </CampusPlusAuthShell>
  );
}
