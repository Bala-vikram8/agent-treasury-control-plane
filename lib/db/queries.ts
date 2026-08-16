import { desc, eq, gte, sql } from "drizzle-orm";
import { getDb, type Database } from "./client";
import {
  auditEvents,
  paymentRequests,
  policyEvaluations,
  settlements,
} from "./schema";
import { defaultPolicy } from "@/lib/domain/policy";

export async function getPaymentView(id: string, database: Database = getDb()) {
  const [row] = await database
    .select({
      request: paymentRequests,
      evaluation: policyEvaluations,
      settlement: settlements,
    })
    .from(paymentRequests)
    .leftJoin(
      policyEvaluations,
      eq(policyEvaluations.paymentRequestId, paymentRequests.id),
    )
    .leftJoin(settlements, eq(settlements.paymentRequestId, paymentRequests.id))
    .where(eq(paymentRequests.id, id))
    .limit(1);

  return row ?? null;
}

export async function listPaymentViews(database: Database = getDb(), limit = 50) {
  return database
    .select({
      request: paymentRequests,
      evaluation: policyEvaluations,
      settlement: settlements,
    })
    .from(paymentRequests)
    .leftJoin(
      policyEvaluations,
      eq(policyEvaluations.paymentRequestId, paymentRequests.id),
    )
    .leftJoin(settlements, eq(settlements.paymentRequestId, paymentRequests.id))
    .orderBy(desc(paymentRequests.createdAt))
    .limit(limit);
}

function startOfUtcDay() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function getDashboardData(database: Database = getDb()) {
  const start = startOfUtcDay();
  const [summary] = await database
    .select({
      requestCount: sql<number>`count(distinct ${paymentRequests.id})::int`,
      pendingCount: sql<number>`count(distinct ${paymentRequests.id}) filter (where ${paymentRequests.state} = 'REVIEW_REQUIRED')::int`,
      deniedCount: sql<number>`count(distinct ${paymentRequests.id}) filter (where ${paymentRequests.state} = 'DENIED')::int`,
      settledCount: sql<number>`count(distinct ${paymentRequests.id}) filter (where ${paymentRequests.state} = 'SETTLED')::int`,
      settledCents: sql<number>`coalesce(sum(${settlements.amountCents}) filter (where ${settlements.status} = 'SETTLED'), 0)::int`,
      pendingCents: sql<number>`coalesce(sum(${paymentRequests.amountCents}) filter (where ${paymentRequests.state} = 'REVIEW_REQUIRED'), 0)::int`,
      reservedCents: sql<number>`coalesce(sum(${paymentRequests.amountCents}) filter (where ${paymentRequests.state} in ('REVIEW_REQUIRED', 'SETTLING')), 0)::int`,
      deniedCents: sql<number>`coalesce(sum(${paymentRequests.amountCents}) filter (where ${paymentRequests.state} = 'DENIED'), 0)::int`,
    })
    .from(paymentRequests)
    .leftJoin(settlements, eq(settlements.paymentRequestId, paymentRequests.id))
    .where(gte(paymentRequests.createdAt, start));

  const [latestPolicy] = await database
    .select({ snapshot: policyEvaluations.policySnapshot })
    .from(policyEvaluations)
    .orderBy(desc(policyEvaluations.createdAt))
    .limit(1);

  const requests = await listPaymentViews(database, 20);
  const audit = await database
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(12);

  const policy = latestPolicy?.snapshot ?? defaultPolicy;
  const settledCents = Number(summary?.settledCents ?? 0);
  const pendingCents = Number(summary?.pendingCents ?? 0);
  const reservedCents = Number(summary?.reservedCents ?? 0);
  const committedCents = settledCents + reservedCents;

  return {
    summary: {
      requestCount: Number(summary?.requestCount ?? 0),
      pendingCount: Number(summary?.pendingCount ?? 0),
      deniedCount: Number(summary?.deniedCount ?? 0),
      settledCount: Number(summary?.settledCount ?? 0),
      settledCents,
      pendingCents,
      reservedCents,
      committedCents,
      deniedCents: Number(summary?.deniedCents ?? 0),
      dailyBudgetCents: policy.dailyBudgetCents,
      availableCents: Math.max(policy.dailyBudgetCents - committedCents, 0),
    },
    policy,
    requests,
    audit,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
