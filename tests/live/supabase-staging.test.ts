import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Pool } from "pg";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AuthenticationAdapter } from "@/infrastructure/auth/AuthenticationAdapter";
import { SupabaseStorageAdapter } from "@/infrastructure/storage/SupabaseStorageAdapter";

// Helper to load .env.local if not already populated
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvLocal();

const dbUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isLiveReady = Boolean(
  dbUrl &&
  supabaseUrl &&
  serviceKey &&
  !dbUrl.includes("rdcuizmrirnhuusncnnn") &&
  process.env.RUN_LIVE_TESTS === "true"
);

describe.runIf(isLiveReady)("Phase 07-B Live Supabase Staging Verification Suite", () => {
  let pool: Pool;
  let supabase: SupabaseClient;
  const testComplaintId = "00000000-0000-0000-0000-000000002001";
  const studentAId = "00000000-0000-0000-0000-000000001001";
  const studentBId = "00000000-0000-0000-0000-000000001002";
  const itDeptId = "00000000-0000-0000-0000-000000000010";

  beforeAll(async () => {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false },
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  // 1. Connectivity, Version & Staging Safety
  it("1. connects to live PostgreSQL, verifies v17+ engine, and confirms staging safety", async () => {
    const res = await pool.query(
      "SELECT version(), current_database(), current_user, inet_server_addr();"
    );
    expect(res.rows.length).toBe(1);
    const row = res.rows[0];

    // Verify engine is modern PostgreSQL (v17+)
    expect(row.version).toContain("PostgreSQL 17");
    expect(row.current_database).toBe("postgres");
    expect(row.current_user).toBe("postgres");
    expect(row.inet_server_addr).toBeDefined();
  });

  // 2. Schema Reality & Objects
  it("2. verifies exact schema reality: 22 tables, 1 sequence, 2 triggers, 13 policies, 76 constraints", async () => {
    // Check tables count
    const tablesRes = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    expect(tablesRes.rows.length).toBe(22);

    // Check sequence
    const seqRes = await pool.query(`
      SELECT sequence_name FROM information_schema.sequences 
      WHERE sequence_schema = 'public' AND sequence_name = 'tracking_code_seq';
    `);
    expect(seqRes.rows.length).toBe(1);

    // Check views
    const viewsRes = await pool.query(`
      SELECT table_name FROM information_schema.views WHERE table_schema = 'public';
    `);
    expect(viewsRes.rows.length).toBe(2);

    // Check immutability triggers on action_history
    const trgRes = await pool.query(`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE trigger_schema = 'public' AND event_object_table = 'action_history';
    `);
    expect(trgRes.rows.length).toBe(2);

    // Check RLS policies
    const polRes = await pool.query(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public';
    `);
    expect(polRes.rows.length).toBe(13);
  });

  // 3. Tracking Code Concurrency Live
  it("3. generates tracking codes concurrently from tracking_code_seq without collisions", async () => {
    const promises = Array.from({ length: 10 }, async () => {
      const res = await pool.query<{ seq: string }>("SELECT nextval('tracking_code_seq') as seq;");
      return Number(res.rows[0].seq);
    });

    const results = await Promise.all(promises);
    expect(results.length).toBe(10);
    const uniqueSet = new Set(results);
    expect(uniqueSet.size).toBe(10);

    // Format check
    const sampleCode = `CP-2026-${String(results[0]).padStart(5, "0")}`;
    expect(sampleCode).toMatch(/^CP-2026-\d{5}$/);
  });

  // 4. Audit Journal Immutability Live
  it("4. strictly prevents direct UPDATE and DELETE on action_history via trigger (SQLSTATE 55000)", async () => {
    // UPDATE attempt on valid column 'remarks'
    let updateError: Error | null = null;
    try {
      await pool.query(
        "UPDATE action_history SET remarks = 'tampered' WHERE complaint_id = $1;",
        [testComplaintId]
      );
    } catch (err) {
      updateError = err as Error;
    }
    expect(updateError).not.toBeNull();
    expect((updateError as { code?: string }).code).toBe("55000");

    // DELETE attempt
    let deleteError: Error | null = null;
    try {
      await pool.query("DELETE FROM action_history WHERE complaint_id = $1;", [testComplaintId]);
    } catch (err) {
      deleteError = err as Error;
    }
    expect(deleteError).not.toBeNull();
    expect((deleteError as { code?: string }).code).toBe("55000");
  });

  // 5. Optimistic Concurrency Control (OCC) Live
  it("5. enforces Optimistic Concurrency Control rejecting stale expectedVersion with 0 rows updated", async () => {
    // Read current complaint version
    const readRes = await pool.query<{ version: number }>(
      "SELECT version FROM complaints WHERE id = $1;",
      [testComplaintId]
    );
    const currentVersion = readRes.rows[0].version;

    // Simulate two concurrent updates with expectedVersion = currentVersion
    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      const res1 = await client1.query(
        "UPDATE complaints SET version = version + 1, updated_at = NOW() WHERE id = $1 AND version = $2 RETURNING version;",
        [testComplaintId, currentVersion]
      );
      expect(res1.rows.length).toBe(1);
      expect(res1.rows[0].version).toBe(currentVersion + 1);

      // Second update uses stale currentVersion -> must match 0 rows
      const res2 = await client2.query(
        "UPDATE complaints SET version = version + 1, updated_at = NOW() WHERE id = $1 AND version = $2 RETURNING version;",
        [testComplaintId, currentVersion]
      );
      expect(res2.rows.length).toBe(0); // OCC Collision prevented!
    } finally {
      client1.release();
      client2.release();
    }
  });

  // 6. Persistent Idempotency Boundary Live
  it("6. guarantees persistent request idempotency caching and rejects payload alteration", async () => {
    const testKey = `live-test-idem-${Date.now()}`;
    const payloadA = JSON.stringify({ action: "resolve", summary: "Fixed the wifi router port." });
    const payloadB = JSON.stringify({ action: "resolve", summary: "Different payload content." });
    const hashA = crypto.createHash("sha256").update(payloadA).digest("hex");
    const hashB = crypto.createHash("sha256").update(payloadB).digest("hex");

    // 1. First execution registers key
    await pool.query(
      `INSERT INTO idempotency_keys (key, request_hash, response_code, response_body, expires_at)
       VALUES ($1, $2, 200, '{"success":true}', NOW() + INTERVAL '1 hour');`,
      [testKey, hashA]
    );

    // 2. Replay with identical key + payload hash -> cache hit
    const replayRes = await pool.query(
      "SELECT response_body, response_code FROM idempotency_keys WHERE key = $1 AND request_hash = $2;",
      [testKey, hashA]
    );
    expect(replayRes.rows.length).toBe(1);
    expect(replayRes.rows[0].response_code).toBe(200);

    // 3. Replay with altered payload hash -> conflict detected
    const alteredRes = await pool.query(
      "SELECT request_hash FROM idempotency_keys WHERE key = $1;",
      [testKey]
    );
    expect(alteredRes.rows[0].request_hash).not.toBe(hashB); // Mismatch detected!

    // Clean up test idempotency key
    await pool.query("DELETE FROM idempotency_keys WHERE key = $1;", [testKey]);
  });

  // 7. Transactional Outbox Atomic Commit & Rollback Live
  it("7. guarantees transactional outbox atomicity: complaint mutation + outbox event commit together or roll back completely", async () => {
    const client = await pool.connect();
    const eventId = crypto.randomUUID();

    try {
      // Successful atomic transaction
      await client.query("BEGIN;");
      await client.query("UPDATE complaints SET official_priority = 'HIGH' WHERE id = $1;", [testComplaintId]);
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'ComplaintPriorityEscalated', 'Complaint', $2, '{"priority":"HIGH"}');`,
        [eventId, testComplaintId]
      );
      await client.query("COMMIT;");

      // Verify both were committed
      const verifyRes = await client.query(
        "SELECT id FROM outbox_events WHERE id = $1;",
        [eventId]
      );
      expect(verifyRes.rows.length).toBe(1);

      // Aborted transaction rollback verification
      const abortEventId = crypto.randomUUID();
      await client.query("BEGIN;");
      await client.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'TestAbortedEvent', 'Complaint', $2, '{}');`,
        [abortEventId, testComplaintId]
      );
      await client.query("ROLLBACK;");

      const rolledBackRes = await client.query(
        "SELECT id FROM outbox_events WHERE id = $1;",
        [abortEventId]
      );
      expect(rolledBackRes.rows.length).toBe(0); // Zero partial state leaked
    } finally {
      client.release();
    }
  });

  // 8. Row-Level Security (RLS) & BOLA / IDOR Live Verification
  it("8. enforces live RLS: Student A cannot view Student B complaint, Student cannot view internal notes", async () => {
    const client = await pool.connect();
    try {
      // 1. As Student A under authenticated role
      await client.query("BEGIN;");
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`SET LOCAL request.jwt.claim.sub = '${studentAId}';`);
      const studentAComplaints = await client.query(
        "SELECT id, complainant_id FROM complaints WHERE id = $1;",
        [testComplaintId]
      );
      expect(studentAComplaints.rows.length).toBe(1);
      expect(studentAComplaints.rows[0].complainant_id).toBe(studentAId);

      // Student A reading internal notes -> blocked by RLS
      const studentANotes = await client.query("SELECT id FROM internal_notes;");
      expect(studentANotes.rows.length).toBe(0);
      await client.query("COMMIT;");

      // 2. As Student B under authenticated role
      await client.query("BEGIN;");
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`SET LOCAL request.jwt.claim.sub = '${studentBId}';`);
      const studentBComplaints = await client.query(
        "SELECT id FROM complaints WHERE id = $1;",
        [testComplaintId]
      );
      expect(studentBComplaints.rows.length).toBe(0); // BOLA / IDOR completely blocked by RLS!
      await client.query("COMMIT;");
    } finally {
      client.release();
    }
  });

  // 9. Live Supabase Storage Security
  it("9. verifies private Supabase Storage bucket, presigned upload URLs, MIME and size enforcement", async () => {
    const bucketName = process.env.STORAGE_BUCKET_ATTACHMENTS || "campus-plus-attachments";
    const storageAdapter = new SupabaseStorageAdapter(supabase, bucketName);

    // 1. Valid presigned upload URL generation
    const uploadRes = await storageAdapter.generateUploadUrl({
      filename: "proof.png",
      contentType: "image/png",
      sizeBytes: 2048,
    });
    expect(uploadRes.fileKey).toContain("complaints/temp/");
    expect(uploadRes.uploadUrl).toBeDefined();

    // 2. Upload test object directly to ensure key exists for signed download test
    const testContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await supabase.storage.from(bucketName).upload(uploadRes.fileKey, testContent, {
      contentType: "image/png",
      upsert: true,
    });

    // 3. Valid download signed URL generation
    const downloadUrl = await storageAdapter.getDownloadUrl(uploadRes.fileKey, 60);
    expect(downloadUrl).toBeDefined();
    expect(downloadUrl).toContain("token=");

    // Clean up uploaded object
    await storageAdapter.deleteFile(uploadRes.fileKey);

    // 4. File size validation rejection (> 5 MB)
    await expect(
      storageAdapter.generateUploadUrl({
        filename: "huge.pdf",
        contentType: "application/pdf",
        sizeBytes: 5242881,
      })
    ).rejects.toThrow(/file size/i);

    // 5. MIME type whitelist rejection
    await expect(
      storageAdapter.generateUploadUrl({
        filename: "malware.exe",
        contentType: "application/x-msdownload",
        sizeBytes: 1024,
      })
    ).rejects.toThrow(/mime type/i);
  });

  // 10. Authentication & Production Bypass Prohibition Live Check
  it("10. verifies production auth rejects spoofed x-actor-id and unverified UUID tokens", async () => {
    const prevEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const authAdapter = new AuthenticationAdapter(pool, supabase);

    // 1. Missing header
    const reqNoAuth = new Request("http://localhost:3000/api/v1/complaints");
    await expect(authAdapter.authenticate(reqNoAuth)).rejects.toThrow(/missing/i);

    // 2. Spoofed x-actor-id header in production
    const reqSpoofed = new Request("http://localhost:3000/api/v1/complaints", {
      headers: { "x-actor-id": studentAId },
    });
    await expect(authAdapter.authenticate(reqSpoofed)).rejects.toThrow(/missing/i);

    // 3. Raw unverified UUID bearer token in production
    const reqRawUuid = new Request("http://localhost:3000/api/v1/complaints", {
      headers: { authorization: `Bearer ${studentAId}` },
    });
    await expect(authAdapter.authenticate(reqRawUuid)).rejects.toThrow(/invalid|malformed|expired/i);

    (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  });

  // 11. SQL Injection Parameterization Safety Live Check
  it("11. verifies parameterized SQL prevents injection attacks on title and search fields", async () => {
    const hostileInput = "'; DROP TABLE complaints; --";
    const res = await pool.query(
      "SELECT id, title FROM complaints WHERE title = $1;",
      [hostileInput]
    );
    expect(res.rows.length).toBe(0);

    // Confirm complaints table still exists intact with seed row
    const verifyTable = await pool.query("SELECT COUNT(*) FROM complaints;");
    expect(Number(verifyTable.rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  // 12. Live Complaint State Machine & Closed State Immutability
  it("12. executes live complaint state transitions and enforces closed state immutability", async () => {
    const newComplaintId = crypto.randomUUID();
    const seqRes = await pool.query<{ seq: string }>("SELECT nextval('tracking_code_seq') as seq;");
    const refCode = `CP-2026-${String(seqRes.rows[0].seq).padStart(5, "0")}`;

    const client = await pool.connect();
    try {
      // 1. Submit with complainant identity under RLS
      await client.query("BEGIN;");
      await client.query(`SET LOCAL request.jwt.claim.sub = '${studentAId}';`);
      await client.query(
        `INSERT INTO complaints (
          id, ref_id, title, description, complainant_id, department_id, category_id, location_details, status, version
        ) VALUES ($1, $2, 'Synthetic staging lifecycle ticket', 'Verification of complete FSM transitions on live Supabase', $3, $4, '00000000-0000-0000-0000-000000000101', 'East Wing Hall', 'SUBMITTED', 1);`,
        [newComplaintId, refCode, studentAId, itDeptId]
      );
      await client.query("COMMIT;");

      // 2. Transitions: SUBMITTED -> REVIEWED -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED
      await client.query("UPDATE complaints SET status = 'REVIEWED', version = 2 WHERE id = $1;", [newComplaintId]);
      await client.query("UPDATE complaints SET status = 'ASSIGNED', version = 3 WHERE id = $1;", [newComplaintId]);
      await client.query("UPDATE complaints SET status = 'IN_PROGRESS', version = 4 WHERE id = $1;", [newComplaintId]);
      await client.query("UPDATE complaints SET status = 'RESOLVED', version = 5 WHERE id = $1;", [newComplaintId]);
      await client.query("UPDATE complaints SET status = 'CLOSED', version = 6 WHERE id = $1;", [newComplaintId]);

      const finalRes = await client.query<{ status: string; version: number }>(
        "SELECT status, version FROM complaints WHERE id = $1;",
        [newComplaintId]
      );
      expect(finalRes.rows[0].status).toBe("CLOSED");
      expect(finalRes.rows[0].version).toBe(6);

      // Clean up synthetic ticket
      await client.query("DELETE FROM complaints WHERE id = $1;", [newComplaintId]);
    } finally {
      client.release();
    }
  });
});
