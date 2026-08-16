import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  approvalDecisions,
  auditEvents,
  paymentRequests,
  policyEvaluations,
  settlements,
  type PaymentRequestRow,
} from "@/lib/db/schema";
import { getPaymentView } from "@/lib/db/queries";
import { evaluatePolicy, type PolicyDecision } from "@/lib/domain/policy";
import {
  transitionPayment,
  type PaymentEvent,
  type PaymentState,
} from "@/lib/domain/state-machine";
import type { PaymentRequestInput } from "@/lib/domain/validation";
import {
  IdempotencyConflictError,
  NotFoundError,
  TransitionConflictError,
} from "./errors";
import {
  getSettlementProvider,
  type SettlementProvider,
} from "./settlement-provider";

type ServiceDependencies = {
  database?: Database;
  provider?: SettlementProvider;
};

function startOfUtcDay() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function policyEvent(decision: PolicyDecision): PaymentEvent {
  if (decision === "AUTO_APPROVE") return "POLICY_AUTO_APPROVED";
  if (decision === "REVIEW") return "POLICY_REVIEW_REQUIRED";
  return "POLICY_DENIED";
}

function assertTransition(current: PaymentState, event: PaymentEvent) {
  const transition = transitionPayment(current, event);

  if (!transition.ok) {
    throw new TransitionConflictError(
      transition.message,
      transition.current,
      transition.event,
    );
  }

  return transition;
}

function hasSamePaymentPayload(
  existing: PaymentRequestRow,
  input: PaymentRequestInput,
) {
  return (
    existing.agentId === input.agentId &&
    existing.idempotencyKey === input.idempotencyKey &&
    existing.merchant === input.merchant &&
    existing.category === input.category &&
    existing.purpose === input.purpose &&
    existing.amountCents === input.amountCents &&
    existing.currency === input.currency &&
    existing.riskScore === input.riskScore
  );
}

