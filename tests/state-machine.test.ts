import { describe, expect, it } from "vitest";
import { transitionPayment } from "@/lib/domain/state-machine";

describe("payment state machine", () => {
  it("moves a reviewed request into settlement after approval", () => {
    expect(transitionPayment("REVIEW_REQUIRED", "OPERATOR_APPROVED")).toEqual({
      ok: true,
      previous: "REVIEW_REQUIRED",
      next: "SETTLING",
      event: "OPERATOR_APPROVED",
    });
  });

  it("returns an explicit conflict for an illegal transition", () => {
    const result = transitionPayment("DENIED", "OPERATOR_APPROVED");

    expect(result).toMatchObject({
      ok: false,
      code: "TRANSITION_NOT_ALLOWED",
      current: "DENIED",
      event: "OPERATOR_APPROVED",
    });
  });

  it("does not permit a second settlement transition", () => {
    expect(transitionPayment("SETTLED", "SETTLEMENT_SUCCEEDED").ok).toBe(false);
  });
});
