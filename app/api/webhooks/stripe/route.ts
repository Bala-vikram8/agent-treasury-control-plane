import Stripe from "stripe";
import { processStripeEvent } from "@/lib/services/payment-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!secretKey?.startsWith("sk_test_") || !webhookSecret || !signature) {
    return Response.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
  }

  const stripe = new Stripe(secretKey);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      webhookSecret,
    );
  } catch {
    return Response.json({ error: "INVALID_WEBHOOK_SIGNATURE" }, { status: 400 });
  }

  if (
    event.type !== "payment_intent.succeeded" &&
    event.type !== "payment_intent.payment_failed"
  ) {
    return Response.json({ received: true, ignored: true });
  }

  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const result = await processStripeEvent({
    id: event.id,
    type: event.type,
    paymentIntentId: paymentIntent.id,
    paymentRequestId: paymentIntent.metadata.payment_request_id,
    amountCents: paymentIntent.amount,
    currency: paymentIntent.currency,
    payload: {
      providerStatus: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    },
  });

  return Response.json({ received: true, ...result });
}
