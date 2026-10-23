import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RegisterPage from "@/app/register/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
  }),
}));

describe("Master Product Experience: Registration & Provisioning ('/register')", () => {
  it("1. renders registration header and return links", () => {
    const html = renderToStaticMarkup(React.createElement(RegisterPage));
    expect(html).contain("Campus Plus");
    expect(html).contain("Account Enrollment &amp; Provisioning");
    expect(html).contain('href="/login"');
  });

  it("2. renders persona tabs for student vs staff provisioning", () => {
    const html = renderToStaticMarkup(React.createElement(RegisterPage));
    expect(html).contain("Student / Complainant");
    expect(html).contain("Faculty / Staff / HOD");
  });

  it("3. renders student self-service intake form fields", () => {
    const html = renderToStaticMarkup(React.createElement(RegisterPage));
    expect(html).contain("Full Official Name");
    expect(html).contain("Student Roll / ID Number");
    expect(html).contain("Institutional Campus Email");
    expect(html).contain("Academic Department");
    expect(html).contain("Password");
    expect(html).contain("Confirm Password");
    expect(html).contain("Create Student Account");
    expect(html).not.contain("Submit Student Enrollment Request");
  });

  it("4. communicates identity governance and RBAC security boundaries", () => {
    const html = renderToStaticMarkup(React.createElement(RegisterPage));
    expect(html).contain("Identity &amp; Access Governance");
    expect(html).contain("Institutional IAM Compliance");
  });
});
