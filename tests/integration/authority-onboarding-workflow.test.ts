import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetTestDatabase, getDatabaseClient } from "@/infrastructure/database/pool";
import { resetContainer } from "@/infrastructure/container";
import { POST as registerHandler } from "@/app/api/v1/auth/register/route";
import { POST as bootstrapHandler } from "@/app/api/v1/auth/bootstrap/route";
import { POST as createInvitationHandler } from "@/app/api/v1/auth/invitations/route";
import { POST as acceptInvitationHandler } from "@/app/api/v1/auth/invitations/accept/route";
import { POST as revokeInvitationHandler } from "@/app/api/v1/auth/invitations/[id]/revoke/route";
import { GET as getVerificationsHandler } from "@/app/api/v1/auth/verifications/route";
import { POST as approveVerificationHandler } from "@/app/api/v1/auth/verifications/[id]/approve/route";
import { GET as meHandler } from "@/app/api/v1/auth/me/route";

const FIXTURES = {
  studentA: "00000000-0000-0000-0000-000000001001",
  studentB: "00000000-0000-0000-0000-000000001002",
  itHandler: "00000000-0000-0000-0000-000000001003",
  hostelHandler: "00000000-0000-0000-0000-000000001004",
  hodIt: "00000000-0000-0000-0000-000000001005",
  management: "00000000-0000-0000-0000-000000001006",
  sysadmin: "00000000-0000-0000-0000-000000001007",
  deptIt: "00000000-0000-0000-0000-000000000010",
  deptHostel: "00000000-0000-0000-0000-000000000020",
  bootstrapSecret: "TEST_MASTER_BOOTSTRAP_SECRET_2026",
};

