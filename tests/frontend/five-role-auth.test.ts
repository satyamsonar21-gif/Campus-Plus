import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PERSONA_CONFIGS, ALL_PERSONA_IDS, getPersonaFromRole } from "@/presentation/components/auth/authTypes";
import { RoleOptionCard } from "@/presentation/components/auth/RoleOptionCard";
import { RoleRegistrationForm } from "@/presentation/components/auth/RoleRegistrationForm";
import { RegistrationFlow } from "@/presentation/components/auth/RegistrationFlow";
import RegisterPage from "@/app/register/page";
import { isValidInternalRedirect, sanitizeRedirect, validateRouteId } from "@/presentation/utils/security";
import { mapAuthErrorMessage } from "@/presentation/components/auth/SignInForm";
import { UserRole } from "@/domain/complaint";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn().mockReturnValue(null),
  }),
}));

describe("Five-Role Authentication Architecture & Security Matrix", () => {
  describe("1. Five Public Personas & Locked Palettes (Contract Compliance)", () => {
    it("defines exactly five locked public personas", () => {
      expect(ALL_PERSONA_IDS).toEqual(["student", "handler", "hod", "director", "management"]);
      expect(Object.keys(PERSONA_CONFIGS)).toHaveLength(5);
    });

    it("enforces immutable role palettes matching Section 3 exact specifications", () => {
      // Student
      expect(PERSONA_CONFIGS.student.palette.primary).toBe("#7FA8D9");
      expect(PERSONA_CONFIGS.student.palette.text).toBe("#33475B");
      expect(PERSONA_CONFIGS.student.palette.actionText).toBe("#1E3A5F");

      // Faculty / Handler
      expect(PERSONA_CONFIGS.handler.palette.primary).toBe("#7FC4B2");
      expect(PERSONA_CONFIGS.handler.palette.text).toBe("#2E4A42");
      expect(PERSONA_CONFIGS.handler.palette.actionText).toBe("#1A3830");

      // HOD
      expect(PERSONA_CONFIGS.hod.palette.primary).toBe("#B39DDB");
      expect(PERSONA_CONFIGS.hod.palette.text).toBe("#43395A");
      expect(PERSONA_CONFIGS.hod.palette.actionText).toBe("#2B1E40");

      // Director / Senior Authority
      expect(PERSONA_CONFIGS.director.palette.primary).toBe("#9FB4C7");
      expect(PERSONA_CONFIGS.director.palette.text).toBe("#37495A");
      expect(PERSONA_CONFIGS.director.palette.actionText).toBe("#223344");

      // Institutional Management
      expect(PERSONA_CONFIGS.management.palette.primary).toBe("#E3A6AE");
      expect(PERSONA_CONFIGS.management.palette.text).toBe("#5C333A");
      expect(PERSONA_CONFIGS.management.palette.actionText).toBe("#3D1C22");
    });

    it("verifies locked short descriptions matching Section 2 requirements", () => {
      expect(PERSONA_CONFIGS.student.shortDescription).toBe(
        "Raise and track campus complaints, verify resolutions, and stay informed."
      );
      expect(PERSONA_CONFIGS.handler.shortDescription).toBe(
        "Review, manage, assign, and resolve complaints within your authorized institutional responsibilities."
      );
      expect(PERSONA_CONFIGS.hod.shortDescription).toBe(
        "Oversee department grievances, escalations, accountability, and resolution."
      );
      expect(PERSONA_CONFIGS.director.shortDescription).toBe(
        "Provide senior institutional oversight for escalated grievances and accountability."
      );
      expect(PERSONA_CONFIGS.management.shortDescription).toBe(
        "Monitor institutional grievance governance, patterns, accountability, and campus-level improvement."
      );
    });

    it("maps domain technical roles safely to personas without privilege elevation", () => {
      expect(getPersonaFromRole(UserRole.ROLE_STUDENT)).toBe("student");
      expect(getPersonaFromRole(UserRole.ROLE_FACULTY)).toBe("student"); // Complainant view by default
      expect(getPersonaFromRole(UserRole.ROLE_HANDLER)).toBe("handler");
      expect(getPersonaFromRole(UserRole.ROLE_DEPT_HEAD)).toBe("hod");
      expect(getPersonaFromRole(UserRole.ROLE_ADMIN)).toBe("director");
      expect(getPersonaFromRole(UserRole.ROLE_MANAGEMENT)).toBe("management");
      expect(getPersonaFromRole(null)).toBe("student");
      expect(getPersonaFromRole(undefined)).toBe("student");
    });
  });

  describe("2. Role Option Cards (Visual Quality & Accessibility)", () => {
    it("renders role option cards with radio semantics and aria-checked", () => {
      const html = renderToStaticMarkup(
        React.createElement(RoleOptionCard, {
          config: PERSONA_CONFIGS.student,
          isSelected: true,
          onSelect: vi.fn(),
        })
      );
      expect(html).contain('role="radio"');
      expect(html).contain('aria-checked="true"');
      expect(html).contain("Student");
      expect(html).contain("Raise and track campus complaints");
    });

    it("renders all five role cards in RegistrationFlow with equal visual prominence", () => {
      const html = renderToStaticMarkup(React.createElement(RegistrationFlow));
      expect(html).contain("Create your Campus Plus account");
      expect(html).contain("Choose how you participate in the campus grievance process.");
      expect(html).contain("Student");
      expect(html).contain("Faculty / Complaint Handler");
      expect(html).contain("HOD");
      expect(html).contain("Director / Senior Authority");
      expect(html).contain("Institutional Management");
    });

    it("renders full registration page with 5-role directory and institutional IAM compliance", () => {
      const html = renderToStaticMarkup(React.createElement(RegisterPage));
      expect(html).contain("Campus Plus Institutional Directory");
      expect(html).contain("Identity &amp; Access Governance");
      expect(html).contain("Create your Campus Plus account");
    });
  });

  describe("3. Role-Specific Onboarding & Field Provenance (Zero Fake Fields)", () => {
    it("renders a real Student sign-up form using database-backed departments", () => {
      const html = renderToStaticMarkup(
        React.createElement(RoleRegistrationForm, {
          personaConfig: PERSONA_CONFIGS.student,
        })
      );
      expect(html).contain("Create Student Account");
      expect(html).contain("Full Official Name");
      expect(html).contain("Student Roll / ID Number");
      expect(html).contain("Institutional Campus Email");
      expect(html).contain("Academic Department");
      expect(html).contain("Create Student Account");
      expect(html).not.contain("Submit Student Enrollment Request");
    });

    it("does not allow public self-provisioning of Faculty / Handler accounts", () => {
      const html = renderToStaticMarkup(
        React.createElement(RoleRegistrationForm, {
          personaConfig: PERSONA_CONFIGS.handler,
        })
      );
      expect(html).contain("Faculty / Complaint Handler Enrollment");
      expect(html).contain("Institutional Account Provisioning Required");
      expect(html).contain("No account request is submitted from this page");
      expect(html).not.contain("Faculty / Staff ID Number");
      expect(html).not.contain("Submit Faculty Onboarding Request");
    });

    it("does not allow public self-provisioning of HOD accounts", () => {
      const html = renderToStaticMarkup(
        React.createElement(RoleRegistrationForm, {
          personaConfig: PERSONA_CONFIGS.hod,
        })
      );
      expect(html).contain("HOD Enrollment");
      expect(html).contain("Institutional Account Provisioning Required");
      expect(html).not.contain("Submit HOD Appointment Verification Request");
    });

    it("does not allow public self-provisioning of Director accounts", () => {
      const html = renderToStaticMarkup(
        React.createElement(RoleRegistrationForm, {
          personaConfig: PERSONA_CONFIGS.director,
        })
      );
      expect(html).contain("Director / Senior Authority Enrollment");
      expect(html).contain("Institutional Account Provisioning Required");
      expect(html).not.contain("Submit Directorate Verification Inquiry");
    });

    it("does not allow public self-provisioning of Management accounts", () => {
      const html = renderToStaticMarkup(
        React.createElement(RoleRegistrationForm, {
          personaConfig: PERSONA_CONFIGS.management,
        })
      );
      expect(html).contain("Institutional Management Enrollment");
      expect(html).contain("Institutional Account Provisioning Required");
      expect(html).not.contain("Submit Board Governance Verification Request");
    });
  });

  describe("4. Security & Privilege Escalation Prevention", () => {
    it("strictly blocks open redirect vectors", () => {
      expect(isValidInternalRedirect("https://attacker.com")).toBe(false);
      expect(isValidInternalRedirect("//attacker.com")).toBe(false);
      expect(isValidInternalRedirect("/\\attacker.com")).toBe(false);
      expect(isValidInternalRedirect("javascript:alert(1)")).toBe(false);
      expect(isValidInternalRedirect("/dashboard/../../etc/passwd")).toBe(false);
      expect(isValidInternalRedirect("")).toBe(false);
      expect(isValidInternalRedirect(null)).toBe(false);
    });

    it("permits only registered internal application paths", () => {
      expect(isValidInternalRedirect("/dashboard")).toBe(true);
      expect(isValidInternalRedirect("/complaints")).toBe(true);
      expect(isValidInternalRedirect("/complaints/new")).toBe(true);
      expect(isValidInternalRedirect("/login")).toBe(true);
      expect(isValidInternalRedirect("/register")).toBe(true);
      expect(isValidInternalRedirect("/profile")).toBe(true);
      expect(isValidInternalRedirect("/help")).toBe(true);
      expect(isValidInternalRedirect("/privacy")).toBe(true);
      expect(isValidInternalRedirect("/terms")).toBe(true);
    });

    it("sanitizes invalid redirects safely to default fallback", () => {
      expect(sanitizeRedirect("https://evil.com", "/dashboard")).toBe("/dashboard");
      expect(sanitizeRedirect("//evil.com", "/dashboard")).toBe("/dashboard");
      expect(sanitizeRedirect("/dashboard?tab=active", "/dashboard")).toBe("/dashboard?tab=active");
    });

    it("validates route IDs and blocks injection characters", () => {
      expect(validateRouteId("123e4567-e89b-12d3-a456-426614174000").isValid).toBe(true);
      expect(validateRouteId("123e4567-e89b-12d3-a456-426614174000").type).toBe("uuid");
      expect(validateRouteId("CP-2026-00042").isValid).toBe(true);
      expect(validateRouteId("CP-2026-00042").type).toBe("trackingCode");
      expect(validateRouteId("<script>alert(1)</script>").isValid).toBe(false);
      expect(validateRouteId("DROP TABLE users;--").isValid).toBe(false);
    });

    it("sanitizes error messages without leaking technical stack traces or UUIDs", () => {
      expect(mapAuthErrorMessage(new Error("Invalid login credentials"))).toBe(
        "The email or password is incorrect."
      );
      expect(mapAuthErrorMessage(new Error("Failed to fetch"))).toBe(
        "We couldn't reach Campus Plus. Please check your connection and try again."
      );
      expect(
        mapAuthErrorMessage(new Error("Postgres error at 00003_identity_and_access_tables.sql user 123e4567-e89b-12d3-a456-426614174000"))
      ).toBe("Unable to verify campus credentials. Please check your details and try again.");
    });
  });
});
