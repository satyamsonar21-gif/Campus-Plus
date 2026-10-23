import { ISLAPolicyPort } from "@/application/ports/ISLAPolicyPort";
import { CategoryId, Priority } from "@/domain/complaint";
import { DatabaseQueryInterface } from "../database/migrator";

interface SLAPolicyRow {
  resolution_threshold_hours: number;
}

/**
 * PostgreSQL SLA Policy Adapter.
 * Resolves resolution deadlines from 'sla_policies' configuration table based on category and priority.
 */
export class PostgresSLAPolicyAdapter implements ISLAPolicyPort {
  constructor(private readonly db: DatabaseQueryInterface) {}

  public async calculateResolutionDeadline(
    categoryId: CategoryId,
    priority: Priority,
    createdAt: Date
  ): Promise<Date | null> {
    const res = await this.db.query<SLAPolicyRow>(
      `SELECT resolution_threshold_hours 
       FROM sla_policies 
       WHERE category_id = $1 AND priority = $2 AND is_active = TRUE 
       LIMIT 1;`,
      [categoryId.toString(), priority.toString()]
    );

    if (res.rows.length === 0) return null;

    const hours = res.rows[0].resolution_threshold_hours;
    const deadline = new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
    return deadline;
  }
}
