export type PolicyDecision = "AUTO_APPROVE" | "REVIEW" | "DENY";
export type RuleOutcome = "PASS" | "REVIEW" | "DENY";

export type PolicySnapshot = {
  version: string;
  dailyBudgetCents: number;
  autoApproveLimitCents: number;
  hardStopLimitCents: number;
  reviewRiskThreshold: number;
  denyRiskThreshold: number;
  allowedMerchants: string[];
  allowedCategories: string[];
};

export type PolicyInput = {
  agentId: string;
  merchant: string;
  category: string;
  amountCents: number;
  riskScore: number;
};

export type PolicyRuleResult = {
  rule: string;
  outcome: RuleOutcome;
  explanation: string;
};

export type PolicyEvaluationResult = {
  decision: PolicyDecision;
  projectedDailySpendCents: number;
  snapshot: PolicySnapshot;
  rules: PolicyRuleResult[];
};

export const defaultPolicy: PolicySnapshot = {
  version: "routepilot-v1.0",
  dailyBudgetCents: 50_000,
  autoApproveLimitCents: 2_500,
  hardStopLimitCents: 10_000,
  reviewRiskThreshold: 60,
  denyRiskThreshold: 85,
  allowedMerchants: ["OrbitRoute Maps", "CloudVector", "FuelGrid"],
  allowedCategories: ["Mapping API", "Cloud compute", "Fleet energy"],
};

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function evaluatePolicy(
  input: PolicyInput,
  committedTodayCents: number,
  snapshot: PolicySnapshot = defaultPolicy,
): PolicyEvaluationResult {
  const projectedDailySpendCents = committedTodayCents + input.amountCents;
  const merchantAllowed = snapshot.allowedMerchants.includes(input.merchant);
  const categoryAllowed = snapshot.allowedCategories.includes(input.category);

  const rules: PolicyRuleResult[] = [
    {
      rule: "merchant_allowlist",
      outcome: merchantAllowed ? "PASS" : "DENY",
      explanation: merchantAllowed
        ? `${input.merchant} is approved`
        : `${input.merchant} is not approved`,
    },
    {
      rule: "category_allowlist",
      outcome: categoryAllowed ? "PASS" : "DENY",
      explanation: categoryAllowed
        ? `${input.category} is allowed`
        : `${input.category} is blocked`,
    },
    {
      rule: "daily_budget",
      outcome:
        projectedDailySpendCents <= snapshot.dailyBudgetCents ? "PASS" : "DENY",
      explanation:
        projectedDailySpendCents <= snapshot.dailyBudgetCents
          ? `${dollars(projectedDailySpendCents)} projected spend is within budget`
          : `${dollars(projectedDailySpendCents)} exceeds the ${dollars(snapshot.dailyBudgetCents)} budget`,
    },
    {
      rule: "risk_score",
      outcome:
        input.riskScore >= snapshot.denyRiskThreshold
          ? "DENY"
          : input.riskScore >= snapshot.reviewRiskThreshold
            ? "REVIEW"
            : "PASS",
      explanation:
        input.riskScore >= snapshot.denyRiskThreshold
          ? `Risk score ${input.riskScore} meets the deny threshold`
          : input.riskScore >= snapshot.reviewRiskThreshold
            ? `Risk score ${input.riskScore} requires review`
            : `Risk score ${input.riskScore} is within policy`,
    },
    {
      rule: "amount_threshold",
      outcome:
        input.amountCents > snapshot.hardStopLimitCents
          ? "DENY"
          : input.amountCents > snapshot.autoApproveLimitCents
            ? "REVIEW"
            : "PASS",
      explanation:
        input.amountCents > snapshot.hardStopLimitCents
          ? `${dollars(input.amountCents)} exceeds the hard stop`
          : input.amountCents > snapshot.autoApproveLimitCents
            ? `${dollars(input.amountCents)} requires operator review`
            : `${dollars(input.amountCents)} is eligible for automatic approval`,
    },
  ];

  const decision: PolicyDecision = rules.some((rule) => rule.outcome === "DENY")
    ? "DENY"
    : rules.some((rule) => rule.outcome === "REVIEW")
      ? "REVIEW"
      : "AUTO_APPROVE";

  return { decision, projectedDailySpendCents, snapshot, rules };
}
