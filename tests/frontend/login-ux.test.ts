import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";

// Component under test
import LoginPage from "@/app/login/page";
import { LoginForm } from "@/presentation/components/auth/LoginForm";
import { mapAuthErrorMessage } from "@/presentation/components/auth/SignInForm";

// Security utility
import { sanitizeRedirect } from "@/presentation/utils/security";

// Mock next/navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
}));

// Mock AuthContext
let mockAuthState = "UNAUTHENTICATED";
let mockAuthError: string | null = null;
const mockSignIn = vi.fn();

vi.mock("@/presentation/context/AuthContext", () => ({
  useAuth: () => ({
    authState: mockAuthState,
    user: null,
    actor: null,
    role: null,
    departmentId: null,
    isAuthenticated: mockAuthState === "AUTHENTICATED",
    isLoading: mockAuthState === "INITIALIZING",
    error: mockAuthError,
    signIn: mockSignIn,
    signOut: vi.fn(),
    refreshActor: vi.fn(),
  }),
}));

describe("Phase 08-C-D: Login Experience UX Quality & Security Verification Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = "UNAUTHENTICATED";
    mockAuthError = null;
    mockSearchParams = new URLSearchParams();
  });

  // ==========================================================================
  // 1. CREDENTIAL PURITY & ZERO HARDCODED ACCOUNTS
  // ==========================================================================
  describe("1. Credential Purity & Zero Hardcoded Accounts", () => {
    it("source file initializes state strictly empty", () => {
      const sourcePath = path.resolve(process.cwd(), "src/presentation/components/auth/SignInForm.tsx");
      const sourceCode = fs.readFileSync(sourcePath, "utf-8");
      const routeCode = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/login/page.tsx"),
        "utf-8",
      );

      // Verify strict empty useState initialization
      expect(sourceCode).toContain('const [email, setEmail] = useState("");');
      expect(sourceCode).toContain('const [password, setPassword] = useState("");');

      // Verify zero occurrences of reported autofill email or demo accounts
      expect(sourceCode).not.toContain("rajesh21");
      expect(sourceCode).not.toContain("rajesh");
      expect(sourceCode).not.toContain("@gmail.com");
      expect(sourceCode).not.toContain("password123");
      expect(sourceCode).not.toContain("demo@");
      expect(routeCode).not.toContain("rajesh21");
      expect(routeCode).not.toContain("password123");
    });

    it("rendered login markup contains empty input values by default", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      // Value attributes in input elements must be empty
      expect(markup).toContain('id="campus-email"');
      expect(markup).toContain('value=""');
      expect(markup).not.toContain("rajesh21@gmail.com");
      expect(markup).not.toContain("test@");
    });

    it("does not embed demo credentials or test accounts anywhere in the rendered HTML", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginPage));

      expect(markup).not.toContain("rajesh21@gmail.com");
      expect(markup).not.toContain("demo");
      expect(markup).not.toContain("password123");
      expect(markup).not.toContain("secret");
    });
  });

  // ==========================================================================
  // 2. ERROR MESSAGE MAPPING & ANTI-ENUMERATION (SEC-002, PRIV-001)
  // ==========================================================================
  describe("2. Error Microcopy & Safe Granular Classification", () => {
    it("maps 'Invalid login credentials' to calm institutional microcopy", () => {
      const result = mapAuthErrorMessage(new Error("Invalid login credentials"));
      expect(result).toBe("The email or password is incorrect.");
    });

    it("maps 'Email not confirmed' to verification guidance", () => {
      const result = mapAuthErrorMessage(new Error("Email not confirmed"));
      expect(result).toBe("Please verify your institutional email before signing in.");
    });

    it("maps 'User not found' safely to generic credential mismatch", () => {
      const result = mapAuthErrorMessage(new Error("User not found"));
      expect(result).toBe("The email or password is incorrect.");
    });

    it("maps deactivated or disabled accounts to inactivity notice", () => {
      const result = mapAuthErrorMessage(new Error("User account is deactivated"));
      expect(result).toBe("This account is currently inactive. Please contact your institution.");
    });

    it("maps unprovisioned identity to institutional provisioning notice", () => {
      const result = mapAuthErrorMessage(
        new Error("Authenticated identity does not map to any active user record in institution directory.")
      );
      expect(result).toBe("Your account exists, but institutional access has not yet been provisioned.");
    });

    it("maps network or timeout failures to connection guidance", () => {
      const result1 = mapAuthErrorMessage(new Error("Network connection failed"));
      expect(result1).toBe("We couldn't reach Campus Plus. Please check your connection and try again.");

      const result2 = mapAuthErrorMessage(new Error("Failed to fetch"));
      expect(result2).toBe("We couldn't reach Campus Plus. Please check your connection and try again.");
    });

    it("maps server failure to institutional retry message", () => {
      const result = mapAuthErrorMessage(new Error("Internal Server Error 500"));
      expect(result).toBe("Campus Plus could not complete authentication right now. Please try again.");
    });

    it("handles unknown or non-Error types safely with fallback", () => {
      const result = mapAuthErrorMessage("Unexpected string error");
      expect(result).toBe("Unable to verify campus credentials. Please check your details and try again.");
    });
  });

  // ==========================================================================
  // 3. INSTITUTIONAL BRANDING, COPY & VIEWPORT BALANCING
  // ==========================================================================
  describe("3. Institutional Branding & Viewport Balancing", () => {
    it("renders authoritative institutional title and system subtitle", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      expect(markup).toContain("Campus Plus");
      expect(markup).toContain("Campus Complaint &amp; Grievance Resolution System");
      expect(markup).toContain("Official Grievance Resolution Portal");
    });

    it("renders institutional governance guarantees and charter", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      expect(markup).toContain("Campus Grievance Portal");
      expect(markup).toContain("Accountable Campus Grievance Resolution");
      expect(markup).toContain("Role-Scoped Privacy");
      expect(markup).toContain("Verifiable Closure");
    });

    it("renders security boundary and authorized access advisory", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      expect(markup).toContain("Authorized Campus Access Only.");
      expect(markup).toContain("All lifecycle actions are immutably logged for audit integrity.");
    });

    it("provides IT helpdesk assistance information in the card footer", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      expect(markup).toContain("Having trouble signing in?");
      expect(markup).toContain("Contact your institutional IT department or grievance coordinator");
    });

    it("preserves locked role tokens and institutional color variables", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      // Must utilize CSS variables from Phase 08-C design tokens
      expect(markup).toContain("var(--role-primary,#7FA8D9)");
      expect(markup).toContain("var(--role-btn-text,#1E3A5F)");
    });
  });

  // ==========================================================================
  // 4. ACCESSIBILITY & FORM SEMANTICS (WCAG 2.1 AA)
  // ==========================================================================
  describe("4. Accessibility & Form Semantics (WCAG 2.1 AA)", () => {
    it("renders semantic form with noValidate to allow accessible custom validation", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));
      expect(markup).toContain("<form");
      expect(markup.toLowerCase()).toContain("novalidate");
    });

    it("properly associates input labels with input IDs via htmlFor", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      expect(markup).toContain('for="campus-email"');
      expect(markup).toContain('id="campus-email"');
      expect(markup).toContain('for="campus-password"');
      expect(markup).toContain('id="campus-password"');
    });

    it("sets appropriate autocomplete attributes for password management", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));
      expect(markup.toLowerCase()).toContain('autocomplete="email"');
      expect(markup.toLowerCase()).toContain('autocomplete="current-password"');
    });

    it("provides accessible password toggle button with aria-label", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      expect(markup).toContain('aria-label="Show password"');
      expect(markup).toContain('type="button"');
    });

    it("uses generic, institutional placeholder and helper text", () => {
      const markup = renderToStaticMarkup(React.createElement(LoginForm));

      expect(markup).toContain('placeholder="username@institution.edu"');
      expect(markup).toContain("Use your registered academic or administrative email address.");
      // Must not invent arbitrary college names or gmail
      expect(markup).not.toContain("@college.edu");
      expect(markup).not.toContain("@rcpit.ac.in");
    });
  });

  // ==========================================================================
  // 5. REDIRECTION & OPEN REDIRECT DEFENSE
  // ==========================================================================
  describe("5. Redirection & Open Redirect Defense", () => {
    it("sanitizes redirect parameter through security utility", () => {
      expect(sanitizeRedirect("/dashboard", "/dashboard")).toBe("/dashboard");
      expect(sanitizeRedirect("/complaints/c-uuid-1", "/dashboard")).toBe("/complaints/c-uuid-1");
      expect(sanitizeRedirect("https://evil.com", "/dashboard")).toBe("/dashboard");
      expect(sanitizeRedirect("//attacker.com", "/dashboard")).toBe("/dashboard");
    });
  });
});
