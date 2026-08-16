import {
  IdempotencyConflictError,
  NotFoundError,
  ProviderConfigurationError,
  TransitionConflictError,
} from "@/lib/services/errors";

export function errorResponse(error: unknown) {
  if (error instanceof TransitionConflictError) {
    return Response.json(
      {
        error: error.code,
        message: error.message,
        currentState: error.current,
        attemptedEvent: error.event,
      },
      { status: 409 },
    );
  }

  if (error instanceof NotFoundError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: 404 },
    );
  }

  if (error instanceof IdempotencyConflictError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: 409 },
    );
  }

  if (error instanceof ProviderConfigurationError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: 503 },
    );
  }

  console.error(error);
  return Response.json(
    { error: "INTERNAL_ERROR", message: "The request could not be completed" },
    { status: 500 },
  );
}
