"use client";

import React, { useState } from "react";
import { CampusPlusAuthShell } from "@/presentation/components/auth/CampusPlusAuthShell";
import { AuthBrandPanel } from "@/presentation/components/auth/AuthBrandPanel";
import { SignInForm } from "@/presentation/components/auth/SignInForm";
import { PersonaId, PERSONA_CONFIGS } from "@/presentation/components/auth/authTypes";

export function LoginForm() {
  const [selectedPersona, setSelectedPersona] = useState<PersonaId>("student");
  const currentConfig = PERSONA_CONFIGS[selectedPersona];

  return (
    <CampusPlusAuthShell currentPersona={currentConfig} mode="login">
      <div
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center"
        style={{
          "--persona-primary": currentConfig.palette.primary,
          "--persona-secondary": currentConfig.palette.secondary,
          "--persona-accent": currentConfig.palette.accent,
          "--persona-action-text": currentConfig.palette.actionText,
        } as React.CSSProperties}
      >
        <div className="lg:col-span-6 hidden lg:block">
          <AuthBrandPanel selectedPersonaConfig={currentConfig} />
        </div>
        <div className="lg:col-span-6 w-full max-w-md mx-auto">
          <SignInForm selectedPersona={selectedPersona} onSelectPersona={setSelectedPersona} />
        </div>
      </div>
    </CampusPlusAuthShell>
  );
}
