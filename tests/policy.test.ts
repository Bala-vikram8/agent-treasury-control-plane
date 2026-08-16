import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "@/lib/domain/policy";

const baseInput = {
  agentId: "routepilot-client",
  merchant: "CloudVector",
  category: "Cloud compute",
  amountCents: 1_825,
  riskScore: 12,
};

describe("policy evaluation", () => {
  it("automatically approves a safe request", () => {
    expect(evaluatePolicy(baseInput, 0).decision).toBe("AUTO_APPROVE");
  });

  it("requires review above the automatic threshold", () => {
    expect(evaluatePolicy({ ...baseInput, amountCents: 4_280 }, 0).decision).toBe(
      "REVIEW",
    );
  });

  it("denies an unknown merchant", () => {
    const result = evaluatePolicy(
      { ...baseInput, merchant: "Unknown vendor" },
      0,
    );

    expect(result.decision).toBe("DENY");
    expect(result.rules).toContainEqual(
      expect.objectContaining({ rule: "merchant_allowlist", outcome: "DENY" }),
    );
  });

  it("denies a request that would exceed the daily budget", () => {
    expect(evaluatePolicy(baseInput, 49_000).decision).toBe("DENY");
  });
});
