import {
  Complaint,
  ComplaintId,
  TrackingCode,
  ComplaintTitle,
  ComplaintDescription,
  UserId,
  DepartmentId,
  CategoryId,
  LocationId,
  Priority,
  ComplaintStatusType,
  EscalationTierType,
  ComplaintVersion,
  ComplaintAssignment,
  ComplaintForward,
  ComplaintEscalation,
  Resolution,
  StaleVersionConflictError,
} from "@/domain/complaint";
import { ComplaintAttachmentInput, IComplaintRepository } from "@/application/ports/IComplaintRepository";
import { IComplaintQueryRepository } from "@/application/ports/IComplaintQueryRepository";
import { DatabaseQueryInterface } from "./migrator";

interface ComplaintRow {
  id: string;
  ref_id: string;
  title: string;
  description: string;
  complainant_id: string;
  department_id: string;
  category_id: string;
  location_id: string | null;
  location_details: string;
  status: string;
  suggested_priority: string;
  official_priority: string;
  assigned_handler_id: string | null;
  escalation_tier: string;
  is_escalated: boolean;
  version: number;
  sla_due_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AssignmentRow {
  id: string;
  complaint_id: string;
  handler_id: string;
  assigned_by_id: string;
  assigned_at: string;
  unassigned_at: string | null;
  is_current: boolean;
  reason: string | null;
}

interface ForwardRow {
  id: string;
  complaint_id: string;
  from_department_id: string;
  to_department_id: string;
  forwarded_by_id: string;
  forward_sequence: number;
  rationale: string;
  forwarded_at: string;
}

interface EscalationRow {
  id: string;
  complaint_id: string;
  from_tier: string;
  to_tier: string;
  escalated_by_id: string | null;
  is_automated: boolean;
  reason: string;
  escalated_at: string;
}

interface ResolutionRow {
  id: string;
  complaint_id: string;
  resolved_by_id: string;
  resolution_summary: string;
  resolved_at: string;
  student_verified: boolean | null;
  dispute_reason: string | null;
  disputed_at: string | null;
}

export interface ComplaintFilterOptions {
  complainantId?: string;
  departmentId?: string;
  assignedHandlerId?: string;
  status?: string;
  priority?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ComplaintSummaryRow {
  id: string;
  ref_id: string;
  title: string;
  category_id: string;
  category_name?: string;
  department_id: string;
  department_name?: string;
  status: string;
  official_priority: string;
  assigned_handler_id?: string | null;
  created_at: string;
  updated_at: string;
  sla_due_at?: string | null;
}

export interface TimelineEventRow {
  id: string;
  complaint_id: string;
  actor_id: string | null;
  actor_role: string;
  action_type: string;
  from_status: string | null;
  to_status: string | null;
  remarks: string | null;
  created_at: string;
}

/**
 * PostgreSQL Implementation of IComplaintRepository.
 * Manages atomic persistence, Optimistic Concurrency Control,
 * transactional audit logging (action_history), and transactional outbox event publishing.
 */
export class PostgresComplaintRepository implements IComplaintRepository, IComplaintQueryRepository {
  constructor(
    private readonly db: DatabaseQueryInterface,
    private readonly transactionRunner?: <T>(callback: (tx: DatabaseQueryInterface) => Promise<T>) => Promise<T>
  ) {}

  public async findById(id: ComplaintId): Promise<Complaint | null> {
    const res = await this.db.query<ComplaintRow>(
      "SELECT * FROM complaints WHERE id = $1 LIMIT 1;",
      [id.toString()]
    );
    if (res.rows.length === 0) return null;
    return await this.rehydrateComplaint(res.rows[0]);
  }

  public async findByTrackingCode(code: TrackingCode): Promise<Complaint | null> {
    const res = await this.db.query<ComplaintRow>(
      "SELECT * FROM complaints WHERE ref_id = $1 LIMIT 1;",
      [code.toString()]
    );
    if (res.rows.length === 0) return null;
    return await this.rehydrateComplaint(res.rows[0]);
  }

  public async save(
    complaint: Complaint,
    expectedVersion?: number,
    attachments: ComplaintAttachmentInput[] = []
  ): Promise<void> {
    if (this.transactionRunner) {
      await this.transactionRunner(async (tx) => {
        await new PostgresComplaintRepository(tx).persist(complaint, expectedVersion, attachments);
      });
      return;
    }

    await this.persist(complaint, expectedVersion, attachments);
  }

