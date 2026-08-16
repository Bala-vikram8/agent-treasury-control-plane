CREATE TYPE "public"."actor_type" AS ENUM('AGENT', 'OPERATOR', 'SYSTEM', 'PROVIDER');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('APPROVE', 'DENY');--> statement-breakpoint
CREATE TYPE "public"."payment_state" AS ENUM('RECEIVED', 'REVIEW_REQUIRED', 'DENIED', 'SETTLING', 'SETTLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."policy_decision" AS ENUM('AUTO_APPROVE', 'REVIEW', 'DENY');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('PENDING', 'PROCESSING', 'SETTLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_request_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_request_id" uuid,
	"event_type" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"source_event_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"merchant" text NOT NULL,
	"category" text NOT NULL,
	"purpose" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"risk_score" integer NOT NULL,
	"state" "payment_state" DEFAULT 'RECEIVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_request_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"decision" "policy_decision" NOT NULL,
	"projected_daily_spend_cents" integer NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"rule_results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_request_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_payment_id" text,
	"status" "settlement_status" DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_evaluations" ADD CONSTRAINT "policy_evaluations_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_decisions_request_idx" ON "approval_decisions" USING btree ("payment_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_source_event_unique" ON "audit_events" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "audit_events_request_created_idx" ON "audit_events" USING btree ("payment_request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_agent_idempotency_unique" ON "payment_requests" USING btree ("agent_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_requests_state_created_idx" ON "payment_requests" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_evaluations_request_unique" ON "policy_evaluations" USING btree ("payment_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_request_unique" ON "settlements" USING btree ("payment_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_provider_payment_unique" ON "settlements" USING btree ("provider_payment_id");