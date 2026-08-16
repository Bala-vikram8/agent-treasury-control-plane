import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PolicyRuleResult, PolicySnapshot } from "@/lib/domain/policy";

export const paymentStateEnum = pgEnum("payment_state", [
  "RECEIVED",
  "REVIEW_REQUIRED",
  "DENIED",
  "SETTLING",
  "SETTLED",
  "FAILED",
]);

export const policyDecisionEnum = pgEnum("policy_decision", [
  "AUTO_APPROVE",
  "REVIEW",
  "DENY",
]);

export const approvalDecisionEnum = pgEnum("approval_decision", [
  "APPROVE",
  "DENY",
]);

export const settlementStatusEnum = pgEnum("settlement_status", [
  "PENDING",
  "PROCESSING",
  "SETTLED",
  "FAILED",
]);

export const actorTypeEnum = pgEnum("actor_type", [
  "AGENT",
  "OPERATOR",
  "SYSTEM",
  "PROVIDER",
]);

export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: text("agent_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    merchant: text("merchant").notNull(),
    category: text("category").notNull(),
    purpose: text("purpose").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    riskScore: integer("risk_score").notNull(),
    state: paymentStateEnum("state").notNull().default("RECEIVED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_requests_agent_idempotency_unique").on(
      table.agentId,
      table.idempotencyKey,
    ),
    index("payment_requests_state_created_idx").on(table.state, table.createdAt),
    check("payment_requests_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "payment_requests_risk_score_range",
      sql`${table.riskScore} between 0 and 100`,
    ),
    check("payment_requests_currency_usd", sql`${table.currency} = 'USD'`),
  ],
);

export const policyEvaluations = pgTable(
  "policy_evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentRequestId: uuid("payment_request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    policyVersion: text("policy_version").notNull(),
    decision: policyDecisionEnum("decision").notNull(),
    projectedDailySpendCents: integer("projected_daily_spend_cents").notNull(),
    policySnapshot: jsonb("policy_snapshot").$type<PolicySnapshot>().notNull(),
    ruleResults: jsonb("rule_results").$type<PolicyRuleResult[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("policy_evaluations_request_unique").on(table.paymentRequestId),
  ],
);

export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentRequestId: uuid("payment_request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    decision: approvalDecisionEnum("decision").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("approval_decisions_request_unique").on(table.paymentRequestId),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentRequestId: uuid("payment_request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("stripe"),
    providerPaymentId: text("provider_payment_id"),
    status: settlementStatusEnum("status").notNull().default("PENDING"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("settlements_request_unique").on(table.paymentRequestId),
    uniqueIndex("settlements_provider_payment_unique").on(
      table.providerPaymentId,
    ),
    check("settlements_amount_positive", sql`${table.amountCents} > 0`),
    check("settlements_currency_usd", sql`${table.currency} = 'USD'`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentRequestId: uuid("payment_request_id").references(
      () => paymentRequests.id,
      { onDelete: "set null" },
    ),
    eventType: text("event_type").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    sourceEventId: text("source_event_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("audit_events_source_event_unique").on(table.sourceEventId),
    index("audit_events_request_created_idx").on(
      table.paymentRequestId,
      table.createdAt,
    ),
  ],
);

export type PaymentRequestRow = typeof paymentRequests.$inferSelect;
export type SettlementRow = typeof settlements.$inferSelect;
