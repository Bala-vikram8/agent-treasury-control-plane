# Architecture Decisions

## Accurate product claim

The system authorizes machine initiated Stripe sandbox payments. It does not autonomously transfer money to external vendors and it does not move real funds.

## Why PostgreSQL owns idempotency

The application does not perform a separate check followed by an insert. That pattern races when two requests arrive together.

`payment_requests` has a unique index on `(agent_id, idempotency_key)`. The insert uses `ON CONFLICT DO NOTHING`, then returns the existing request when the key has already been used. The database decides which request wins.

The service compares the existing request with the retry payload. An identical retry returns the original result. A changed amount, merchant, purpose, category, currency, or risk score returns `IDEMPOTENCY_KEY_REUSED` rather than silently treating different work as the same request.

## Why requests for one agent are serialized

Two different requests for the same agent could otherwise evaluate the daily budget from the same starting balance. The creation transaction obtains a PostgreSQL transaction scoped advisory lock derived from `agent_id` before calculating commitments.

The budget calculation reserves requests in `REVIEW_REQUIRED` and `SETTLING` and counts requests in `SETTLED`. Failed and denied requests release their capacity. This keeps the implementation small while preventing two simultaneous requests from independently consuming the same remaining budget.

## Why approval uses compare and set

Approval is a single update with both the request id and expected `REVIEW_REQUIRED` state in the database predicate.

Only one concurrent operator can change the row to `SETTLING`. A second attempt updates zero rows and receives a structured conflict containing the current state and attempted event.

## Why Stripe receives another idempotency key

The internal request unique constraint protects the database. Stripe receives `settlement:<payment_request_id>` as its own idempotency key so a repeated provider request maps to the first provider result.

These protections solve different failure boundaries and both are necessary.

## Why webhook metadata contains the request id

A Stripe webhook can arrive before the original HTTP request stores the provider payment id. Every PaymentIntent therefore contains `payment_request_id` metadata.

The webhook handler can match a settlement through that metadata even if the provider id update has not finished. The later update only changes settlements that remain `PENDING`, so it cannot overwrite an earlier webhook outcome.

## Why webhook event ids are unique

Stripe can deliver the same event more than once. `audit_events.source_event_id` is unique, and webhook processing begins with an insert using `ON CONFLICT DO NOTHING`.

If the event id already exists, the handler returns success without applying another transition.

## Why a valid webhook signature is not enough

A signature proves that Stripe sent the event. It does not prove that the event belongs to the expected internal obligation. Before applying a terminal state, the service compares the PaymentIntent id when already known, amount, and currency with the settlement row. A mismatch is recorded as `PROVIDER_PAYMENT_MISMATCH` and cannot settle the request.

## Why there is no outbox worker

The MVP records `SETTLING` and its settlement row before calling Stripe. This prevents an untracked provider attempt but does not eliminate every ambiguous timeout scenario.

A production system would commit a durable outbox message with the state transition. A worker would call Stripe, retry safely, and reconcile uncertain results. This project documents that next step instead of pretending the failure window does not exist.

## Why authentication is intentionally small

The machine client presents a constant time compared service token. The server binds that credential to the configured `AGENT_ID` and rejects a payload that claims another identity. Without that binding, a caller could change `agent_id` to escape its per agent budget. The operator signs in with one password and receives a signed HTTP only cookie.

This demonstrates separation between machine and human authority without introducing a multi role identity platform that is outside the portfolio scope.