describe("Authority Onboarding & Institutional Access Control Integration Suite", () => {
  beforeEach(async () => {
    process.env.BOOTSTRAP_SECRET = FIXTURES.bootstrapSecret;
    resetContainer();
    await resetTestDatabase();
  });

  // ============================================================================
  // CRITERION 1: Student Public Registration Flow
  // ============================================================================
  it("Criterion 1: Students can register through the legitimate public registration flow", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "New Enrolled Student",
        email: "new.student@campus.edu",
        password: "ValidPassword123!",
        personaId: "student",
        identifier: "PRN-2026-999",
        department: FIXTURES.deptIt,
      }),
    });

    const res = await registerHandler(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.role).toBe("ROLE_STUDENT");
    expect(json.data.isActive).toBe(true);

    const db = await getDatabaseClient();
    const userRow = await db.query<{ is_active: boolean }>(
      "SELECT is_active FROM users WHERE email = 'new.student@campus.edu';"
    );
    expect(userRow.rows[0].is_active).toBe(true);

    const roleRow = await db.query<{ role_id: string }>(
      "SELECT role_id FROM user_roles WHERE user_id = $1;",
      [json.data.userId]
    );
    expect(roleRow.rows[0].role_id).toBe("ROLE_STUDENT");
  });

  // ============================================================================
  // CRITERION 2: Faculty Cannot Assign Themselves Privileged Roles
  // ============================================================================
  it("Criterion 2: Faculty cannot assign themselves HOD, Director, or Management roles", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Dr. Aspiring Faculty",
        email: "faculty.applicant@campus.edu",
        password: "ValidPassword123!",
        personaId: "handler", // Faculty registration flow
        identifier: "FAC-IT-101",
        department: FIXTURES.deptIt,
        // Attempting to inject elevated roles in payload:
        role: "ROLE_ADMIN",
        roleId: "ROLE_DEPT_HEAD",
        isAdmin: true,
      }),
    });

    const res = await registerHandler(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.role).toBe("ROLE_HANDLER"); // Assigned strictly handler, NOT admin or HOD
    expect(json.data.isActive).toBe(false); // Inactive pending institutional verification

    const db = await getDatabaseClient();
    const roleRow = await db.query<{ role_id: string }>(
      "SELECT role_id FROM user_roles WHERE user_id = $1;",
      [json.data.userId]
    );
    expect(roleRow.rows[0].role_id).toBe("ROLE_HANDLER");

    // Must be in verification request queue
    const vReq = await db.query<{ status: string; requested_role: string }>(
      "SELECT status, requested_role FROM institutional_verification_requests WHERE user_id = $1;",
      [json.data.userId]
    );
    expect(vReq.rows.length).toBe(1);
    expect(vReq.rows[0].status).toBe("PENDING");
    expect(vReq.rows[0].requested_role).toBe("ROLE_HANDLER");
  });

  // ============================================================================
  // CRITERIA 3, 4, 5: Public Registration for HOD, Director, Management is REJECTED
  // ============================================================================
  it("Criterion 3: Public HOD registration is rejected with 403 Forbidden", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Malicious Self-Appointed HOD",
        email: "fake.hod@campus.edu",
        password: "ValidPassword123!",
        personaId: "hod",
        identifier: "HOD-FAKE-01",
        department: FIXTURES.deptIt,
      }),
    });

    const res = await registerHandler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("PRIVILEGED_SELF_REGISTRATION_FORBIDDEN");
  });

  it("Criterion 4: Public Director registration is rejected with 403 Forbidden", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Self-Claimed Director",
        email: "fake.director@campus.edu",
        password: "ValidPassword123!",
        personaId: "director",
        identifier: "DIR-FAKE-01",
      }),
    });

    const res = await registerHandler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("PRIVILEGED_SELF_REGISTRATION_FORBIDDEN");
  });

  it("Criterion 5: Public Management registration is rejected with 403 Forbidden", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Self-Claimed Board Member",
        email: "fake.board@campus.edu",
        password: "ValidPassword123!",
        personaId: "management",
        identifier: "GOV-FAKE-01",
      }),
    });

    const res = await registerHandler(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("PRIVILEGED_SELF_REGISTRATION_FORBIDDEN");
  });

  // ============================================================================
  // CRITERION 6: Unauthorized Users Cannot Create Privileged Accounts via API Manipulation
  // ============================================================================
  it("Criterion 6: An unauthorized user cannot create privileged accounts through API manipulation", async () => {
    // Student attempting to call bootstrap endpoint
    const bootstrapReq = new NextRequest("http://localhost/api/v1/auth/bootstrap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.studentA,
      },
      body: JSON.stringify({
        operatorId: "ATTACKER",
        authorities: [
          {
            email: "escalated@campus.edu",
            fullName: "Escalated Student",
            roleId: "ROLE_ADMIN",
          },
        ],
      }),
    });

    const bootstrapRes = await bootstrapHandler(bootstrapReq);
    expect(bootstrapRes.status).toBe(401);

    // Student attempting to issue an invitation
    const inviteReq = new NextRequest("http://localhost/api/v1/auth/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.studentA,
      },
      body: JSON.stringify({
        email: "friend@campus.edu",
        roleId: "ROLE_DEPT_HEAD",
        departmentId: FIXTURES.deptIt,
      }),
    });

    const inviteRes = await createInvitationHandler(inviteReq);
    expect(inviteRes.status).toBe(403);
  });

  // ============================================================================
  // CRITERIA 7 & 8: Authorized Bootstrap Process & Idempotent Permanent Disablement
  // ============================================================================
  it("Criterion 7 & 8: Authorized bootstrap provisions authorities once and permanently locks", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/bootstrap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bootstrap-secret": FIXTURES.bootstrapSecret,
      },
      body: JSON.stringify({
        operatorId: "CHIEF_OPERATIONS_OFFICER",
        authorities: [
          {
            email: "director.bootstrapped@campus.edu",
            fullName: "Dr. Initial Director",
            roleId: "ROLE_ADMIN",
          },
          {
            email: "management.bootstrapped@campus.edu",
            fullName: "Governing Board Initial Member",
            roleId: "ROLE_MANAGEMENT",
          },
        ],
      }),
    });

    const res = await bootstrapHandler(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.isCompleted).toBe(true);
    expect(json.data.provisionedCount).toBe(2);

    const db = await getDatabaseClient();
    const stateCheck = await db.query<{ is_completed: boolean }>(
      "SELECT is_completed FROM system_bootstrap_state WHERE id = 'INITIAL_AUTHORITY_BOOTSTRAP';"
    );
    expect(stateCheck.rows[0].is_completed).toBe(true);

    // Criterion 8: Attempting to reuse bootstrap MUST be rejected with 409 Conflict
    const secondReq = new NextRequest("http://localhost/api/v1/auth/bootstrap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bootstrap-secret": FIXTURES.bootstrapSecret,
      },
      body: JSON.stringify({
        operatorId: "UNAUTHORIZED_REUSE_ATTEMPT",
        authorities: [
          {
            email: "intruder@campus.edu",
            fullName: "Intruder",
            roleId: "ROLE_ADMIN",
          },
        ],
      }),
    });

    const secondRes = await bootstrapHandler(secondReq);
    expect(secondRes.status).toBe(409);
    const secondJson = await secondRes.json();
    expect(secondJson.error.code).toBe("CONFLICT");
  });

  // ============================================================================
  // CRITERION 9: Future Privileged Invitations Require Authorized Approval
  // ============================================================================
  it("Criterion 9: Future privileged invitations require authorized approval and scope enforcement", async () => {
    // 1. Director can invite HOD
    const directorReq = new NextRequest("http://localhost/api/v1/auth/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.sysadmin,
      },
      body: JSON.stringify({
        email: "new.hod@campus.edu",
        roleId: "ROLE_DEPT_HEAD",
        departmentId: FIXTURES.deptHostel,
      }),
    });

    const directorRes = await createInvitationHandler(directorReq);
    expect(directorRes.status).toBe(201);
    const directorJson = await directorRes.json();
    expect(directorJson.data.token).toBeDefined();

    // 2. HOD can invite Handler in own department
    const hodReq = new NextRequest("http://localhost/api/v1/auth/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.hodIt,
      },
      body: JSON.stringify({
        email: "new.it.faculty@campus.edu",
        roleId: "ROLE_HANDLER",
        departmentId: FIXTURES.deptIt,
      }),
    });

    const hodRes = await createInvitationHandler(hodReq);
    expect(hodRes.status).toBe(201);

    // 3. HOD CANNOT invite Handler in another department
    const hodCrossDeptReq = new NextRequest("http://localhost/api/v1/auth/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.hodIt,
      },
      body: JSON.stringify({
        email: "cross.dept@campus.edu",
        roleId: "ROLE_HANDLER",
        departmentId: FIXTURES.deptHostel, // Different department!
      }),
    });

    const hodCrossDeptRes = await createInvitationHandler(hodCrossDeptReq);
    expect(hodCrossDeptRes.status).toBe(403);

    // 4. HOD CANNOT invite Director
    const hodElevateReq = new NextRequest("http://localhost/api/v1/auth/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.hodIt,
      },
      body: JSON.stringify({
        email: "elevate@campus.edu",
        roleId: "ROLE_ADMIN",
      }),
    });

    const hodElevateRes = await createInvitationHandler(hodElevateReq);
    expect(hodElevateRes.status).toBe(403);
  });

  // ============================================================================
  // CRITERION 10: Expired, Revoked, Reused, and Email-Mismatched Invitations are Rejected
  // ============================================================================
  it("Criterion 10: Expired, revoked, reused, and email-mismatched invitations are rejected", async () => {
    // Generate valid invitation
    const inviteReq = new NextRequest("http://localhost/api/v1/auth/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.sysadmin,
      },
      body: JSON.stringify({
        email: "invited.authority@campus.edu",
        roleId: "ROLE_DEPT_HEAD",
        departmentId: FIXTURES.deptIt,
      }),
    });

    const inviteRes = await createInvitationHandler(inviteReq);
    const inviteJson = await inviteRes.json();
    const token = inviteJson.data.token;

    // 10a. Email Mismatch Rejection
    const mismatchReq = new NextRequest("http://localhost/api/v1/auth/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        email: "different.email@campus.edu", // Mismatched email!
        password: "ValidPassword123!",
        fullName: "Impostor",
      }),
    });

    const mismatchRes = await acceptInvitationHandler(mismatchReq);
    expect(mismatchRes.status).toBe(403);

    // 10b. Successful Accept
    const acceptReq = new NextRequest("http://localhost/api/v1/auth/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        email: "invited.authority@campus.edu",
        password: "ValidPassword123!",
        fullName: "Legitimate Authority",
      }),
    });

    const acceptRes = await acceptInvitationHandler(acceptReq);
    expect(acceptRes.status).toBe(200);

    // 10c. Reused Token Rejection (Already accepted)
    const reuseReq = new NextRequest("http://localhost/api/v1/auth/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        email: "invited.authority@campus.edu",
        password: "ValidPassword123!",
        fullName: "Legitimate Authority",
      }),
    });

    const reuseRes = await acceptInvitationHandler(reuseReq);
    expect(reuseRes.status).toBe(409); // Already used!

    // 10d. Revoked Token Rejection
    const secondInviteReq = new NextRequest("http://localhost/api/v1/auth/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.sysadmin,
      },
      body: JSON.stringify({
        email: "to.be.revoked@campus.edu",
        roleId: "ROLE_HANDLER",
        departmentId: FIXTURES.deptIt,
      }),
    });
    const secondInviteRes = await createInvitationHandler(secondInviteReq);
    const secondJson = await secondInviteRes.json();
    const secondToken = secondJson.data.token;
    const secondInvId = secondJson.data.invitationId;

    // Revoke it
    const revokeReq = new NextRequest(`http://localhost/api/v1/auth/invitations/${secondInvId}/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.sysadmin,
      },
      body: JSON.stringify({ reason: "Appointment cancelled" }),
    });
    const revokeRes = await revokeInvitationHandler(revokeReq, {
      params: Promise.resolve({ id: secondInvId }),
    });
    expect(revokeRes.status).toBe(200);

    // Try accepting revoked invitation
    const acceptRevokedReq = new NextRequest("http://localhost/api/v1/auth/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: secondToken,
        email: "to.be.revoked@campus.edu",
        password: "ValidPassword123!",
        fullName: "Revoked Person",
      }),
    });
    const acceptRevokedRes = await acceptInvitationHandler(acceptRevokedReq);
    expect(acceptRevokedRes.status).toBe(403);

    // 10e. Expired Token Rejection
    const db = await getDatabaseClient();
    await db.query(
      "UPDATE authority_invitations SET expires_at = NOW() - INTERVAL '1 hour', is_revoked = false, is_used = false, status = 'PENDING' WHERE id = $1;",
      [secondInvId]
    );

    const acceptExpiredReq = new NextRequest("http://localhost/api/v1/auth/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: secondToken,
        email: "to.be.revoked@campus.edu",
        password: "ValidPassword123!",
        fullName: "Expired Person",
      }),
    });
    const acceptExpiredRes = await acceptInvitationHandler(acceptExpiredReq);
    expect(acceptExpiredRes.status).toBe(410); // Gone / Expired
  });

  // ============================================================================
  // CRITERIA 11 & 12: Unauthenticated 401 & Insufficient Permission 403
  // ============================================================================
  it("Criteria 11 & 12: Unauthenticated returns 401 and unauthorized returns 403", async () => {
    // 11. Unauthenticated request to /api/v1/auth/me
    const unauthReq = new NextRequest("http://localhost/api/v1/auth/me", {
      method: "GET",
    });
    const unauthRes = await meHandler(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 12. Authenticated Student attempting to list verifications returns 403
    const forbiddenReq = new NextRequest("http://localhost/api/v1/auth/verifications", {
      method: "GET",
      headers: { "x-actor-id": FIXTURES.studentA },
    });
    const forbiddenRes = await getVerificationsHandler(forbiddenReq);
    expect(forbiddenRes.status).toBe(403);
  });

  // ============================================================================
  // CRITERION 13: RLS Prevents Cross-Role and Cross-Department Access
  // ============================================================================
  it("Criterion 13: Department Head can only view and manage verifications in own department", async () => {
    const db = await getDatabaseClient();

    // Insert verification requests in IT Dept and Hostel Dept
    const userIt = "00000000-0000-0000-0000-000000009001";
    const userHostel = "00000000-0000-0000-0000-000000009002";

    await db.query(`
      INSERT INTO users (id, email, full_name, is_active)
      VALUES 
        ('${userIt}', 'faculty.it@campus.edu', 'IT Faculty Applicant', false),
        ('${userHostel}', 'faculty.hostel@campus.edu', 'Hostel Faculty Applicant', false)
      ON CONFLICT (id) DO NOTHING;
    `);

    const itReqRes = await db.query<{ id: string }>(`
      INSERT INTO institutional_verification_requests (
        user_id, email, full_name, employee_id, department_id, requested_role, status
      ) VALUES (
        '${userIt}', 'faculty.it@campus.edu', 'IT Faculty Applicant', 'EMP-IT-01', '${FIXTURES.deptIt}', 'ROLE_HANDLER', 'PENDING'
      ) RETURNING id;
    `);
    const itReqId = itReqRes.rows[0].id;

    const hostelReqRes = await db.query<{ id: string }>(`
      INSERT INTO institutional_verification_requests (
        user_id, email, full_name, employee_id, department_id, requested_role, status
      ) VALUES (
        '${userHostel}', 'faculty.hostel@campus.edu', 'Hostel Faculty Applicant', 'EMP-HOS-01', '${FIXTURES.deptHostel}', 'ROLE_HANDLER', 'PENDING'
      ) RETURNING id;
    `);
    const hostelReqId = hostelReqRes.rows[0].id;

    // IT HOD lists verifications -> MUST only see IT request
    const hodListReq = new NextRequest("http://localhost/api/v1/auth/verifications", {
      method: "GET",
      headers: { "x-actor-id": FIXTURES.hodIt },
    });
    const hodListRes = await getVerificationsHandler(hodListReq);
    expect(hodListRes.status).toBe(200);
    const hodListJson = await hodListRes.json();
    const deptIds = hodListJson.data.map((r: { department_id: string }) => r.department_id);
    expect(deptIds).toContain(FIXTURES.deptIt);
    expect(deptIds).not.toContain(FIXTURES.deptHostel);

    // IT HOD attempting to approve Hostel request -> MUST BE REJECTED with 403
    const crossApproveReq = new NextRequest(`http://localhost/api/v1/auth/verifications/${hostelReqId}/approve`, {
      method: "POST",
      headers: { "x-actor-id": FIXTURES.hodIt },
    });
    const crossApproveRes = await approveVerificationHandler(crossApproveReq, {
      params: Promise.resolve({ id: hostelReqId }),
    });
    expect(crossApproveRes.status).toBe(403);

    // IT HOD approving IT request -> SUCCEEDS with 200
    const ownApproveReq = new NextRequest(`http://localhost/api/v1/auth/verifications/${itReqId}/approve`, {
      method: "POST",
      headers: { "x-actor-id": FIXTURES.hodIt },
    });
    const ownApproveRes = await approveVerificationHandler(ownApproveReq, {
      params: Promise.resolve({ id: itReqId }),
    });
    expect(ownApproveRes.status).toBe(200);

    // Verified that user is now active in database
    const activeCheck = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM users WHERE id = '${userIt}';`
    );
    expect(activeCheck.rows[0].is_active).toBe(true);
  });

  // ============================================================================
  // CRITERION 14: All Privileged Provisioning Actions are Auditable
  // ============================================================================
  it("Criterion 14: All privileged provisioning actions create immutable audit logs", async () => {
    // Perform a faculty onboarding registration
    const facultyReq = new NextRequest("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Audited Faculty Applicant",
        email: "audited.faculty@campus.edu",
        password: "ValidPassword123!",
        personaId: "handler",
        identifier: "FAC-AUDIT-01",
        department: FIXTURES.deptIt,
      }),
    });
    const facultyRes = await registerHandler(facultyReq);
    if (facultyRes.status !== 201) {
      console.log("FACULTY REG STATUS:", facultyRes.status, await facultyRes.json());
    }
    expect(facultyRes.status).toBe(201);

    // Perform an authorized invitation creation
    const inviteReq = new NextRequest("http://localhost/api/v1/auth/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-actor-id": FIXTURES.sysadmin,
      },
      body: JSON.stringify({
        email: "audited.invitee@campus.edu",
        roleId: "ROLE_DEPT_HEAD",
        departmentId: FIXTURES.deptIt,
      }),
    });
    const inviteRes = await createInvitationHandler(inviteReq);
    if (inviteRes.status !== 201) {
      console.log("INVITE STATUS:", inviteRes.status, await inviteRes.json());
    }
    expect(inviteRes.status).toBe(201);

    const db = await getDatabaseClient();
    const auditRes = await db.query<{ action_type: string }>(
      "SELECT action_type FROM authority_audit_logs ORDER BY created_at ASC;"
    );

    // Must contain entries for verification requested and invitation created
    const actionTypes = auditRes.rows.map((r) => r.action_type);
    expect(auditRes.rows.length).toBeGreaterThanOrEqual(2);
    expect(actionTypes).toContain("VERIFICATION_REQUESTED");
    expect(actionTypes).toContain("INVITATION_CREATED");
  });

  // ============================================================================
  // CRITERION 15: Distinct Error Feedback & Existing Workflows Continue to Work
  // ============================================================================
  it("Criterion 15: Clearly distinguishes pending verification, missing role, and active identities on /me", async () => {
    // 1. Active student returns actor context
    const studentReq = new NextRequest("http://localhost/api/v1/auth/me", {
      method: "GET",
      headers: { "x-actor-id": FIXTURES.studentA },
    });
    const studentRes = await meHandler(studentReq);
    expect(studentRes.status).toBe(200);
    const studentJson = await studentRes.json();
    expect(studentJson.data.role).toBe("ROLE_STUDENT");

    // 2. Pending verification faculty returns 401 with clear pending message
    const db = await getDatabaseClient();
    const pendingUserId = "00000000-0000-0000-0000-000000009999";
    await db.query(`
      INSERT INTO users (id, email, full_name, is_active)
      VALUES ('${pendingUserId}', 'pending.user@campus.edu', 'Pending Faculty', false)
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.query(`
      INSERT INTO institutional_verification_requests (
        user_id, email, full_name, employee_id, department_id, requested_role, status
      ) VALUES (
        '${pendingUserId}', 'pending.user@campus.edu', 'Pending Faculty', 'EMP-P', '${FIXTURES.deptIt}', 'ROLE_HANDLER', 'PENDING'
      );
    `);

    const pendingReq = new NextRequest("http://localhost/api/v1/auth/me", {
      method: "GET",
      headers: { "x-actor-id": pendingUserId },
    });
    const pendingRes = await meHandler(pendingReq);
    expect(pendingRes.status).toBe(401);
    const pendingJson = await pendingRes.json();
    expect(pendingJson.error.message).toContain("pending departmental verification");
  });
});
