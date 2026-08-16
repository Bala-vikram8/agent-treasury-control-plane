# Agent Treasury Control Plane

Agent Treasury is a portfolio project that demonstrates a policy controlled workflow for machine initiated test payments.

RoutePilot, a standalone machine client, submits a payment authorization request. The server evaluates treasury policy, automatically handles safe and prohibited requests, and pauses exceptions for an operator. Approved requests create Stripe sandbox PaymentIntents. Stripe webhooks provide the final settlement outcome.

This application does not transfer cryptocurrency, pay external vendors, or move real funds.

## What this project demonstrates

1. PostgreSQL persistence through Drizzle ORM
2. Database enforced idempotency
3. Explicit and testable payment state transitions
4. Atomic protection against simultaneous approval attempts
5. Per agent serialization and reservation aware daily budget evaluation
6. Stripe sandbox PaymentIntent creation
7. Signed webhook verification and event replay protection
8. Webhook amount, currency, and provider identity verification
9. Separate machine and operator credentials
10. Dashboard metrics derived from database queries
11. Database health checks and migration gated Docker startup
12. Docker deployment and GitHub Actions verification

## System flow

```text
Machine client
    ↓
POST /api/payment-requests
    ↓
Database unique constraint and policy evaluation
    ↓
AUTO_APPROVE     REVIEW_REQUIRED     DENIED
    ↓                    ↓
Stripe sandbox      Operator decision
    ↓                    ↓
Signed webhook      Stripe sandbox or denial
    ↓
SETTLED or FAILED
```

## Payment states

```text
RECEIVED
    → SETTLING
    → REVIEW_REQUIRED
    → DENIED

REVIEW_REQUIRED
    → SETTLING
    → DENIED

SETTLING
    → SETTLED
    → FAILED
```

Illegal transitions return a structured `TRANSITION_NOT_ALLOWED` conflict. They never silently succeed.

## Database design

The project intentionally uses five business tables.

1. `payment_requests`
2. `policy_evaluations`
3. `approval_decisions`
4. `settlements`
5. `audit_events`

The database owns the critical invariants.

1. `(agent_id, idempotency_key)` is unique.
2. Reusing an idempotency key with a different payload returns a conflict.
3. Every payment request has at most one policy evaluation.
4. Every payment request has at most one operator decision.
5. Every payment request has at most one settlement.
6. Amounts must be positive, risk scores must be between zero and one hundred, and this MVP accepts USD only.
7. Every provider payment id is unique.
8. Every Stripe event id is unique in the audit trail.

## Local setup

### Requirements

1. Node.js 22.13 or later
2. Docker with Docker Compose
3. A Stripe sandbox account and Stripe CLI

### Configure the application

```bash
cp .env.example .env
npm install
```

Replace the demonstration values in `.env`. Only Stripe sandbox keys beginning with `sk_test_` are accepted.

Generate secure local secrets rather than committing them to Git.

```bash
openssl rand -hex 32
```

### Start PostgreSQL

```bash
docker compose up -d database
npm run db:migrate
```

To run the database, schema migration, and application as one container stack instead, use:

```bash
docker compose up --build
```

The migration container must complete successfully before the application starts. The application health check verifies a database query through `/api/health`.

### Start the application

```bash
npm run dev
```

Open `http://localhost:3000` and sign in with `OPERATOR_PASSWORD`.

### Forward Stripe sandbox webhooks

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the webhook signing secret printed by Stripe CLI into `STRIPE_WEBHOOK_SECRET`, then restart the application.

### Run the machine client

```bash
npm run demo:agent
```

The client submits automatic approval, human review, and automatic denial scenarios.

The command prints a demo run id. Reuse it to prove that retrying a request does not create another database record.

```bash
DEMO_RUN_ID=the_printed_value npm run demo:agent
```

## Verification

Run the fast unit suite without a database.

```bash
npm test
```

When `DATABASE_URL` is available, the same command also executes PostgreSQL integration tests for concurrent duplicate submissions, simultaneous approvals, and webhook replay protection.

Run the complete local gate.

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:smoke
```

The smoke test launches the compiled production server and verifies machine authentication, request creation, identical replay, changed payload conflict handling, an operator decision, security headers, health reporting, and persisted dashboard data.

GitHub Actions starts a real PostgreSQL service and runs migrations, all tests, type checking, linting, the production build, and the production server smoke test.

## Security boundaries

1. The machine client uses `AGENT_SERVICE_TOKEN` and can create requests only.
2. The configured `AGENT_ID` binds that credential to one database identity, so the caller cannot bypass its budget by changing `agentId`.
3. The operator uses a signed, HTTP only session cookie.
4. Stripe webhook signatures are verified before any event is processed.
5. Stripe event ids are stored uniquely so replayed events become no operations.
6. Stripe live keys are rejected intentionally.
7. Secrets belong in environment variables and must never enter the repository.

## Deliberate limitations

This is a right sized portfolio system, not a production fintech platform.

1. It supports one policy and one operator role.
2. It uses Stripe sandbox only.
3. It does not contain multi tenancy, cryptocurrency, payouts, a double entry ledger, or a message queue.
4. Settlement submission occurs after the database transaction without a durable outbox worker.
5. A production version would add an outbox processor so a provider timeout cannot leave an ambiguous settlement outcome.
6. A production version would add reconciliation jobs, stronger identity management, policy administration, and operational monitoring.
7. The single operator login has no distributed brute force protection or account recovery workflow.
8. The settlement model permits one PaymentIntent confirmation attempt. It does not recover a failed intent and later apply a newer provider state.

These limitations are documented decisions, not hidden claims.

## External references

1. [Stripe sandbox testing](https://docs.stripe.com/testing)
2. [Stripe webhook signatures, retries, and event ordering](https://docs.stripe.com/webhooks)
3. [Stripe idempotent request guidance](https://docs.stripe.com/error-low-level#idempotency)

## Important code paths

1. `lib/db/schema.ts` defines database invariants.
2. `lib/domain/state-machine.ts` defines legal transitions.
3. `lib/domain/policy.ts` evaluates payment policy.
4. `lib/services/payment-service.ts` coordinates transactions and settlement.
5. `lib/services/settlement-provider.ts` integrates Stripe sandbox.
6. `app/api/webhooks/stripe/route.ts` verifies provider events.
7. `scripts/agent-client.ts` acts as the machine client.
8. `tests/database.integration.test.ts` proves concurrency behavior.

See `docs/ARCHITECTURE.md` for implementation decisions and `docs/INTERVIEW_GUIDE.md` for the questions this project should be able to withstand.
