"use client";

import React, { useState } from "react";
import { PersonaId, PERSONA_CONFIGS, ALL_PERSONA_IDS } from "./authTypes";
import { RoleOptionCard } from "./RoleOptionCard";
import { RoleRegistrationForm } from "./RoleRegistrationForm";
import { PrivilegedRoleProvisioningNotice } from "./PrivilegedRoleProvisioningNotice";

export interface RegistrationFlowProps {
  initialPersona?: PersonaId;
  onPersonaChange?: (persona: PersonaId) => void;
}

export function RegistrationFlow({
  initialPersona = "student",
  onPersonaChange,
}: RegistrationFlowProps) {
  const [selectedPersona, setSelectedPersona] = useState<PersonaId>(initialPersona);

  const handleSelectPersona = (id: PersonaId) => {
    setSelectedPersona(id);
    onPersonaChange?.(id);
  };

  const currentConfig = PERSONA_CONFIGS[selectedPersona];

  return (
    <div className="space-y-6">
      {/* 5-Role Balanced Card Chooser */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-5 text-left">
        <div className="border-b border-slate-100 pb-4 space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Account Enrollment
          </span>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Create your Campus Plus account
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Choose how you participate in the campus grievance process.
          </p>
        </div>

        {/* 5 Balanced Role Cards */}
        <div
          role="radiogroup"
          aria-label="Account Type Selection"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1"
        >
          {ALL_PERSONA_IDS.map((id, index) => {
            const isFifth = index === 4;
            return (
              <div key={id} className={isFifth ? "sm:col-span-2" : undefined}>
                <RoleOptionCard
                  config={PERSONA_CONFIGS[id]}
                  isSelected={selectedPersona === id}
                  onSelect={handleSelectPersona}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Student self-registration is open; staff roles require administrator provisioning. */}
      <div id="role-onboarding-section">
        {selectedPersona === "student" ? (
          <RoleRegistrationForm
            personaConfig={currentConfig}
            onChangeRole={() => {
              if (typeof window !== "undefined") {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          />
        ) : (
          <PrivilegedRoleProvisioningNotice
            personaConfig={currentConfig}
            onChangeRole={() => {
              if (typeof window !== "undefined") {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
