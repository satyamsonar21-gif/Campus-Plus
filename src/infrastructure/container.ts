import { DatabaseQueryInterface } from "./database/migrator";
import { executeTransaction, getDatabaseClient } from "./database/pool";
import { PostgresComplaintRepository } from "./database/PostgresComplaintRepository";
import { PostgresTrackingCodeGenerator } from "./adapters/PostgresTrackingCodeGenerator";
import { PostgresIdempotencyAdapter } from "./adapters/PostgresIdempotencyAdapter";
import { PostgresDepartmentMembershipAdapter } from "./adapters/PostgresDepartmentMembershipAdapter";
import { PostgresSLAPolicyAdapter } from "./adapters/PostgresSLAPolicyAdapter";
import { CalendarReopenPolicyAdapter, EvidenceResolutionPolicyAdapter } from "./adapters/PolicyAdapters";
import { AuthenticationAdapter } from "./auth/AuthenticationAdapter";
import { InMemoryStorageAdapter, UnavailableStorageAdapter } from "./storage/StorageAdapter";
import { SupabaseStorageAdapter } from "./storage/SupabaseStorageAdapter";
import { StoragePort } from "@/application/ports/ExternalPorts";

// Use cases
import {
  SubmitComplaintUseCase,
  ReviewComplaintUseCase,
  AssignComplaintUseCase,
  StartProgressUseCase,
  ForwardComplaintUseCase,
  EscalateComplaintUseCase,
  ResolveComplaintUseCase,
  CloseComplaintUseCase,
  ReopenComplaintUseCase,
  RejectComplaintUseCase,
  CancelComplaintUseCase,
  MarkDuplicateUseCase,
  GetComplaintUseCase,
  ListComplaintsUseCase,
  GetTimelineUseCase,
} from "@/application/use-cases";

export interface AppContainer {
  db: DatabaseQueryInterface;
  complaintRepo: PostgresComplaintRepository;
  queryRepo: PostgresComplaintRepository;
  trackingCodeGenerator: PostgresTrackingCodeGenerator;
  idempotencyAdapter: PostgresIdempotencyAdapter;
  membershipAdapter: PostgresDepartmentMembershipAdapter;
  slaPolicyAdapter: PostgresSLAPolicyAdapter;
  reopenPolicyAdapter: CalendarReopenPolicyAdapter;
  resolutionPolicyAdapter: EvidenceResolutionPolicyAdapter;
  authAdapter: AuthenticationAdapter;
  storageAdapter: StoragePort;

  // Use Cases
  submitComplaintUseCase: SubmitComplaintUseCase;
  reviewComplaintUseCase: ReviewComplaintUseCase;
  assignComplaintUseCase: AssignComplaintUseCase;
  startProgressUseCase: StartProgressUseCase;
  forwardComplaintUseCase: ForwardComplaintUseCase;
  escalateComplaintUseCase: EscalateComplaintUseCase;
  resolveComplaintUseCase: ResolveComplaintUseCase;
  closeComplaintUseCase: CloseComplaintUseCase;
  reopenComplaintUseCase: ReopenComplaintUseCase;
  rejectComplaintUseCase: RejectComplaintUseCase;
  cancelComplaintUseCase: CancelComplaintUseCase;
  markDuplicateUseCase: MarkDuplicateUseCase;
  getComplaintUseCase: GetComplaintUseCase;
  listComplaintsUseCase: ListComplaintsUseCase;
  getTimelineUseCase: GetTimelineUseCase;
}

let containerInstance: AppContainer | null = null;
let containerPromise: Promise<AppContainer> | null = null;

/**
 * Returns the initialized Application Dependency Injection Container.
 */
export async function getContainer(): Promise<AppContainer> {
  if (containerInstance) {
    return containerInstance;
  }

  if (containerPromise) {
    return containerPromise;
  }

  containerPromise = (async () => {
    const db = await getDatabaseClient();

    const complaintRepo = new PostgresComplaintRepository(db, executeTransaction);
    const trackingCodeGenerator = new PostgresTrackingCodeGenerator(db);
    const idempotencyAdapter = new PostgresIdempotencyAdapter(db);
    const membershipAdapter = new PostgresDepartmentMembershipAdapter(db);
    const slaPolicyAdapter = new PostgresSLAPolicyAdapter(db);
    const reopenPolicyAdapter = new CalendarReopenPolicyAdapter();
    const resolutionPolicyAdapter = new EvidenceResolutionPolicyAdapter(db);
    const authAdapter = new AuthenticationAdapter(db);
    const hasPrivateStorageCredentials = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const storageAdapter: StoragePort = hasPrivateStorageCredentials
      ? new SupabaseStorageAdapter()
      : process.env.NODE_ENV === "production"
        ? new UnavailableStorageAdapter()
        : new InMemoryStorageAdapter();

    const submitComplaintUseCase = new SubmitComplaintUseCase(
      complaintRepo,
      trackingCodeGenerator,
      idempotencyAdapter,
      slaPolicyAdapter
    );
    const reviewComplaintUseCase = new ReviewComplaintUseCase(complaintRepo);
    const assignComplaintUseCase = new AssignComplaintUseCase(complaintRepo, membershipAdapter);
    const startProgressUseCase = new StartProgressUseCase(complaintRepo);
    const forwardComplaintUseCase = new ForwardComplaintUseCase(complaintRepo);
    const escalateComplaintUseCase = new EscalateComplaintUseCase(complaintRepo);
    const resolveComplaintUseCase = new ResolveComplaintUseCase(complaintRepo, resolutionPolicyAdapter);
    const closeComplaintUseCase = new CloseComplaintUseCase(complaintRepo);
    const reopenComplaintUseCase = new ReopenComplaintUseCase(complaintRepo, reopenPolicyAdapter);
    const rejectComplaintUseCase = new RejectComplaintUseCase(complaintRepo);
    const cancelComplaintUseCase = new CancelComplaintUseCase(complaintRepo);
    const markDuplicateUseCase = new MarkDuplicateUseCase(complaintRepo);
    const getComplaintUseCase = new GetComplaintUseCase(complaintRepo);
    const listComplaintsUseCase = new ListComplaintsUseCase(complaintRepo);
    const getTimelineUseCase = new GetTimelineUseCase(complaintRepo, complaintRepo);

    containerInstance = {
      db,
      complaintRepo,
      queryRepo: complaintRepo,
      trackingCodeGenerator,
      idempotencyAdapter,
      membershipAdapter,
      slaPolicyAdapter,
      reopenPolicyAdapter,
      resolutionPolicyAdapter,
      authAdapter,
      storageAdapter,
      submitComplaintUseCase,
      reviewComplaintUseCase,
      assignComplaintUseCase,
      startProgressUseCase,
      forwardComplaintUseCase,
      escalateComplaintUseCase,
      resolveComplaintUseCase,
      closeComplaintUseCase,
      reopenComplaintUseCase,
      rejectComplaintUseCase,
      cancelComplaintUseCase,
      markDuplicateUseCase,
      getComplaintUseCase,
      listComplaintsUseCase,
      getTimelineUseCase,
    };

    return containerInstance;
  })();

  return containerPromise;
}

/**
 * Resets the container instance (used in automated integration tests).
 */
export function resetContainer(): void {
  containerInstance = null;
  containerPromise = null;
}
