# Agent Treasury Control Plane

[![Continuous Integration](https://github.com/Bala-vikram8/agent-treasury-control-plane/actions/workflows/ci.yml/badge.svg)](https://github.com/Bala-vikram8/agent-treasury-control-plane/actions/workflows/ci.yml)

Agent Treasury is a portfolio project that demonstrates a policy controlled workflow for machine initiated test payments.

RoutePilot, a standalone machine client, submits payment authorization requests. The server evaluates treasury policy, automatically handles safe and prohibited requests, and pauses exceptions for an operator. Approved requests create Stripe sandbox PaymentIntents. Signed Stripe webhooks provide the final settlement outcome.

This application does not transfer cryptocurrency, pay external vendors, or move real funds.

## Product walkthrough

The screenshot below demonstrates the human review path. RoutePilot requested authorization for a $42.80 test payment. The merchant, category, daily budget, and risk checks passed, but the amount exceeded the $25.00 automatic approval limit. The system therefore paused the request for an operator decision.

[![Human review dashboard showing policy evaluation and operator approval controls](docs/screenshots/human_review.png)](docs/screenshots/human_review.png)

*Human review dashboard backed by PostgreSQL records. Select the image to open it at full resolution.*

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
Database unique constraint
    ↓
Policy evaluation
    ├── AUTO_APPROVE ───────→ Stripe sandbox PaymentIntent
    ├── REVIEW_REQUIRED ────→ Operator approval or denial
    └── DENIED ─────────────→ Request stopped
                                  ↓
                        Signed Stripe webhook
                                  ↓
                         SETTLED or FAILED
```

## Payment states

```text
RECEIVED
    ├── SETTLING
    ├── REVIEW_REQUIRED
    └── DENIED

REVIEW_REQUIRED
    ├── SETTLING
    └── DENIED

SETTLING
    ├── SETTLED
    └── FAILED
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
6. Amounts must be positive.
7. Risk scores must be between zero and one hundred.
8. The current MVP accepts USD only.
9. Every provider payment ID is unique.
10. Every Stripe event ID is unique in the audit trail.

## Local setup

### Requirements

1. Node.js 22.13 or later
2. Docker with Docker Compose
3. A Stripe sandbox account
4. Stripe CLI

### Configure the application

```bash
cp .env.example .env
npm install
```

Replace the demonstration values in `.env`. Only Stripe sandbox secret keys beginning with `sk_test_` are accepted.

Generate secure local secrets instead of committing them to Git.

```bash
openssl rand -hex 32
```

The local `.env` file must contain values for:

```text
DATABASE_URL
DATABASE_SSL
AGENT_SERVICE_TOKEN
AGENT_ID
OPERATOR_PASSWORD
SESSION_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PAYMENT_METHOD
APP_URL
```

Never commit `.env` or any Stripe secret to the repository.

### Start PostgreSQL

```bash
docker compose up -d database
npm run db:migrate
```

To run the database, schema migration, and application as one container stack, use:

```bash
docker compose up --build
```

The migration container must complete successfully before the application starts. The application health check verifies a real database query through `/api/health`.

### Start the application

Open one Terminal window and run:

```bash
npm run dev
```

Open `http://localhost:3000` and sign in using the value configured as `OPERATOR_PASSWORD`.

Keep this Terminal window running.

### Forward Stripe sandbox webhooks

Open a second Terminal window and run:

```bash
cd ~/Downloads/agent-treasury-control-plane
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the webhook signing secret printed by Stripe CLI into `STRIPE_WEBHOOK_SECRET` in `.env`.

The webhook secret begins with:

```text
whsec_
```

Restart the application after changing the webhook secret.

Keep the Stripe listener running while testing settlements.

### Run the machine client

Open a third Terminal window and run:

```bash
cd ~/Downloads/agent-treasury-control-plane
unset DEMO_RUN_ID
npm run demo:agent
```

The client submits three scenarios:

1. Automatic approval
2. Human review
3. Automatic denial

The command prints a demo run ID. Reuse that ID to prove that retrying the same request does not create another database record.

```bash
DEMO_RUN_ID=the_printed_value npm run demo:agent
```

The repeated execution should return the existing records with `created: false`.

## Verification

Run the fast unit suite:

```bash
npm test
```

Run the complete local verification gate:

```bash
npm run check
```

The gate runs:

1. ESLint
2. TypeScript type checking
3. Unit tests
4. Production build

### PostgreSQL integration tests

Create the isolated test database once:

```bash
docker exec agent-treasury-control-plane-database-1 createdb -U postgres agent_treasury_test
```

Run the PostgreSQL integration suite:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agent_treasury_test DATABASE_SSL=false npx vitest run tests/database.integration.test.ts
```

The integration suite verifies:

1. Concurrent duplicate request handling
2. Idempotency payload conflicts
3. Daily budget serialization
4. Settlement failure handling
5. Database health reporting
6. Financial constraints
7. Simultaneous approval protection
8. Stripe webhook replay protection
9. Provider event identity validation

### Production smoke test

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agent_treasury_test DATABASE_SSL=false npm run test:smoke
```

The smoke test launches the compiled production server and verifies machine authentication, request creation, identical replay, changed payload conflict handling, an operator decision, security headers, health reporting, and persisted dashboard data.

GitHub Actions starts a PostgreSQL service and runs migrations, tests, type checking, linting, the production build, and the production server smoke test.

## Security boundaries

1. The machine client uses `AGENT_SERVICE_TOKEN` and can create requests only.
2. The configured `AGENT_ID` binds that credential to one database identity.
3. The caller cannot bypass its budget by changing `agentId`.
4. The operator uses a signed HTTP only session cookie.
5. Stripe webhook signatures are verified before events are processed.
6. Stripe event IDs are stored uniquely so replayed events become no operations.
7. Stripe live keys are intentionally rejected.
8. Secrets belong in environment variables and must never enter the repository.

## Deliberate limitations

This is a focused portfolio system, not a production fintech platform.

1. It supports one policy and one operator role.
2. It uses Stripe sandbox only.
3. It does not contain multi tenancy, cryptocurrency, payouts, a double entry ledger, or a message queue.
4. Settlement submission occurs after the database transaction without a durable outbox worker.
5. A production version would add an outbox processor so a provider timeout cannot leave an ambiguous settlement outcome.
6. A production version would add reconciliation jobs, stronger identity management, policy administration, and operational monitoring.
7. The single operator login has no distributed brute force protection or account recovery workflow.
8. The settlement model permits one PaymentIntent confirmation attempt.
9. It does not recover a failed PaymentIntent and later apply a newer provider state.

These limitations are documented engineering decisions, not hidden claims.

## Important code paths

1. `lib/db/schema.ts` defines database invariants.
2. `lib/domain/state-machine.ts` defines legal transitions.
3. `lib/domain/policy.ts` evaluates payment policy.
4. `lib/services/payment-service.ts` coordinates transactions and settlement.
5. `lib/services/settlement-provider.ts` integrates Stripe sandbox.
6. `app/api/webhooks/stripe/route.ts` verifies provider events.
7. `scripts/agent-client.ts` acts as the machine client.
8. `tests/database.integration.test.ts` proves concurrency behavior.

## Additional documentation

1. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains the implementation decisions.
2. [`docs/INTERVIEW_GUIDE.md`](docs/INTERVIEW_GUIDE.md) contains the technical questions this project should withstand.

## External references

1. [Stripe sandbox testing](https://docs.stripe.com/testing)
2. [Stripe webhook signatures, retries, and event ordering](https://docs.stripe.com/webhooks)
3. [Stripe idempotent request guidance](https://docs.stripe.com/error-low-level#idempotency)

## License

This project is available under the terms in [`LICENSE`](LICENSE).
