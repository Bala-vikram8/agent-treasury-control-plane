import type { PaymentEvent, PaymentState } from "@/lib/domain/state-machine";

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export class TransitionConflictError extends Error {
  readonly code = "TRANSITION_NOT_ALLOWED";

  constructor(
    message: string,
    readonly current: PaymentState,
    readonly event: PaymentEvent,
  ) {
    super(message);
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("The idempotency key was already used with a different payment payload");
  }
}

export class ProviderConfigurationError extends Error {
  readonly code = "PROVIDER_NOT_CONFIGURED";
}
