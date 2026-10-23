import { describe, expect, it, vi } from "vitest";
import { PostgresSLAPolicyAdapter } from "@/infrastructure/adapters/PostgresSLAPolicyAdapter";
import { CategoryId, ComplaintPriority, Priority } from "@/domain/complaint";

const categoryId = new CategoryId("00000000-0000-0000-0000-000000000101");

describe("PostgresSLAPolicyAdapter", () => {
  it("returns no deadline when an institution has not configured a policy", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const adapter = new PostgresSLAPolicyAdapter(db);

    await expect(adapter.calculateResolutionDeadline(
      categoryId,
      new Priority(ComplaintPriority.MEDIUM),
      new Date("2026-10-24T09:00:00.000Z")
    )).resolves.toBeNull();
  });

  it("uses the active configured resolution threshold", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ resolution_threshold_hours: 30 }] }) };
    const adapter = new PostgresSLAPolicyAdapter(db);
    const createdAt = new Date("2026-10-24T09:00:00.000Z");

    await expect(adapter.calculateResolutionDeadline(
      categoryId,
      new Priority(ComplaintPriority.MEDIUM),
      createdAt
    )).resolves.toEqual(new Date("2026-10-25T15:00:00.000Z"));
  });
});
