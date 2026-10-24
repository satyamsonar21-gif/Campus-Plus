import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import crypto from "node:crypto";
import { getDatabaseClient } from "@/infrastructure/database/pool";
import { handleApiError } from "@/presentation/utils/errorHandler";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import {
  InvitationAlreadyUsedError,
  InvitationEmailMismatchError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
} from "@/domain/authority/AuthorityErrors";

export const dynamic = "force-dynamic";

const AcceptInvitationSchema = z.object({
  token: z.string().min(10),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(2).max(100),
  identifier: z.string().max(50).optional(),
});

interface InvitationRow {
  id: string;
  email: string;
  role_id: string;
  department_id: string | null;
  status: string;
  is_used: boolean;
  is_revoked: boolean;
  expires_at: string;
}

/**
 * POST /api/v1/auth/invitations/accept
 *
 * Accepts a privileged invitation token, verifies identity and email match,
 * provisions the user in Supabase Auth and PostgreSQL, and burns the token.
 *
 * VALIDATION BOUNDARIES:
 * - Reject missing or unrecognized tokens with 404.
 * - Reject revoked tokens with 403.
 * - Reject reused tokens with 409.
 * - Reject expired tokens with 410.
 * - Reject email mismatches with 403.
 * - Audit acceptance immutably.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const validated = AcceptInvitationSchema.parse(body);

    const db = await getDatabaseClient();

    // 1. Hash the incoming token and look up the invitation
    const tokenHash = crypto.createHash("sha256").update(validated.token.trim()).digest("hex");

    const invRes = await db.query<InvitationRow>(
      `SELECT id, email, role_id, department_id, status, is_used, is_revoked, expires_at
       FROM authority_invitations
       WHERE token_hash = $1
       LIMIT 1;`,
      [tokenHash]
    );

    if (invRes.rows.length === 0) {
      throw new InvitationNotFoundError("Invitation token was not found or is invalid.");
    }

    const invitation = invRes.rows[0];

    // 2. Enforce Lifecycle Invariants
    if (invitation.is_revoked || invitation.status === "REVOKED") {
      throw new InvitationRevokedError("This invitation has been revoked by institutional administration.");
    }

    if (invitation.is_used || invitation.status === "ACCEPTED") {
      throw new InvitationAlreadyUsedError("This invitation token has already been accepted and cannot be reused.");
    }

    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      throw new InvitationExpiredError("This invitation token has expired. Please contact your institution for a new invitation.");
    }

    if (invitation.email.toLowerCase() !== validated.email.trim().toLowerCase()) {
      throw new InvitationEmailMismatchError("The invitation token is bound to a different email address.");
    }

    // 3. Provision Supabase Auth identity
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let userId: string;
    let adminClient: ReturnType<typeof createClient> | null = null;

    if (supabaseUrl && serviceRoleKey) {
      adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
        email: validated.email,
        password: validated.password,
        email_confirm: true,
        user_metadata: {
          full_name: validated.fullName,
          role_id: invitation.role_id,
          invitation_id: invitation.id,
        },
      });

      if (createError) {
        // If user already exists in auth.users, update password
        const { data: listData } = await adminClient.auth.admin.listUsers();
        const existing = listData?.users.find((u) => u.email?.toLowerCase() === validated.email.toLowerCase());
        if (!existing) {
          throw new Error(`Failed to activate account in auth directory: ${createError.message}`);
        }
        userId = existing.id;
        await adminClient.auth.admin.updateUserById(userId, {
          password: validated.password,
          email_confirm: true,
        });
      } else {
        userId = createData.user.id;
      }
    } else {
      userId = crypto.randomUUID();
    }

    // 4. Upsert public.users profile and assign role
    await db.query(
      `INSERT INTO users (id, email, full_name, roll_or_prn, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         full_name = EXCLUDED.full_name,
         roll_or_prn = COALESCE(EXCLUDED.roll_or_prn, users.roll_or_prn),
         is_active = TRUE,
         updated_at = NOW();`,
      [userId, validated.email, validated.fullName, validated.identifier || null]
    );

    // Assign the authorized role from the invitation (client cannot alter this)
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, role_id) DO NOTHING;`,
      [userId, invitation.role_id]
    );

    // Assign department membership if applicable
    if (invitation.department_id) {
      const isHead = invitation.role_id === "ROLE_DEPT_HEAD";
      await db.query(
        `INSERT INTO department_memberships (user_id, department_id, is_head, is_active, joined_at)
         VALUES ($1, $2, $3, TRUE, NOW())
         ON CONFLICT (user_id, department_id, is_active) DO UPDATE SET
           is_head = EXCLUDED.is_head;`,
        [userId, invitation.department_id, isHead]
      );
    }

    // 5. Burn the invitation token
    await db.query(
      `UPDATE authority_invitations
       SET is_used = TRUE,
           status = 'ACCEPTED',
           used_at = NOW(),
           used_by_user_id = $1
       WHERE id = $2;`,
      [userId, invitation.id]
    );

    // 6. Record immutable audit entry
    await db.query(
      `INSERT INTO authority_audit_logs (
         action_type, actor_id, actor_role, target_user_id, target_email, target_role, target_department_id, metadata
       ) VALUES (
         'INVITATION_ACCEPTED', $1, $2, $1, $3, $2, $4,
         jsonb_build_object('invitation_id', $5::text)
       );`,
      [
        userId,
        invitation.role_id,
        validated.email,
        invitation.department_id || null,
        invitation.id,
      ]
    );

    return createSuccessResponse(
      {
        userId,
        email: validated.email,
        role: invitation.role_id,
        departmentId: invitation.department_id,
        message: "Invitation successfully accepted. Your institutional account is active and you may now sign in.",
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