  private async persist(
    complaint: Complaint,
    expectedVersion?: number,
    attachments: ComplaintAttachmentInput[] = []
  ): Promise<void> {
    const complaintId = complaint.id.toString();

    // 1. Check existing record for OCC verification
    const existingRes = await this.db.query<{ version: number }>(
      "SELECT version FROM complaints WHERE id = $1;",
      [complaintId]
    );

    const isNew = existingRes.rows.length === 0;

    if (attachments.length > 0 && !isNew) {
      throw new Error("Initial complaint evidence can only be attached during complaint creation.");
    }

    if (!isNew && expectedVersion !== undefined) {
      const currentDbVersion = existingRes.rows[0].version;
      if (currentDbVersion !== expectedVersion) {
        throw new StaleVersionConflictError(currentDbVersion, expectedVersion);
      }
    }

    if (isNew) {
      // 2. Insert new complaint
      await this.db.query(
        `INSERT INTO complaints (
          id, ref_id, title, description, complainant_id, department_id, category_id,
          location_details, location_id, status, suggested_priority, official_priority,
          assigned_handler_id, escalation_tier, is_escalated, version, sla_due_at,
          resolved_at, closed_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21
        );`,
        [
          complaint.id.toString(),
          complaint.refId.toString(),
          complaint.title.toString(),
          complaint.description.toString(),
          complaint.complainantId.toString(),
          complaint.departmentId.toString(),
          complaint.categoryId.toString(),
          complaint.locationDetails,
          complaint.locationId?.toString() ?? null,
          complaint.status,
          complaint.suggestedPriority.toString(),
          complaint.officialPriority.toString(),
          complaint.assignedHandlerId?.toString() ?? null,
          complaint.escalationTier,
          complaint.isEscalated,
          complaint.version.toNumber(),
          complaint.slaDueAt ?? null,
          complaint.resolvedAt ?? null,
          complaint.closedAt ?? null,
          complaint.createdAt,
          complaint.updatedAt,
        ]
      );
      for (const attachment of attachments) {
        await this.db.query(
          `INSERT INTO attachments (
            complaint_id, storage_key, original_filename, mime_type, file_size_bytes,
            attachment_type, uploaded_by_id
          ) VALUES ($1, $2, $3, $4, $5, 'INITIAL_EVIDENCE', $6);`,
          [
            complaintId,
            attachment.fileKey,
            attachment.originalFilename,
            attachment.mimeType,
            attachment.fileSizeBytes,
            complaint.complainantId.toString(),
          ]
        );
      }
    } else {
      // 3. Update existing complaint with version check
      await this.db.query(
        `UPDATE complaints SET
          title = $2,
          description = $3,
          department_id = $4,
          category_id = $5,
          location_details = $6,
          location_id = $7,
          status = $8,
          suggested_priority = $9,
          official_priority = $10,
          assigned_handler_id = $11,
          escalation_tier = $12,
          is_escalated = $13,
          version = $14,
          sla_due_at = $15,
          resolved_at = $16,
          closed_at = $17,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1;`,
        [
          complaintId,
          complaint.title.toString(),
          complaint.description.toString(),
          complaint.departmentId.toString(),
          complaint.categoryId.toString(),
          complaint.locationDetails,
          complaint.locationId?.toString() ?? null,
          complaint.status,
          complaint.suggestedPriority.toString(),
          complaint.officialPriority.toString(),
          complaint.assignedHandlerId?.toString() ?? null,
          complaint.escalationTier,
          complaint.isEscalated,
          complaint.version.toNumber(),
          complaint.slaDueAt ?? null,
          complaint.resolvedAt ?? null,
          complaint.closedAt ?? null,
        ]
      );
    }

    // 4. Synchronize Assignments
    for (const assignment of complaint.assignments) {
      await this.db.query(
        `INSERT INTO complaint_assignments (
          id, complaint_id, handler_id, assigned_by_id, assigned_at, unassigned_at, is_current, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET 
          is_current = EXCLUDED.is_current,
          unassigned_at = EXCLUDED.unassigned_at;`,
        [
          assignment.id,
          complaintId,
          assignment.handlerId,
          assignment.assignedById,
          assignment.assignedAt,
          assignment.unassignedAt ?? null,
          assignment.isCurrent,
          assignment.reason ?? null,
        ]
      );
    }

    // 5. Synchronize Forwards
    for (const forward of complaint.forwards) {
      await this.db.query(
        `INSERT INTO complaint_forwards (
          id, complaint_id, from_department_id, to_department_id, forwarded_by_id,
          forward_sequence, rationale, forwarded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING;`,
        [
          forward.id,
          complaintId,
          forward.fromDepartmentId,
          forward.toDepartmentId,
          forward.forwardedById,
          forward.forwardSequence,
          forward.rationale,
          forward.forwardedAt,
        ]
      );
    }

    // 6. Synchronize Escalations
    for (const escalation of complaint.escalations) {
      await this.db.query(
        `INSERT INTO complaint_escalations (
          id, complaint_id, from_tier, to_tier, escalated_by_id, is_automated, reason, escalated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING;`,
        [
          escalation.id,
          complaintId,
          escalation.fromTier,
          escalation.toTier,
          escalation.escalatedById ?? null,
          escalation.isAutomated,
          escalation.reason,
          escalation.escalatedAt,
        ]
      );
    }

    // 7. Synchronize Resolution
    if (complaint.resolution) {
      const res = complaint.resolution;
      await this.db.query(
        `INSERT INTO resolutions (
          id, complaint_id, resolved_by_id, resolution_summary, resolved_at,
          student_verified, dispute_reason, disputed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (complaint_id) DO UPDATE SET
          student_verified = EXCLUDED.student_verified,
          dispute_reason = EXCLUDED.dispute_reason,
          disputed_at = EXCLUDED.disputed_at;`,
        [
          res.id,
          complaintId,
          res.resolvedById,
          res.summary,
          res.resolvedAt,
          res.studentVerified ?? null,
          res.disputeReason ?? null,
          res.disputedAt ?? null,
        ]
      );
    }

    // 8. Commit Domain Events into Audit Log (action_history) and Transactional Outbox (outbox_events)
    const events = complaint.getUncommittedEvents();
    for (const evt of events) {
      // 8a. Audit journal entry
      const payload = evt.payload as Record<string, unknown>;
      const actorId = (payload.actorId as string) || (payload.complainantId as string) || (payload.resolvedById as string) || null;
      const remarks = (payload.remarks as string) || (payload.reason as string) || (payload.summary as string) || null;
      const fromStatus = (payload.previousStatus as string) || null;
      const toStatus = (payload.newStatus as string) || (complaint.status as string);

      await this.db.query(
        `INSERT INTO action_history (
          complaint_id, actor_id, actor_role, action_type, from_status, to_status, remarks, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9);`,
        [
          complaintId,
          actorId,
          "SYSTEM_OR_ACTOR",
          evt.eventType,
          fromStatus,
          toStatus,
          remarks,
          JSON.stringify(payload),
          evt.occurredAt,
        ]
      );

      // 8b. Transactional outbox entry
      await this.db.query(
        `INSERT INTO outbox_events (
          id, event_type, aggregate_type, aggregate_id, payload, status, retry_count, created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, 'PENDING', 0, $6);`,
        [
          evt.eventId,
          evt.eventType,
          "Complaint",
          complaintId,
          JSON.stringify(payload),
          evt.occurredAt,
        ]
      );
    }

    // 9. Clear uncommitted events
    complaint.clearEvents();
  }

