import { afterEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { POST } from "@/app/api/webhooks/stripe/route";

const originalStripeKey = process.env.STRIPE_SECRET_KEY;
const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalStripeKey;

  if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
});

describe("Stripe webhook boundary", () => {
  const secret = "whsec_test_signature_secret";
  const payload = JSON.stringify({
    id: "evt_signature_test",
    object: "event",
    type: "customer.created",
    data: { object: { id: "cus_test" } },
  });

  it("accepts a valid signed event and ignores unsupported event types", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_route_verification_only";
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });

    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: payload,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
  });

  it("rejects an invalid signature before processing the event", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_route_verification_only";
    process.env.STRIPE_WEBHOOK_SECRET = secret;

    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "invalid" },
        body: payload,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_WEBHOOK_SIGNATURE",
    });
  });
});
