import { z } from "zod";

export const paymentRequestSchema = z.object({
  agentId: z.string().trim().min(2).max(80),
  idempotencyKey: z.string().trim().min(8).max(255),
  merchant: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(80),
  purpose: z.string().trim().min(3).max(500),
  amountCents: z.number().int().positive().max(10_000_000),
  currency: z.literal("USD").default("USD"),
  riskScore: z.number().int().min(0).max(100),
});

export const operatorDecisionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type PaymentRequestInput = z.infer<typeof paymentRequestSchema>;
