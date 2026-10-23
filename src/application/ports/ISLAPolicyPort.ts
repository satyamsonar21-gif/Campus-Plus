import { CategoryId, Priority } from "@/domain/complaint";

/**
 * SLA Policy Service Port.
 * Evaluates target response and resolution deadlines per category and priority (OD-006).
 * Consumes institutional configuration rather than hardcoding static hours into aggregates.
 */
export interface ISLAPolicyPort {
  calculateResolutionDeadline(
    categoryId: CategoryId,
    priority: Priority,
    createdAt: Date
  ): Promise<Date | null>;
}
