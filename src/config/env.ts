import { z } from "zod";

export const INSECURE_DEV_APP_SECRET = "dev_insecure_app_secret_at_least_16_chars";
export const INSECURE_DEV_CRON_SECRET = "dev_cron_secret_min_8_chars";
export const DEFAULT_STORAGE_MAX_BYTES = 5242880; // 5 MB strictly enforced

export const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().optional(),
  APP_SECRET: z.string().default(INSECURE_DEV_APP_SECRET),
  CRON_SECRET: z.string().default(INSECURE_DEV_CRON_SECRET),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  STORAGE_BUCKET_ATTACHMENTS: z.string().default("campus-plus-attachments"),
  STORAGE_MAX_FILE_SIZE_BYTES: z.coerce.number().default(DEFAULT_STORAGE_MAX_BYTES),
  NEXT_PUBLIC_APP_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
}).superRefine((data, ctx) => {
  const isStrictProduction = data.NODE_ENV === "production" && data.NEXT_PUBLIC_APP_ENV === "production";

  if (isStrictProduction) {
    // 1. Mandatory DATABASE_URL in Production
    if (!data.DATABASE_URL || data.DATABASE_URL.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "CRITICAL: DATABASE_URL is mandatory in production environment.",
      });
    }

    // 2. Mandatory Strong APP_SECRET in Production (min 32 chars, no dev default)
    if (!data.APP_SECRET || data.APP_SECRET === INSECURE_DEV_APP_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_SECRET"],
        message: "CRITICAL: Insecure default APP_SECRET is forbidden in production. Must be provided via environment.",
      });
    } else if (data.APP_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_SECRET"],
        message: "CRITICAL: Production APP_SECRET must be at least 32 characters long for cryptographic security.",
      });
    }

    // 3. Mandatory Strong CRON_SECRET in Production (min 16 chars, no dev default)
    if (!data.CRON_SECRET || data.CRON_SECRET === INSECURE_DEV_CRON_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CRON_SECRET"],
        message: "CRITICAL: Insecure default CRON_SECRET is forbidden in production. Must be provided via environment.",
      });
    } else if (data.CRON_SECRET.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CRON_SECRET"],
        message: "CRITICAL: Production CRON_SECRET must be at least 16 characters long.",
      });
    }
  } else {
    // Development / Test minimum sanity checks
    if (data.APP_SECRET && data.APP_SECRET.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_SECRET"],
        message: "APP_SECRET must be at least 16 characters.",
      });
    }
    if (data.CRON_SECRET && data.CRON_SECRET.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CRON_SECRET"],
        message: "CRON_SECRET must be at least 8 characters.",
      });
    }
  }
});

export const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;
export type AppEnv = ServerEnv & ClientEnv;

export function validateServerEnv(raw: Record<string, unknown>) {
  return serverSchema.safeParse(raw);
}

export function validateClientEnv(raw: Record<string, unknown>) {
  return clientSchema.safeParse(raw);
}

const isServer = typeof window === "undefined";

function parseEnv(): AppEnv {
  const rawEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    DATABASE_URL: process.env.DATABASE_URL,
    APP_SECRET: process.env.APP_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    STORAGE_BUCKET_ATTACHMENTS: process.env.STORAGE_BUCKET_ATTACHMENTS,
    STORAGE_MAX_FILE_SIZE_BYTES: process.env.STORAGE_MAX_FILE_SIZE_BYTES,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  const clientResult = clientSchema.safeParse(rawEnv);
  if (!clientResult.success) {
    console.error("❌ Invalid client environment variables:", clientResult.error.format());
    throw new Error("Invalid client environment variables");
  }

  if (!isServer) {
    // Return proxy that throws when accessing server-only properties on the client
    return new Proxy(clientResult.data as AppEnv, {
      get(target, prop: string) {
        if (!prop.startsWith("NEXT_PUBLIC_") && prop !== "NODE_ENV") {
          throw new Error(`Security Violation: Access to server-only env variable '${prop}' on client bundle.`);
        }
        return (target as Record<string, unknown>)[prop];
      },
    });
  }

  const serverResult = serverSchema.safeParse(rawEnv);
  if (!serverResult.success) {
    console.error("❌ Invalid server environment variables:", serverResult.error.format());
    throw new Error("Invalid server environment variables");
  }

  return {
    ...serverResult.data,
    ...clientResult.data,
  };
}

export const env = parseEnv();
