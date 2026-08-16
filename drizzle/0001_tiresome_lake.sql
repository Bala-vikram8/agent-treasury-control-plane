DROP INDEX "approval_decisions_request_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_request_unique" ON "approval_decisions" USING btree ("payment_request_id");--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_amount_positive" CHECK ("payment_requests"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_risk_score_range" CHECK ("payment_requests"."risk_score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_currency_usd" CHECK ("payment_requests"."currency" = 'USD');--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amount_positive" CHECK ("settlements"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_currency_usd" CHECK ("settlements"."currency" = 'USD');