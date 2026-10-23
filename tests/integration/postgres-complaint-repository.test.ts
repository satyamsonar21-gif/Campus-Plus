import { describe, it, expect, beforeEach } from "vitest";
import { resetTestDatabase, getDatabaseClient, executeTransaction } from "@/infrastructure/database/pool";
import { PostgresComplaintRepository } from "@/infrastructure/database/PostgresComplaintRepository";
import {
  Complaint,
  UserId,
  ActorContext,
  UserRole,
  ResolutionSummary,
} from "@/domain/complaint";

const FIXTURES = {
  studentA: "00000000-0000-0000-0000-000000001001",
  itHandler: "00000000-0000-0000-0000-000000001003",
  hodIt: "00000000-0000-0000-0000-000000001005",
  deptIt: "00000000-0000-0000-0000-000000000010",
  categoryWifi: "00000000-0000-0000-0000-000000000101",
};

describe("Phase 06 PostgresComplaintRepository Transactional Persistence Suite", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("persists aggregate, child entities, audit logs, and outbox events atomically", async () => {
    const db = await getDatabaseClient();
    const repo = new PostgresComplaintRepository(db, executeTransaction);

    const complaintResult = Complaint.create({
      refId: "CP-2026-09999",
      title: "Core Aggregation Switch Link Down in Rack 4",
      description: "Fiber patch connection severed during cabling maintenance operations.",
      complainantId: FIXTURES.studentA,
      departmentId: FIXTURES.deptIt,
      categoryId: FIXTURES.categoryWifi,
      locationDetails: "Data Center Room 1",
    });

    expect(complaintResult.isSuccess).toBe(true);
    if (complaintResult.isFailure) throw new Error("Creation failed");
    const complaint = complaintResult.value;

    // 1. Initial Save
    await repo.save(complaint, undefined, [{
      fileKey: `complaints/temp/${FIXTURES.studentA}/evidence.png`,
      originalFilename: "evidence.png",
      mimeType: "image/png",
      fileSizeBytes: 4096,
    }]);

    // Verify aggregate row exists
    const dbComplaint = await repo.findById(complaint.id);
    expect(dbComplaint).not.toBeNull();
    expect(dbComplaint?.title.toString()).toBe("Core Aggregation Switch Link Down in Rack 4");
    expect(dbComplaint?.status).toBe("SUBMITTED");

    // Verify transactional audit log in action_history
    const auditRes = await db.query<{ action_type: string }>(
      "SELECT action_type FROM action_history WHERE complaint_id = $1;",
      [complaint.id.toString()]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
    expect(auditRes.rows[0].action_type).toBe("COMPLAINT_SUBMITTED");

    // Verify transactional outbox event in outbox_events
    const outboxRes = await db.query<{ event_type: string; status: string }>(
      "SELECT event_type, status FROM outbox_events WHERE aggregate_id = $1;",
      [complaint.id.toString()]
    );
    expect(outboxRes.rows.length).toBeGreaterThan(0);
    expect(outboxRes.rows[0].event_type).toBe("COMPLAINT_SUBMITTED");
    expect(outboxRes.rows[0].status).toBe("PENDING");

    const attachmentRes = await db.query<{ storage_key: string; uploaded_by_id: string }>(
      "SELECT storage_key, uploaded_by_id FROM attachments WHERE complaint_id = $1;",
      [complaint.id.toString()]
    );
    expect(attachmentRes.rows).toEqual([{
      storage_key: `complaints/temp/${FIXTURES.studentA}/evidence.png`,
      uploaded_by_id: FIXTURES.studentA,
    }]);

    // 2. Perform state transition: Review -> Assign -> Resolve
    const hodActor: ActorContext = {
      userId: FIXTURES.hodIt,
      role: UserRole.ROLE_DEPT_HEAD,
      departmentId: FIXTURES.deptIt,
    };
    complaint.review(hodActor);

    const assignRes = complaint.assignHandler(new UserId(FIXTURES.itHandler), hodActor, "Immediate network repair");
    expect(assignRes.isSuccess).toBe(true);

    const handlerActor: ActorContext = {
      userId: FIXTURES.itHandler,
      role: UserRole.ROLE_HANDLER,
      departmentId: FIXTURES.deptIt,
    };
    complaint.startProgress(handlerActor);

    const resolveRes = complaint.resolve(
      handlerActor,
      new ResolutionSummary("Replaced optical LC-LC jumper cable and verified link light operational.")
    );
    expect(resolveRes.isSuccess).toBe(true);

    // Save updated aggregate
    await repo.save(complaint, 1);

    // Rehydrate and verify all child entities
    const rehydrated = await repo.findById(complaint.id);
    expect(rehydrated).not.toBeNull();
    expect(rehydrated?.status).toBe("RESOLVED");
    expect(rehydrated?.version.toNumber()).toBe(5);
    expect(rehydrated?.assignments.length).toBe(1);
    expect(rehydrated?.assignments[0].handlerId).toBe(FIXTURES.itHandler);
    expect(rehydrated?.resolution).toBeDefined();
    expect(rehydrated?.resolution?.resolvedById).toBe(FIXTURES.itHandler);

    // Verify audit logs accumulated
    const finalAuditRes = await db.query<{ count: string }>(
      "SELECT count(*) as count FROM action_history WHERE complaint_id = $1;",
      [complaint.id.toString()]
    );
    expect(parseInt(finalAuditRes.rows[0].count, 10)).toBe(5); // SUBMIT, REVIEW, ASSIGN, START_PROGRESS, RESOLVE
  });

  it("rolls back all changes when transaction aborts, preventing partial or orphan writes", async () => {
    const db = await getDatabaseClient();

    // Attempt transactional insertion that throws an error mid-transaction
    await expect(
      executeTransaction(async (tx) => {
        const repo = new PostgresComplaintRepository(tx);
        const complaintResult = Complaint.create({
          refId: "CP-2026-08888",
          title: "Temporary Aborted Ticket For Rollback Verification",
          description: "This ticket must never be committed to permanent storage.",
          complainantId: FIXTURES.studentA,
          departmentId: FIXTURES.deptIt,
          categoryId: FIXTURES.categoryWifi,
          locationDetails: "Test Area",
        });

        if (complaintResult.isFailure) throw new Error("Creation failed");
        const complaint = complaintResult.value;
        await repo.save(complaint);

        // Force intentional transaction abortion
        throw new Error("Intentional transaction failure for rollback verification");
      })
    ).rejects.toThrow("Intentional transaction failure for rollback verification");

    // Verify complaint record was rolled back
    const checkRes = await db.query<{ count: string }>(
      "SELECT count(*) as count FROM complaints WHERE ref_id = 'CP-2026-08888';"
    );
    expect(parseInt(checkRes.rows[0].count, 10)).toBe(0);

    // Verify no orphan audit records
    const auditRes = await db.query<{ count: string }>(
      "SELECT count(*) as count FROM action_history WHERE remarks LIKE '%Temporary Aborted%';"
    );
    expect(parseInt(auditRes.rows[0].count, 10)).toBe(0);
  });
});
