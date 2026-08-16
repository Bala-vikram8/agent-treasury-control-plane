import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import type { PaymentRequestRow } from "@/lib/db/schema";
import { ProviderConfigurationError } from "@/lib/services/errors";
import { StripeSandboxProvider } from "@/lib/services/settlement-provider";

const request = {
  id: "2b93d1a8-17f2-4f27-bc6f-aad3f7b821de",
  agentId: "routepilot-client",
  idempotencyKey: "routepilot:provider:unit",
  merchant: "CloudVector",
  category: "Cloud compute",
  purpose: "Batch inference capacity",
  amountCents: 1_825,
  currency: "USD",
  riskScore: 12,
  state: "SETTLING",
  createdAt: new Date("2026-08-13T12:00:00Z"),
  updatedAt: new Date("2026-08-13T12:00:00Z"),
} satisfies PaymentRequestRow;

describe("Stripe sandbox settlement adapter", () => {
  it("rejects a live Stripe key", () => {
    expect(
      () => new StripeSandboxProvider(["sk", "live", "forbidden"].join("_")),
    ).toThrow(ProviderConfigurationError);
  });

  it("creates a confirmed test PaymentIntent with provider idempotency", async () => {
    let capturedParams: Stripe.PaymentIntentCreateParams | undefined;
    let capturedOptions: Stripe.RequestOptions | undefined;
    const stripeClient = {
      paymentIntents: {
        async create(
          params: Stripe.PaymentIntentCreateParams,
          options?: Stripe.RequestOptions,
        ) {
          capturedParams = params;
          capturedOptions = options;
          return {
            id: "pi_sandbox_verified",
            status: "processing",
          } as Stripe.PaymentIntent;
        },
      },
    };
    const provider = new StripeSandboxProvider(
      "sk_test_unit_boundary",
      stripeClient,
    );

    const result = await provider.createTestPayment(request);

    expect(result).toEqual({
      providerPaymentId: "pi_sandbox_verified",
      providerStatus: "processing",
    });
    expect(capturedParams).toMatchObject({
      amount: request.amountCents,
      currency: "usd",
      payment_method: "pm_card_visa",
      confirm: true,
      metadata: {
        payment_request_id: request.id,
        agent_id: request.agentId,
        merchant: request.merchant,
      },
    });
    expect(capturedOptions).toEqual({
      idempotencyKey: `settlement:${request.id}`,
    });
  });
});
