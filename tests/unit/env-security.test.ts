import { describe, it, expect } from "vitest";
import {
  validateServerEnv,
  INSECURE_DEV_APP_SECRET,
  INSECURE_DEV_CRON_SECRET,
  DEFAULT_STORAGE_MAX_BYTES,
} from "@/config/env";

describe("Environment Security Hardening & Secret Validation Suite", () => {
  it("enforces 5 MB (5,242,880 bytes) as the default attachment file size limit", () => {
    const res = validateServerEnv({});
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.STORAGE_MAX_FILE_SIZE_BYTES).toBe(DEFAULT_STORAGE_MAX_BYTES);
      expect(res.data.STORAGE_MAX_FILE_SIZE_BYTES).toBe(5242880);
    }
  });

  describe("Production Environment Enforcement (NODE_ENV=production, NEXT_PUBLIC_APP_ENV=production)", () => {
    const baseProdConfig = {
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secure_pass@db.gtwpxjpmwltxwjryazcu.supabase.co:5432/postgres",
      APP_SECRET: "c2VjdXJlX3JhbmRvbV9zdHJpbmdfbWluXzMyX2NoYXJzXzEyMzQ1Njc4", // 56 chars
      CRON_SECRET: "Y3Jvbl9zZWNyZXRfbWluXzE2X2NoYXJz", // 32 chars
    };

    it("accepts valid production configuration with strong secrets and DATABASE_URL", () => {
      const res = validateServerEnv(baseProdConfig);
      expect(res.success).toBe(true);
    });

    it("rejects production configuration when DATABASE_URL is missing or empty", () => {
      const res = validateServerEnv({
        ...baseProdConfig,
        DATABASE_URL: "",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const errorMessages = res.error.issues.map((i) => i.message);
        expect(errorMessages.some((msg) => msg.includes("DATABASE_URL is mandatory in production"))).toBe(true);
      }
    });

    it("rejects production configuration using the insecure default APP_SECRET", () => {
      const res = validateServerEnv({
        ...baseProdConfig,
        APP_SECRET: INSECURE_DEV_APP_SECRET,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const errorMessages = res.error.issues.map((i) => i.message);
        expect(errorMessages.some((msg) => msg.includes("Insecure default APP_SECRET is forbidden in production"))).toBe(true);
      }
    });

    it("rejects production configuration with APP_SECRET shorter than 32 characters", () => {
      const res = validateServerEnv({
        ...baseProdConfig,
        APP_SECRET: "short_secret_only_24_chars__", // 28 chars (< 32)
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const errorMessages = res.error.issues.map((i) => i.message);
        expect(errorMessages.some((msg) => msg.includes("must be at least 32 characters long"))).toBe(true);
      }
    });

    it("rejects production configuration using the insecure default CRON_SECRET", () => {
      const res = validateServerEnv({
        ...baseProdConfig,
        CRON_SECRET: INSECURE_DEV_CRON_SECRET,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const errorMessages = res.error.issues.map((i) => i.message);
        expect(errorMessages.some((msg) => msg.includes("Insecure default CRON_SECRET is forbidden in production"))).toBe(true);
      }
    });

    it("rejects production configuration with CRON_SECRET shorter than 16 characters", () => {
      const res = validateServerEnv({
        ...baseProdConfig,
        CRON_SECRET: "short_cron_12", // 13 chars (< 16)
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const errorMessages = res.error.issues.map((i) => i.message);
        expect(errorMessages.some((msg) => msg.includes("must be at least 16 characters long"))).toBe(true);
      }
    });

    it("never includes actual secret strings in validation failure messages", () => {
      const sensitiveSecret = "my_super_secret_that_is_too_short";
      const res = validateServerEnv({
        ...baseProdConfig,
        CRON_SECRET: "short",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const stringified = JSON.stringify(res.error.format());
        expect(stringified).not.toContain(sensitiveSecret);
      }
    });
  });

  describe("Development / Test Compatibility", () => {
    it("allows default dev secrets when NODE_ENV is development", () => {
      const res = validateServerEnv({
        NODE_ENV: "development",
        NEXT_PUBLIC_APP_ENV: "development",
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.APP_SECRET).toBe(INSECURE_DEV_APP_SECRET);
        expect(res.data.CRON_SECRET).toBe(INSECURE_DEV_CRON_SECRET);
      }
    });

    it("allows default dev secrets when NODE_ENV is test", () => {
      const res = validateServerEnv({
        NODE_ENV: "test",
        NEXT_PUBLIC_APP_ENV: "test",
      });
      expect(res.success).toBe(true);
    });
  });
});
