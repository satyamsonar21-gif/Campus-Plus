import { describe, it, expect } from "vitest";
import {
  ComplaintStatus,
  canTransition,
  ALLOWED_STATUS_TRANSITIONS,
  isTerminalStatus,
} from "@/domain/complaint/ComplaintStatus";
describe("Canonical 13-State Domain FSM & Transition Rules", () => {
  describe("Legal Sequential & Branching Transitions", () => {
    it("should permit DRAFT -> SUBMITTED", () => {
      expect(canTransition(ComplaintStatus.DRAFT, ComplaintStatus.SUBMITTED)).toBe(true);
    });

    it("should permit SUBMITTED branches (REVIEWED, ASSIGNED, REJECTED, CANCELLED)", () => {
      expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.REVIEWED)).toBe(true);
      expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.ASSIGNED)).toBe(true);
      expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.REJECTED)).toBe(true);
      expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.CANCELLED)).toBe(true);
    });

    it("should permit REVIEWED branches (ASSIGNED, FORWARDED, ESCALATED, REJECTED, DUPLICATE)", () => {
      expect(canTransition(ComplaintStatus.REVIEWED, ComplaintStatus.ASSIGNED)).toBe(true);
      expect(canTransition(ComplaintStatus.REVIEWED, ComplaintStatus.FORWARDED)).toBe(true);
      expect(canTransition(ComplaintStatus.REVIEWED, ComplaintStatus.ESCALATED)).toBe(true);
      expect(canTransition(ComplaintStatus.REVIEWED, ComplaintStatus.REJECTED)).toBe(true);
      expect(canTransition(ComplaintStatus.REVIEWED, ComplaintStatus.DUPLICATE)).toBe(true);
    });

    it("should permit ASSIGNED branches (IN_PROGRESS, FORWARDED, ESCALATED, ASSIGNED for reassignment)", () => {
      expect(canTransition(ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS)).toBe(true);
      expect(canTransition(ComplaintStatus.ASSIGNED, ComplaintStatus.FORWARDED)).toBe(true);
      expect(canTransition(ComplaintStatus.ASSIGNED, ComplaintStatus.ESCALATED)).toBe(true);
      expect(canTransition(ComplaintStatus.ASSIGNED, ComplaintStatus.ASSIGNED)).toBe(true);
    });

    it("should permit IN_PROGRESS branches (RESOLVED, FORWARDED, ESCALATED)", () => {
      expect(canTransition(ComplaintStatus.IN_PROGRESS, ComplaintStatus.RESOLVED)).toBe(true);
      expect(canTransition(ComplaintStatus.IN_PROGRESS, ComplaintStatus.FORWARDED)).toBe(true);
      expect(canTransition(ComplaintStatus.IN_PROGRESS, ComplaintStatus.ESCALATED)).toBe(true);
    });

    it("should permit FORWARDED branches (REVIEWED, ASSIGNED, ESCALATED)", () => {
      expect(canTransition(ComplaintStatus.FORWARDED, ComplaintStatus.REVIEWED)).toBe(true);
      expect(canTransition(ComplaintStatus.FORWARDED, ComplaintStatus.ASSIGNED)).toBe(true);
      expect(canTransition(ComplaintStatus.FORWARDED, ComplaintStatus.ESCALATED)).toBe(true);
    });

    it("should permit ESCALATED branches (ASSIGNED, IN_PROGRESS, RESOLVED, FORWARDED)", () => {
      expect(canTransition(ComplaintStatus.ESCALATED, ComplaintStatus.ASSIGNED)).toBe(true);
      expect(canTransition(ComplaintStatus.ESCALATED, ComplaintStatus.IN_PROGRESS)).toBe(true);
      expect(canTransition(ComplaintStatus.ESCALATED, ComplaintStatus.RESOLVED)).toBe(true);
      expect(canTransition(ComplaintStatus.ESCALATED, ComplaintStatus.FORWARDED)).toBe(true);
    });

    it("should permit RESOLVED branches (CLOSED, REOPENED)", () => {
      expect(canTransition(ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED)).toBe(true);
      expect(canTransition(ComplaintStatus.RESOLVED, ComplaintStatus.REOPENED)).toBe(true);
    });

    it("should permit REOPENED branches (ASSIGNED, IN_PROGRESS, ESCALATED)", () => {
      expect(canTransition(ComplaintStatus.REOPENED, ComplaintStatus.ASSIGNED)).toBe(true);
      expect(canTransition(ComplaintStatus.REOPENED, ComplaintStatus.IN_PROGRESS)).toBe(true);
      expect(canTransition(ComplaintStatus.REOPENED, ComplaintStatus.ESCALATED)).toBe(true);
    });

    it("should permit terminal transition to CLOSED from REJECTED, DUPLICATE, and CANCELLED", () => {
      expect(canTransition(ComplaintStatus.REJECTED, ComplaintStatus.CLOSED)).toBe(true);
      expect(canTransition(ComplaintStatus.DUPLICATE, ComplaintStatus.CLOSED)).toBe(true);
      expect(canTransition(ComplaintStatus.CANCELLED, ComplaintStatus.CLOSED)).toBe(true);
    });
  });

  describe("Terminal CLOSED Invariant (INV-003)", () => {
    it("should strictly enforce CLOSED as terminal with zero outgoing transitions", () => {
      expect(ALLOWED_STATUS_TRANSITIONS[ComplaintStatus.CLOSED]).toEqual([]);
      expect(isTerminalStatus(ComplaintStatus.CLOSED)).toBe(true);

      // Verify that every single state transition out of CLOSED fails
      const allStatuses = Object.values(ComplaintStatus);
      for (const targetStatus of allStatuses) {
        expect(canTransition(ComplaintStatus.CLOSED, targetStatus)).toBe(false);
      }
    });
  });

  describe("Illegal Transition Matrix & Shortcut Rejection (INV-004)", () => {
    it("should reject direct shortcut transitions from DRAFT", () => {
      expect(canTransition(ComplaintStatus.DRAFT, ComplaintStatus.IN_PROGRESS)).toBe(false);
      expect(canTransition(ComplaintStatus.DRAFT, ComplaintStatus.RESOLVED)).toBe(false);
      expect(canTransition(ComplaintStatus.DRAFT, ComplaintStatus.CLOSED)).toBe(false);
    });

    it("should reject unearned closure shortcuts without resolution or adjudication", () => {
      expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.CLOSED)).toBe(false);
      expect(canTransition(ComplaintStatus.REVIEWED, ComplaintStatus.CLOSED)).toBe(false);
      expect(canTransition(ComplaintStatus.ASSIGNED, ComplaintStatus.CLOSED)).toBe(false);
      expect(canTransition(ComplaintStatus.IN_PROGRESS, ComplaintStatus.CLOSED)).toBe(false);
    });

    it("should reject skipping triage or resolution directly to terminal states", () => {
      expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.RESOLVED)).toBe(false);
      expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.IN_PROGRESS)).toBe(false);
      expect(canTransition(ComplaintStatus.REVIEWED, ComplaintStatus.RESOLVED)).toBe(false);
    });

    it("should reject backwards transitions to earlier states", () => {
      expect(canTransition(ComplaintStatus.RESOLVED, ComplaintStatus.SUBMITTED)).toBe(false);
      expect(canTransition(ComplaintStatus.RESOLVED, ComplaintStatus.DRAFT)).toBe(false);
      expect(canTransition(ComplaintStatus.IN_PROGRESS, ComplaintStatus.SUBMITTED)).toBe(false);
      expect(canTransition(ComplaintStatus.ASSIGNED, ComplaintStatus.DRAFT)).toBe(false);
    });
  });

});