  // --- Read Query Projections ---

  public async findMany(filters: ComplaintFilterOptions): Promise<PaginatedResult<ComplaintSummaryRow>> {
    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filters.complainantId) {
      conditions.push(`c.complainant_id = $${paramIdx++}`);
      params.push(filters.complainantId);
    }

    if (filters.departmentId) {
      conditions.push(`c.department_id = $${paramIdx++}`);
      params.push(filters.departmentId);
    }

    if (filters.assignedHandlerId) {
      conditions.push(`c.assigned_handler_id = $${paramIdx++}`);
      params.push(filters.assignedHandlerId);
    }

    if (filters.status) {
      conditions.push(`c.status = $${paramIdx++}`);
      params.push(filters.status);
    }

    if (filters.priority) {
      conditions.push(`c.official_priority = $${paramIdx++}`);
      params.push(filters.priority);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count Query
    const countRes = await this.db.query<{ count: string }>(
      `SELECT count(*) as count FROM complaints c ${whereClause};`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count ?? "0", 10);

    // Items Query with joins for human-friendly names
    const itemsQuery = `
      SELECT 
        c.id, c.ref_id, c.title, c.category_id, cat.name as category_name,
        c.department_id, d.name as department_name, c.status, c.official_priority,
        c.assigned_handler_id, c.created_at, c.updated_at, c.sla_due_at
      FROM complaints c
      JOIN departments d ON c.department_id = d.id
      JOIN categories cat ON c.category_id = cat.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++};
    `;

    params.push(limit, offset);
    const itemsRes = await this.db.query<ComplaintSummaryRow>(itemsQuery, params);

    return {
      items: itemsRes.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  public async getTimeline(complaintId: string, isStaff: boolean): Promise<TimelineEventRow[]> {
    const res = await this.db.query<TimelineEventRow>(
      `SELECT id, complaint_id, actor_id, actor_role, action_type, from_status, to_status, remarks, created_at
       FROM action_history
       WHERE complaint_id = $1
       ORDER BY created_at ASC;`,
      [complaintId]
    );

    if (isStaff) {
      return res.rows;
    }

    // Student projection: filter out internal remarks and private administrative metadata (INV-012)
    return res.rows.map((row) => ({
      ...row,
      remarks: row.actor_role === "ROLE_STUDENT" ? row.remarks : (row.remarks?.slice(0, 100) ?? null),
    }));
  }

  // --- Private Rehydration Helpers ---

  private async rehydrateComplaint(row: ComplaintRow): Promise<Complaint> {
    const complaintId = row.id;

    // Load assignments
    const assignRes = await this.db.query<AssignmentRow>(
      "SELECT * FROM complaint_assignments WHERE complaint_id = $1 ORDER BY assigned_at ASC;",
      [complaintId]
    );
    const assignments = assignRes.rows.map(
      (a) =>
        new ComplaintAssignment(
          {
            handlerId: a.handler_id,
            assignedById: a.assigned_by_id,
            assignedAt: a.assigned_at,
            unassignedAt: a.unassigned_at ?? undefined,
            isCurrent: a.is_current,
            reason: a.reason ?? undefined,
          },
          a.id
        )
    );

    // Load forwards
    const forwardRes = await this.db.query<ForwardRow>(
      "SELECT * FROM complaint_forwards WHERE complaint_id = $1 ORDER BY forward_sequence ASC;",
      [complaintId]
    );
    const forwards = forwardRes.rows.map(
      (f) =>
        new ComplaintForward(
          {
            fromDepartmentId: f.from_department_id,
            toDepartmentId: f.to_department_id,
            forwardedById: f.forwarded_by_id,
            forwardSequence: f.forward_sequence,
            rationale: f.rationale,
            forwardedAt: f.forwarded_at,
          },
          f.id
        )
    );

    // Load escalations
    const escRes = await this.db.query<EscalationRow>(
      "SELECT * FROM complaint_escalations WHERE complaint_id = $1 ORDER BY escalated_at ASC;",
      [complaintId]
    );
    const escalations = escRes.rows.map(
      (e) =>
        new ComplaintEscalation(
          {
            fromTier: e.from_tier as EscalationTierType,
            toTier: e.to_tier as EscalationTierType,
            escalatedById: e.escalated_by_id ?? undefined,
            isAutomated: e.is_automated,
            reason: e.reason,
            escalatedAt: e.escalated_at,
          },
          e.id
        )
    );

    // Load resolution if any
    let resolution: Resolution | undefined;
    const resRes = await this.db.query<ResolutionRow>(
      "SELECT * FROM resolutions WHERE complaint_id = $1 LIMIT 1;",
      [complaintId]
    );
    if (resRes.rows.length > 0) {
      const r = resRes.rows[0];
      resolution = new Resolution(
        {
          resolvedById: r.resolved_by_id,
          summary: r.resolution_summary,
          resolvedAt: r.resolved_at,
          studentVerified: r.student_verified ?? undefined,
          disputeReason: r.dispute_reason ?? undefined,
          disputedAt: r.disputed_at ?? undefined,
        },
        r.id
      );
    }

    return new Complaint(
      new ComplaintId(row.id),
      new TrackingCode(row.ref_id),
      new ComplaintTitle(row.title),
      new ComplaintDescription(row.description),
      new UserId(row.complainant_id),
      new DepartmentId(row.department_id),
      new CategoryId(row.category_id),
      row.location_details,
      row.location_id ? new LocationId(row.location_id) : undefined,
      row.status as ComplaintStatusType,
      new Priority(row.suggested_priority),
      new Priority(row.official_priority),
      row.assigned_handler_id ? new UserId(row.assigned_handler_id) : undefined,
      row.escalation_tier as EscalationTierType,
      row.is_escalated,
      new ComplaintVersion(row.version),
      row.sla_due_at ?? undefined,
      row.resolved_at ?? undefined,
      row.closed_at ?? undefined,
      row.created_at,
      row.updated_at,
      assignments,
      forwards,
      escalations,
      resolution
    );
  }
}
