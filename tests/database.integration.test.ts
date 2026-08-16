import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import { getDb, getPool, type Database } from "@/lib/db/client";
import {
  approvalDecisions,
  auditEvents,
  paymentRequests,
  settlements,
} from "@/lib/db/schema";
import {
  IdempotencyConflictError,
  ProviderConfigurationError,
  TransitionConflictError,
} from "@/lib/services/errors";
import {
  approvePaymentRequest,
  createPaymentRequest,
  processStripeEvent,
} from "@/lib/services/payment-service";
import { FakeSettlementProvider } from "@/tests/support/fake-settlement-provider";
import { GET as getHealth } from "@/app/api/health/route";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const suite = databaseAvailable ? describe : describe.skip;

suite("database integrity", () => {
  let database: Database;

  beforeAll(async () => {
    database = getDb();
    await migrate(database, { migrationsFolder: "drizzle" });
  });

  beforeEach(async () => {
    await database.execute(sql`
      truncate table audit_events, settlements, approval_decisions,
      policy_evaluations, payment_requests restart identity cascade
    `);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("creates one request and one provider call for concurrent duplicate submissions", async () => {
    const provider = new FakeSettlementProvider();
    const input = {
      agentId: "routepilot-client",
      idempotencyKey: "routepilot:concurrency:automatic",
      merchant: "CloudVector",
      category: "Cloud compute",
      purpose: "Batch inference capacity",
      amountCents: 1_825,
      currency: "USD" as const,
      riskScore: 12,
    };

    const results = await Promise.all([
      createPaymentRequest(input, { database, provider }),
      createPaymentRequest(input, { database, provider }),
    ]);
    const rows = await database.select().from(paymentRequests);

    expect(rows).toHaveLength(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("rejects an idempotency key reused with a different payload", async () => {
    const provider = new FakeSettlementProvider();
    const input = {
      agentId: "routepilot-client",
      idempotencyKey: "routepilot:idempotency:mismatch",
      merchant: "CloudVector",
      category: "Cloud compute",
      purpose: "Batch inference capacity",
      amountCents: 1_825,
      currency: "USD" as const,
      riskScore: 12,
    };

    await createPaymentRequest(input, { database, provider });

    await expect(
      createPaymentRequest(
        { ...input, amountCents: input.amountCents + 1 },
        { database, provider },
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const rows = await database.select().from(paymentRequests);
    expect(rows).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("serializes budget reservations for different concurrent requests", async () => {
    const provider = new FakeSettlementProvider();

    for (let index = 0; index < 5; index += 1) {
      await createPaymentRequest(
        {
          agentId: "routepilot-budget-agent",
          idempotencyKey: `routepilot:budget:reserved:${index}`,
          merchant: "CloudVector",
          category: "Cloud compute",
          purpose: `Reserved capacity request ${index}`,
          amountCents: 9_800,
          currency: "USD",
          riskScore: 31,
        },
        { database, provider },
      );
    }

    const results = await Promise.all([
      createPaymentRequest(
        {
          agentId: "routepilot-budget-agent",
          idempotencyKey: "routepilot:budget:concurrent:a",
          merchant: "CloudVector",
          category: "Cloud compute",
          purpose: "Concurrent capacity request A",
          amountCents: 600,
          currency: "USD",
          riskScore: 12,
        },
        { database, provider },
      ),
      createPaymentRequest(
        {
          agentId: "routepilot-budget-agent",
          idempotencyKey: "routepilot:budget:concurrent:b",
          merchant: "CloudVector",
          category: "Cloud compute",
          purpose: "Concurrent capacity request B",
          amountCents: 600,
          currency: "USD",
          riskScore: 12,
        },
        { database, provider },
      ),
    ]);

    expect(results.map((result) => result.payment!.request.state).sort()).toEqual([
      "DENIED",
      "SETTLING",
    ]);
    expect(provider.calls).toHaveLength(1);
  });

  it("marks settlement failed when the provider is not configured", async () => {
    const originalKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    try {
      await expect(
        createPaymentRequest(
          {
            agentId: "routepilot-client",
            idempotencyKey: "routepilot:provider:not-configured",
            merchant: "CloudVector",
            category: "Cloud compute",
            purpose: "Provider configuration boundary",
            amountCents: 1_825,
            currency: "USD",
            riskScore: 12,
          },
          { database },
        ),
      ).rejects.toBeInstanceOf(ProviderConfigurationError);

      const [request] = await database
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.idempotencyKey, "routepilot:provider:not-configured"));
      const [settlement] = await database
        .select()
        .from(settlements)
        .where(eq(settlements.paymentRequestId, request.id));

      expect(request.state).toBe("FAILED");
      expect(settlement.status).toBe("FAILED");
    } finally {
      if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalKey;
    }
  });

  it("reports database readiness through the health endpoint", async () => {
    const response = await getHealth();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      database: "reachable",
    });
  });

  it("enforces financial constraints in the database", async () => {
    await expect(
      database.insert(paymentRequests).values({
        agentId: "routepilot-client",
        idempotencyKey: "routepilot:constraint:negative",
        merchant: "CloudVector",
        category: "Cloud compute",
        purpose: "Invalid direct database write",
        amountCents: -1,
        currency: "USD",
        riskScore: 12,
      }),
    ).rejects.toThrow();

    const created = await createPaymentRequest(
      {
        agentId: "routepilot-client",
        idempotencyKey: "routepilot:constraint:decision",
        merchant: "OrbitRoute Maps",
        category: "Mapping API",
        purpose: "Decision uniqueness boundary",
        amountCents: 4_280,
        currency: "USD",
        riskScore: 31,
      },
      { database, provider: new FakeSettlementProvider() },
    );
    const paymentRequestId = created.payment!.request.id;

    await database.insert(approvalDecisions).values({
      paymentRequestId,
      actorId: "operator-one",
      decision: "APPROVE",
    });
    await expect(
      database.insert(approvalDecisions).values({
        paymentRequestId,
        actorId: "operator-two",
        decision: "DENY",
      }),
    ).rejects.toThrow();
  });

  it("allows one of two simultaneous approval attempts to create settlement", async () => {
    const provider = new FakeSettlementProvider();
    const created = await createPaymentRequest(
      {
        agentId: "routepilot-client",
        idempotencyKey: "routepilot:concurrency:review",
        merchant: "OrbitRoute Maps",
        category: "Mapping API",
        purpose: "Emergency route optimization credits",
        amountCents: 4_280,
        currency: "USD",
        riskScore: 31,
      },
      { database, provider },
    );
    const id = created.payment?.request.id;
    expect(id).toBeTruthy();

    const results = await Promise.allSettled([
      approvePaymentRequest(id!, "operator-one", undefined, { database, provider }),
      approvePaymentRequest(id!, "operator-two", undefined, { database, provider }),
    ]);

    const settlementRows = await database
      .select()
      .from(settlements)
      .where(eq(settlements.paymentRequestId, id!));
    const decisionRows = await database
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.paymentRequestId, id!));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected")?.reason,
    ).toBeInstanceOf(TransitionConflictError);
    expect(settlementRows).toHaveLength(1);
    expect(decisionRows).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("deduplicates a replayed Stripe event", async () => {
    const provider = new FakeSettlementProvider();
    const created = await createPaymentRequest(
      {
        agentId: "routepilot-client",
        idempotencyKey: "routepilot:webhook:review",
        merchant: "OrbitRoute Maps",
        category: "Mapping API",
        purpose: "Emergency route optimization credits",
        amountCents: 4_280,
        currency: "USD",
        riskScore: 31,
      },
      { database, provider },
    );
    const id = created.payment!.request.id;
    await approvePaymentRequest(id, "operator", undefined, { database, provider });
    const [settlement] = await database
      .select()
      .from(settlements)
      .where(eq(settlements.paymentRequestId, id));

    const event = {
      id: "evt_replayed_once",
      type: "payment_intent.succeeded" as const,
      paymentIntentId: settlement.providerPaymentId!,
      amountCents: settlement.amountCents,
      currency: settlement.currency,
      payload: { providerStatus: "succeeded" },
    };
    const first = await processStripeEvent(event, database);
    const replay = await processStripeEvent(event, database);
    const events = await database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.sourceEventId, event.id));

    expect(first).toEqual({ duplicate: false, matched: true });
    expect(replay).toEqual({ duplicate: true, matched: true });
    expect(events).toHaveLength(1);
  });

  it("rejects a signed provider event whose financial details do not match", async () => {
    const provider = new FakeSettlementProvider();
    const created = await createPaymentRequest(
      {
        agentId: "routepilot-client",
        idempotencyKey: "routepilot:webhook:mismatch",
        merchant: "OrbitRoute Maps",
        category: "Mapping API",
        purpose: "Provider integrity boundary",
        amountCents: 4_280,
        currency: "USD",
        riskScore: 31,
      },
      { database, provider },
    );
    const id = created.payment!.request.id;
    await approvePaymentRequest(id, "operator", undefined, { database, provider });
    const [settlement] = await database
      .select()
      .from(settlements)
      .where(eq(settlements.paymentRequestId, id));

    const result = await processStripeEvent(
      {
        id: "evt_amount_mismatch",
        type: "payment_intent.succeeded",
        paymentIntentId: settlement.providerPaymentId!,
        amountCents: settlement.amountCents + 1,
        currency: settlement.currency,
        payload: { providerStatus: "succeeded" },
      },
      database,
    );
    const [requestAfter] = await database
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id));
    const [settlementAfter] = await database
      .select()
      .from(settlements)
      .where(eq(settlements.paymentRequestId, id));

    expect(result).toEqual({
      duplicate: false,
      matched: true,
      rejected: true,
      reason: "PROVIDER_PAYMENT_MISMATCH",
    });
    expect(requestAfter.state).toBe("SETTLING");
    expect(settlementAfter.status).toBe("PROCESSING");
  });
});
