# Interview Defense Guide

## What did you build?

I built a policy controlled workflow for machine initiated test payments. A standalone client submits a request, PostgreSQL guarantees idempotency, the policy engine decides whether it is automatically approved, reviewed, or denied, and approved requests create Stripe sandbox PaymentIntents. Signed Stripe webhooks provide final outcomes. No real funds move through the system.

## Why is a unique constraint better than checking first?

A check followed by an insert contains a race. Two requests can both observe that a key does not exist and both insert. A database unique constraint makes the write atomic and gives the database final authority.

An idempotency key is bound to one payload. An identical retry returns the existing result, while a different payload with the same key returns a conflict. Otherwise a caller could change the amount and incorrectly receive an unrelated earlier result.

## How does the daily budget handle unsettled requests?

Requests awaiting review or settlement reserve budget capacity, and settled requests remain committed for the day. Denied and failed requests do not count. A transaction scoped advisory lock serializes policy evaluation for each agent so concurrent requests cannot approve against the same remaining balance.

## What happens when two operators approve together?

The update includes `state = REVIEW_REQUIRED` in its predicate. One update changes the state to `SETTLING`. The other update affects zero rows and receives a `409` conflict. Only the winner inserts the approval and settlement records.

## Why not call Stripe inside the transaction?

Holding a database transaction open during a network request increases lock time and still cannot make PostgreSQL and Stripe one atomic system. The MVP records intent first, calls Stripe afterward, and uses idempotency at both boundaries.

## What failure remains?

Stripe might complete a request while the application times out and records failure. A production system would use a durable outbox worker and reconciliation process. The MVP documents this instead of claiming production grade guarantees.

## Why does the webhook use request metadata?

The webhook might arrive before the application stores the Stripe PaymentIntent id. Metadata containing the internal request id lets the webhook locate the pending settlement despite that race.

## Why are webhook events deduplicated?

Providers retry webhook delivery. A unique source event id ensures that replaying the same event does not repeat a state transition or audit entry.

## Is signature verification enough for settlement?

No. A valid signature authenticates Stripe, but the service must still verify that the PaymentIntent belongs to the expected obligation. The handler compares the provider id when available, amount, and currency with the settlement row. A mismatch is audited and rejected without changing financial state.

## Is the agent actually autonomous?

No. It is a machine client that initiates authorization requests without a browser. The project demonstrates agent initiated workflow control, not autonomous commercial purchasing or artificial intelligence reasoning.

## Why Stripe rather than blockchain?

Stripe sandbox provides a real external API, signed asynchronous events, provider idempotency, failure states, and a verifiable test environment. Blockchain settlement would add key custody and chain specific concerns before the control plane itself was reliable.

## What would you build next?

I would add a durable outbox processor, settlement reconciliation, managed user identity, configurable policies, and operational metrics. I would not add those until usage justified the complexity.
