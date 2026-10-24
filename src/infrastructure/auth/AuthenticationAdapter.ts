import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ActorContext, UserRole, UserRoleType } from "@/domain/complaint";
import { AuthenticationError } from "@/shared/errors/AppError";
import { DatabaseQueryInterface } from "../database/migrator";

interface UserLookupRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  role_id: string | null;
  department_id: string | null;
}

/**
 * Server-Side Authentication Adapter.
 * Extracts authenticated identity, verifies active account status,
 * and derives trusted roles and department memberships directly from PostgreSQL.
 * 
 * In production / staging with Supabase Auth:
 * - Verifies Bearer JWT token against Supabase Auth service.
 * - Explicitly checks that auth.users identity maps to a valid public.users record.
 * - Test fixture headers (x-actor-id) and unverified tokens are strictly rejected.
 */
export class AuthenticationAdapter {
  private supabaseClient: SupabaseClient | null = null;

  constructor(
    private readonly db: DatabaseQueryInterface,
    supabaseClient?: SupabaseClient
  ) {
    if (supabaseClient) {
      this.supabaseClient = supabaseClient;
    } else if (
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    ) {
      this.supabaseClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
    }
  }

  public async authenticate(request: Request): Promise<ActorContext> {
    return this.extractActorContext(request);
  }

  public async extractActorContext(request: Request): Promise<ActorContext> {
    let resolvedUserId: string | null = null;
    const isProduction = process.env.NODE_ENV === "production";

    // 1. Non-production test fixture header bypass (STRICTLY FORBIDDEN IN PRODUCTION)
    const testActorHeader = request.headers.get("x-actor-id");

    if (!isProduction && testActorHeader) {
      resolvedUserId = testActorHeader.trim();
    } else {
      // 2. Standard Authorization Bearer Token Header
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7).trim();
        if (!token) {
          throw new AuthenticationError("Authentication token is empty.");
        }

        if (this.supabaseClient) {
          // Real Supabase Auth verification
          const { data, error } = await this.supabaseClient.auth.getUser(token);
          if (error || !data.user) {
            throw new AuthenticationError("Invalid, expired, or malformed authentication token.");
          }
          resolvedUserId = data.user.id;
        } else {
          // Local/offline test fallback: if token matches UUID, use as userId
          // IN PRODUCTION, this fallback is strictly rejected!
          if (isProduction) {
            throw new AuthenticationError("Live authentication provider is not configured in production environment.");
          }
          resolvedUserId = token;
        }
      }
    }

    if (!resolvedUserId) {
      throw new AuthenticationError("Authentication token or session is missing.");
    }

    // 3. Database lookup for active status, roles, and department
    const res = await this.db.query<UserLookupRow>(
      `SELECT 
         u.id, 
         u.email, 
         u.full_name, 
         u.is_active,
         ur.role_id,
         dm.department_id
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN department_memberships dm ON u.id = dm.user_id AND dm.is_active = TRUE
       WHERE u.id = $1
       LIMIT 1;`,
      [resolvedUserId]
    );

    if (res.rows.length === 0) {
      try {
        const vReq = await this.db.query<{ status: string }>(
          `SELECT status FROM institutional_verification_requests WHERE user_id = $1 LIMIT 1;`,
          [resolvedUserId]
        );
        if (vReq.rows.length > 0) {
          if (vReq.rows[0].status === "PENDING") {
            throw new AuthenticationError("Your institutional onboarding request is currently pending departmental verification.");
          }
          if (vReq.rows[0].status === "REJECTED") {
            throw new AuthenticationError("Your institutional verification request was not approved. Please contact your department head.");
          }
        }
      } catch (err) {
        if (err instanceof AuthenticationError) throw err;
        // Table may not exist in minimal mock contexts, continue to standard error
      }
      throw new AuthenticationError("Authenticated identity does not map to any active user record in institution directory.");
    }

    const row = res.rows[0];
    if (!row.is_active) {
      try {
        const vReq = await this.db.query<{ status: string }>(
          `SELECT status FROM institutional_verification_requests WHERE user_id = $1 LIMIT 1;`,
          [resolvedUserId]
        );
        if (vReq.rows.length > 0 && vReq.rows[0].status === "PENDING") {
          throw new AuthenticationError("Your institutional onboarding request is currently pending departmental verification.");
        }
      } catch (err) {
        if (err instanceof AuthenticationError) throw err;
      }
      throw new AuthenticationError("User account is deactivated.");
    }

    if (!row.role_id) {
      throw new AuthenticationError("Your account is active, but no institutional role has been assigned to your profile.");
    }

    const role = row.role_id as UserRoleType;
    const departmentId = row.department_id || undefined;

    return {
      userId: row.id,
      role,
      departmentId,
    };
  }
}
