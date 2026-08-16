import Stripe from "stripe";
import type { PaymentRequestRow } from "@/lib/db/schema";
import { ProviderConfigurationError } from "./errors";

export type ProviderPaymentResult = {
  providerPaymentId: string;
  providerStatus: string;
};

export interface SettlementProvider {
  createTestPayment(request: PaymentRequestRow): Promise<ProviderPaymentResult>;
}

type StripeClient = {
  paymentIntents: {
    create(
      params: Stripe.PaymentIntentCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.PaymentIntent>;
  };
};

export class StripeSandboxProvider implements SettlementProvider {
  private readonly stripe: StripeClient;

  constructor(
    secretKey = process.env.STRIPE_SECRET_KEY,
    stripeClient?: StripeClient,
  ) {
    if (!secretKey || !secretKey.startsWith("sk_test_")) {
      throw new ProviderConfigurationError(
        "STRIPE_SECRET_KEY must be a Stripe sandbox secret key",
      );
    }

    this.stripe =
      stripeClient ??
      new Stripe(secretKey, {
        maxNetworkRetries: 2,
        timeout: 10_000,
      });
  }

  async createTestPayment(request: PaymentRequestRow) {
    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: request.amountCents,
        currency: request.currency.toLowerCase(),
        payment_method:
          process.env.STRIPE_TEST_PAYMENT_METHOD ?? "pm_card_visa",
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        description: request.purpose,
        metadata: {
          payment_request_id: request.id,
          agent_id: request.agentId,
          merchant: request.merchant,
        },
      },
      { idempotencyKey: `settlement:${request.id}` },
    );

    return {
      providerPaymentId: paymentIntent.id,
      providerStatus: paymentIntent.status,
    };
  }
}

export function getSettlementProvider() {
  return new StripeSandboxProvider();
}
