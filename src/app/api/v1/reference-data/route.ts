import { getContainer } from "@/infrastructure/container";
import { createSuccessResponse } from "@/presentation/utils/apiResponse";
import { handleApiError } from "@/presentation/utils/errorHandler";

export const dynamic = "force-dynamic";

interface CategoryReferenceRow {
  id: string;
  name: string;
  default_department_id: string;
  default_department_name: string;
  requires_resolution_proof: boolean;
}

interface DepartmentReferenceRow {
  id: string;
  name: string;
}

/**
 * Public, non-sensitive reference data used to build complaint intake forms.
 * Routing is read from the database so the UI cannot drift from configured IDs.
 */
export async function GET() {
  try {
    const container = await getContainer();
    const [categoryResult, departmentResult] = await Promise.all([
      container.db.query<CategoryReferenceRow>(
        `SELECT
         c.id::text AS id,
         c.name,
         c.default_department_id::text AS default_department_id,
         d.name AS default_department_name,
         c.requires_resolution_proof
       FROM categories c
       JOIN departments d ON d.id = c.default_department_id
       WHERE c.is_active = TRUE AND d.is_active = TRUE
         ORDER BY c.name ASC;`
      ),
      container.db.query<DepartmentReferenceRow>(
        `SELECT id::text AS id, name
         FROM departments
         WHERE is_active = TRUE
         ORDER BY name ASC;`
      ),
    ]);

    return createSuccessResponse({
      categories: categoryResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        defaultDepartmentId: row.default_department_id,
        defaultDepartmentName: row.default_department_name,
        requiresResolutionProof: row.requires_resolution_proof,
      })),
      departments: departmentResult.rows,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