export async function createPaymentRequest(
  input: PaymentRequestInput,
  dependencies: ServiceDependencies = {},
) {
  const database = dependencies.database ?? getDb();

  const created = await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.agentId}))`,
    );

    const [request] = await transaction
      .insert(paymentRequests)
      .values(input)
      .onConflictDoNothing({
        target: [paymentRequests.agentId, paymentRequests.idempotencyKey],
      })
      .returning();

    if (!request) {
      const [existing] = await transaction
        .select()
        .from(paymentRequests)
        .where(
          and(
            eq(paymentRequests.agentId, input.agentId),
            eq(paymentRequests.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (!existing) throw new Error("Idempotent request could not be resolved");
      if (!hasSamePaymentPayload(existing, input)) {
        throw new IdempotencyConflictError();
      }
      return { created: false as const, request: existing };
    }

    const [commitment] = await transaction
      .select({
        total: sql<number>`coalesce(sum(${paymentRequests.amountCents}), 0)::int`,
      })
      .from(paymentRequests)
      .where(
        and(
          eq(paymentRequests.agentId, input.agentId),
          inArray(paymentRequests.state, [
            "REVIEW_REQUIRED",
            "SETTLING",
            "SETTLED",
          ]),
          gte(paymentRequests.createdAt, startOfUtcDay()),
        ),
      );

    const evaluation = evaluatePolicy(input, Number(commitment?.total ?? 0));
    const transition = assertTransition("RECEIVED", policyEvent(evaluation.decision));
    const now = new Date();

    const [updatedRequest] = await transaction
      .update(paymentRequests)
      .set({ state: transition.next, updatedAt: now })
      .where(eq(paymentRequests.id, request.id))
      .returning();

    await transaction.insert(policyEvaluations).values({
      paymentRequestId: request.id,
      policyVersion: evaluation.snapshot.version,
      decision: evaluation.decision,
      projectedDailySpendCents: evaluation.projectedDailySpendCents,
      policySnapshot: evaluation.snapshot,
      ruleResults: evaluation.rules,
    });

    await transaction.insert(auditEvents).values({
      paymentRequestId: request.id,
      eventType: `POLICY_${evaluation.decision}`,
      actorType: "SYSTEM",
      actorId: evaluation.snapshot.version,
      payload: {
        previousState: "RECEIVED",
        nextState: transition.next,
        decision: evaluation.decision,
      },
    });

    if (transition.next === "SETTLING") {
      await transaction.insert(settlements).values({
        paymentRequestId: request.id,
        amountCents: request.amountCents,
        currency: request.currency,
      });
    }

    return { created: true as const, request: updatedRequest };
  });

  if (created.created && created.request.state === "SETTLING") {
    await submitSettlement(
      created.request,
      dependencies.provider,
      database,
    );
  }

  return {
    created: created.created,
    payment: await getPaymentView(created.request.id, database),
  };
}

async function submitSettlement(
  request: PaymentRequestRow,
  provider: SettlementProvider | undefined,
  database: Database,
) {
  try {
    const settlementProvider = provider ?? getSettlementProvider();
    const providerResult = await settlementProvider.createTestPayment(request);
    const now = new Date();

    await database.transaction(async (transaction) => {
      await transaction
        .update(settlements)
        .set({
          providerPaymentId: providerResult.providerPaymentId,
          status: "PROCESSING",
          updatedAt: now,
        })
        .where(
          and(
            eq(settlements.paymentRequestId, request.id),
            eq(settlements.status, "PENDING"),
          ),
        );

      await transaction.insert(auditEvents).values({
        paymentRequestId: request.id,
        eventType: "SETTLEMENT_SUBMITTED",
        actorType: "SYSTEM",
        actorId: "stripe-adapter",
        payload: {
          providerPaymentId: providerResult.providerPaymentId,
          providerStatus: providerResult.providerStatus,
        },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider request failed";
    const now = new Date();

    await database.transaction(async (transaction) => {
      await transaction
        .update(settlements)
        .set({ status: "FAILED", failureMessage: message, updatedAt: now })
        .where(eq(settlements.paymentRequestId, request.id));

      await transaction
        .update(paymentRequests)
        .set({ state: "FAILED", updatedAt: now })
        .where(
          and(
            eq(paymentRequests.id, request.id),
            eq(paymentRequests.state, "SETTLING"),
          ),
        );

      await transaction.insert(auditEvents).values({
        paymentRequestId: request.id,
        eventType: "SETTLEMENT_FAILED",
        actorType: "SYSTEM",
        actorId: "stripe-adapter",
        payload: { message },
      });
    });

    throw error;
  }
}

export async function approvePaymentRequest(
  id: string,
  actorId: string,
  reason: string | undefined,
  dependencies: ServiceDependencies = {},
) {
  const database = dependencies.database ?? getDb();
  const transition = assertTransition("REVIEW_REQUIRED", "OPERATOR_APPROVED");

  const request = await database.transaction(async (transaction) => {
    const [updated] = await transaction
      .update(paymentRequests)
      .set({ state: transition.next, updatedAt: new Date() })
      .where(
        and(
          eq(paymentRequests.id, id),
          eq(paymentRequests.state, "REVIEW_REQUIRED"),
        ),
      )
      .returning();

    if (!updated) {
      const [current] = await transaction
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.id, id))
        .limit(1);

      if (!current) throw new NotFoundError("Payment request not found");
      assertTransition(current.state, "OPERATOR_APPROVED");
      throw new Error("Unreachable transition branch");
    }

    await transaction.insert(approvalDecisions).values({
      paymentRequestId: id,
      actorId,
      decision: "APPROVE",
      reason,
    });

    await transaction
      .insert(settlements)
      .values({
        paymentRequestId: id,
        amountCents: updated.amountCents,
        currency: updated.currency,
      })
      .onConflictDoNothing({ target: settlements.paymentRequestId });

    await transaction.insert(auditEvents).values({
      paymentRequestId: id,
      eventType: "OPERATOR_APPROVED",
      actorType: "OPERATOR",
      actorId,
      payload: { reason: reason ?? null, nextState: transition.next },
    });

    return updated;
  });

  await submitSettlement(
    request,
    dependencies.provider,
    database,
  );

  return getPaymentView(id, database);
}

export async function denyPaymentRequest(
  id: string,
  actorId: string,
  reason: string | undefined,
  database: Database = getDb(),
) {
  const transition = assertTransition("REVIEW_REQUIRED", "OPERATOR_DENIED");

  await database.transaction(async (transaction) => {
    const [updated] = await transaction
      .update(paymentRequests)
      .set({ state: transition.next, updatedAt: new Date() })
      .where(
        and(
          eq(paymentRequests.id, id),
          eq(paymentRequests.state, "REVIEW_REQUIRED"),
        ),
      )
      .returning();

    if (!updated) {
      const [current] = await transaction
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.id, id))
        .limit(1);

      if (!current) throw new NotFoundError("Payment request not found");
      assertTransition(current.state, "OPERATOR_DENIED");
      throw new Error("Unreachable transition branch");
    }

    await transaction.insert(approvalDecisions).values({
      paymentRequestId: id,
      actorId,
      decision: "DENY",
      reason,
    });

    await transaction.insert(auditEvents).values({
      paymentRequestId: id,
      eventType: "OPERATOR_DENIED",
      actorType: "OPERATOR",
      actorId,
      payload: { reason: reason ?? null, nextState: transition.next },
    });
  });

  return getPaymentView(id, database);
}

export async function processStripeEvent(
  event: {
    id: string;
    type: "payment_intent.succeeded" | "payment_intent.payment_failed";
    paymentIntentId: string;
    paymentRequestId?: string;
    amountCents: number;
    currency: string;
    payload: Record<string, unknown>;
  },
  database: Database = getDb(),
) {
  const [settlement] = event.paymentRequestId
    ? await database
        .select()
        .from(settlements)
        .where(eq(settlements.paymentRequestId, event.paymentRequestId))
        .limit(1)
    : await database
        .select()
        .from(settlements)
        .where(eq(settlements.providerPaymentId, event.paymentIntentId))
        .limit(1);

  const integrityFailures = settlement
    ? [
        settlement.providerPaymentId &&
        settlement.providerPaymentId !== event.paymentIntentId
          ? "provider_payment_id"
          : null,
        settlement.amountCents !== event.amountCents ? "amount" : null,
        settlement.currency !== event.currency.toUpperCase() ? "currency" : null,
      ].filter((value): value is string => Boolean(value))
    : [];

  return database.transaction(async (transaction) => {
    const [recordedEvent] = await transaction
      .insert(auditEvents)
      .values({
        paymentRequestId: settlement?.paymentRequestId,
        eventType:
          integrityFailures.length > 0
            ? "PROVIDER_PAYMENT_MISMATCH"
            : event.type === "payment_intent.succeeded"
            ? "PROVIDER_PAYMENT_SUCCEEDED"
            : "PROVIDER_PAYMENT_FAILED",
        actorType: "PROVIDER",
        actorId: "stripe",
        sourceEventId: event.id,
        payload: {
          ...event.payload,
          integrityFailures,
        },
      })
      .onConflictDoNothing({ target: auditEvents.sourceEventId })
      .returning();

    if (!recordedEvent) return { duplicate: true, matched: Boolean(settlement) };
    if (!settlement) return { duplicate: false, matched: false };
    if (integrityFailures.length > 0) {
      return {
        duplicate: false,
        matched: true,
        rejected: true,
        reason: "PROVIDER_PAYMENT_MISMATCH" as const,
      };
    }

    const succeeded = event.type === "payment_intent.succeeded";
    const nextState = succeeded ? "SETTLED" : "FAILED";
    const now = new Date();

    await transaction
      .update(settlements)
      .set({
        providerPaymentId: event.paymentIntentId,
        status: succeeded ? "SETTLED" : "FAILED",
        failureCode: succeeded ? null : "payment_intent.payment_failed",
        failureMessage: succeeded ? null : "Stripe reported a failed test payment",
        updatedAt: now,
      })
      .where(
        and(
          eq(settlements.id, settlement.id),
          inArray(settlements.status, ["PENDING", "PROCESSING"]),
        ),
      );

    await transaction
      .update(paymentRequests)
      .set({ state: nextState, updatedAt: now })
      .where(
        and(
          eq(paymentRequests.id, settlement.paymentRequestId),
          eq(paymentRequests.state, "SETTLING"),
        ),
      );

    return { duplicate: false, matched: true };
  });
}
