export const paymentStates = [
  "RECEIVED",
  "REVIEW_REQUIRED",
  "DENIED",
  "SETTLING",
  "SETTLED",
  "FAILED",
] as const;

export type PaymentState = (typeof paymentStates)[number];

export type PaymentEvent =
  | "POLICY_AUTO_APPROVED"
  | "POLICY_REVIEW_REQUIRED"
  | "POLICY_DENIED"
  | "OPERATOR_APPROVED"
  | "OPERATOR_DENIED"
  | "SETTLEMENT_SUCCEEDED"
  | "SETTLEMENT_FAILED";

export type TransitionResult =
  | { ok: true; previous: PaymentState; next: PaymentState; event: PaymentEvent }
  | {
      ok: false;
      code: "TRANSITION_NOT_ALLOWED";
      current: PaymentState;
      event: PaymentEvent;
      message: string;
    };

const transitions: Record<PaymentState, Partial<Record<PaymentEvent, PaymentState>>> = {
  RECEIVED: {
    POLICY_AUTO_APPROVED: "SETTLING",
    POLICY_REVIEW_REQUIRED: "REVIEW_REQUIRED",
    POLICY_DENIED: "DENIED",
  },
  REVIEW_REQUIRED: {
    OPERATOR_APPROVED: "SETTLING",
    OPERATOR_DENIED: "DENIED",
  },
  SETTLING: {
    SETTLEMENT_SUCCEEDED: "SETTLED",
    SETTLEMENT_FAILED: "FAILED",
  },
  DENIED: {},
  SETTLED: {},
  FAILED: {},
};

export function transitionPayment(
  current: PaymentState,
  event: PaymentEvent,
): TransitionResult {
  const next = transitions[current][event];

  if (!next) {
    return {
      ok: false,
      code: "TRANSITION_NOT_ALLOWED",
      current,
      event,
      message: `Cannot apply ${event} while payment is ${current}`,
    };
  }

  return { ok: true, previous: current, next, event };
}
